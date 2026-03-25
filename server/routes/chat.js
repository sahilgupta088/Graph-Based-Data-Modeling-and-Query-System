import { Router } from 'express';
import { generateCypherQuery, generateAnswer, chatWithoutGraph } from '../llm/gemini.js';
import { runQuery, getSchema as getNeo4jSchema, getDriver } from '../db/neo4j.js';
import inMemoryGraph from '../db/inMemoryGraph.js';

const router = Router();

// In-memory conversation store (sessionId → messages[])
const conversations = new Map();
const MAX_HISTORY = 20;

function toNumber(val) {
  if (val && typeof val.toNumber === 'function') return val.toNumber();
  if (val && typeof val.low !== 'undefined') return val.low;
  return val;
}

// POST /api/chat
router.post('/', async (req, res) => {
  try {
    const { message, sessionId = 'default' } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get or create conversation history
    if (!conversations.has(sessionId)) {
      conversations.set(sessionId, []);
    }
    const history = conversations.get(sessionId);

    // Get graph schema
    const driver = getDriver();
    let schema;
    if (driver) {
      schema = await getNeo4jSchema();
    } else {
      schema = inMemoryGraph.getSchema();
    }

    const hasGraphData = schema.labels && schema.labels.length > 0;

    // Step 1: Generate Cypher query (or decide no query is needed)
    let cypherResult;
    if (hasGraphData) {
      cypherResult = await generateCypherQuery(schema, message, history);
    } else {
      cypherResult = { needsQuery: false, cypherQuery: null, explanation: 'No graph data loaded yet.' };
    }

    let answer, highlightNodeIds = [];

    if (cypherResult.needsQuery && cypherResult.cypherQuery) {
      // Step 2: Execute the Cypher query
      let queryResults = [];
      try {
        if (driver) {
          const records = await runQuery(cypherResult.cypherQuery);
          queryResults = records.map(record => {
            const obj = {};
            record.keys.forEach(key => {
              const val = record.get(key);
              if (val && val.identity !== undefined) {
                // It's a node
                obj[key] = {
                  _id: String(toNumber(val.identity)),
                  _label: val.labels?.[0],
                  ...Object.fromEntries(
                    Object.entries(val.properties).map(([k, v]) => [k, toNumber(v) ?? v])
                  ),
                };
              } else if (val && val.start !== undefined && val.end !== undefined) {
                // It's a relationship
                obj[key] = {
                  _type: val.type,
                  _start: String(toNumber(val.start)),
                  _end: String(toNumber(val.end)),
                  ...Object.fromEntries(
                    Object.entries(val.properties).map(([k, v]) => [k, toNumber(v) ?? v])
                  ),
                };
              } else {
                obj[key] = toNumber(val) ?? val;
              }
            });
            return obj;
          });
        } else {
          // In-memory: simple interpretation
          const searchTerms = message.match(/\d+/g) || [];
          for (const term of searchTerms) {
            const node = inMemoryGraph.getNode(term);
            if (node) queryResults.push(node);
          }
          if (queryResults.length === 0) {
            queryResults = inMemoryGraph.searchNodes(message.split(' ').slice(-1)[0]).slice(0, 10);
          }
        }
      } catch (queryErr) {
        console.error('Cypher execution error:', queryErr.message);
        // If query fails, return error gracefully
        const errorAnswer = await chatWithoutGraph(
          `The query "${cypherResult.cypherQuery}" failed with error: ${queryErr.message}. The user asked: "${message}". Explain what went wrong and suggest how they might rephrase.`,
          history
        );
        answer = errorAnswer.answer;
        highlightNodeIds = [];

        history.push({ role: 'user', content: message });
        history.push({ role: 'assistant', content: answer });
        if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

        return res.json({
          answer,
          cypherQuery: cypherResult.cypherQuery,
          queryError: queryErr.message,
          highlightNodeIds: [],
        });
      }

      // Step 3: Generate natural language answer from results
      const answerResult = await generateAnswer(message, queryResults, cypherResult.cypherQuery);
      answer = answerResult.answer;
      highlightNodeIds = answerResult.highlightNodeIds || [];
    } else {
      // No query needed — direct chat
      const chatResult = await chatWithoutGraph(message, history);
      answer = chatResult.answer;
      highlightNodeIds = chatResult.highlightNodeIds || [];
    }

    // Update conversation history
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: answer });
    if (history.length > MAX_HISTORY * 2) history.splice(0, 2);

    res.json({
      answer,
      cypherQuery: cypherResult.cypherQuery || null,
      explanation: cypherResult.explanation || null,
      highlightNodeIds,
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: 'Failed to process your question. ' + err.message });
  }
});

// DELETE /api/chat/history — clear conversation
router.delete('/history', (req, res) => {
  const { sessionId = 'default' } = req.body || {};
  conversations.delete(sessionId);
  res.json({ message: 'Conversation history cleared' });
});

export default router;
