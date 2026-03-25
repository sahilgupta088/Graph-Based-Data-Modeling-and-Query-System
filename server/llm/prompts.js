export const SYSTEM_PROMPT = `You are Dodge AI, a Graph Agent that helps users analyze and explore knowledge graphs.
You answer questions by examining the graph data and providing clear, concise answers.

IMPORTANT RULES:
1. You can ONLY generate READ-ONLY Cypher queries (MATCH, RETURN, WHERE, ORDER BY, LIMIT, WITH, OPTIONAL MATCH, UNION, UNWIND).
2. You MUST NEVER generate queries that modify data (CREATE, MERGE, SET, DELETE, DETACH, REMOVE, DROP).
3. Always limit results to 25 rows maximum unless the user explicitly asks for more.
4. Extract entity node IDs into the highlightNodeIds JSON array, but DO NOT show raw internal Node IDs in the visible text.
5. If you cannot answer from the graph data, say so honestly.
6. Keep answers highly conversational, human-like, and easy to read.
7. NEVER include the Cypher query or raw JSON inside your text answer.

You will receive the graph schema and the user's question. Generate a Cypher query to answer it, then provide a natural language answer based on the results.`;

export function buildCypherPrompt(schema, question, conversationHistory = []) {
  const schemaStr = formatSchema(schema);
  let historyStr = '';
  if (conversationHistory.length > 0) {
    historyStr = '\n\nConversation History:\n' + conversationHistory.map(function(m) {
      return m.role + ': ' + m.content;
    }).join('\n');
  }

  return 'Graph Schema:\n' + schemaStr + historyStr +
    '\n\nUser Question: ' + question +
    '\n\nRespond with a JSON object in this exact format:\n' +
    '{\n' +
    '  "cypherQuery": "MATCH ... RETURN ...",\n' +
    '  "explanation": "Brief explanation of what the query does",\n' +
    '  "needsQuery": true\n' +
    '}\n\n' +
    'If the question is a greeting or doesn\'t need graph data, set needsQuery to false and cypherQuery to null.\n' +
    'If the question is about the graph but you cannot form a valid query, set needsQuery to false and explain why.';
}

export function buildAnswerPrompt(question, queryResults, cypherQuery) {
  return 'The user asked: "' + question + '"\n\n' +
    'The following Cypher query was executed:\n' + cypherQuery + '\n\n' +
    'Query Results (as JSON):\n' + JSON.stringify(queryResults, null, 2) + '\n\n' +
    'Based on these results, provide a highly natural, human-like answer to the user\'s question.\n' +
    'IMPORTANT RULES FOR THE ANSWER:\n' +
    '1. DO NOT include the Cypher query in your textual answer.\n' +
    '2. DO NOT include raw Node IDs (e.g. Node ID: 5) in your textual answer.\n' +
    '3. Synthesize the data into conversational, friendly sentences or clean bullet points without exposing database keys.\n' +
    '4. Return the internal Node IDs ONLY in the highlightNodeIds JSON array.\n\n' +
    'Respond with a JSON object:\n' +
    '{\n' +
    '  "answer": "Your natural language answer here",\n' +
    '  "highlightNodeIds": ["id1", "id2"]\n' +
    '}';
}

function formatSchema(schema) {
  if (!schema || !schema.labels) return 'No schema available';

  let str = 'Node Labels and Properties:\n';
  for (const label of schema.labels) {
    const props = schema.properties[label] || [];
    str += '  (' + label + ') - properties: [' + props.join(', ') + ']\n';
  }

  str += '\nRelationship Types:\n';
  for (const rel of schema.relationshipTypes || []) {
    str += '  -[:' + rel + ']->\n';
  }

  return str;
}
