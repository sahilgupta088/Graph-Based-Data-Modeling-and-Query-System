import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import { SYSTEM_PROMPT, buildCypherPrompt, buildAnswerPrompt } from './prompts.js';
dotenv.config();

let genai = null;

function getClient() {
  if (!genai) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY not set in .env');
    genai = new GoogleGenAI({ apiKey: key });
  }
  return genai;
}

const BLOCKED_KEYWORDS = ['CREATE', 'MERGE', 'SET', 'DELETE', 'DETACH', 'REMOVE', 'DROP', 'CALL', 'FOREACH'];

function validateCypherReadOnly(query) {
  if (!query) return false;
  const upper = query.toUpperCase().trim();
  for (const kw of BLOCKED_KEYWORDS) {
    // Match keyword as a whole word (not inside a string or property name)
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    // Exclude strings inside quotes
    const withoutStrings = upper.replace(/'[^']*'|"[^"]*"/g, '');
    if (regex.test(withoutStrings)) return false;
  }
  return true;
}

export async function generateCypherQuery(schema, question, conversationHistory = []) {
  const client = getClient();
  const prompt = buildCypherPrompt(schema, question, conversationHistory);

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + prompt }] }
    ],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });

  const text = response.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1].trim());
    } else {
      throw new Error('Failed to parse LLM response as JSON: ' + text.substring(0, 200));
    }
  }

  // Guardrail: validate read-only
  if (parsed.cypherQuery && !validateCypherReadOnly(parsed.cypherQuery)) {
    return {
      needsQuery: false,
      cypherQuery: null,
      explanation: 'I can only run read-only queries. The generated query contained modification operations, which I blocked for safety.',
    };
  }

  return parsed;
}

export async function generateAnswer(question, queryResults, cypherQuery) {
  const client = getClient();
  const prompt = buildAnswerPrompt(question, queryResults, cypherQuery);

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + prompt }] }
    ],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.3,
    },
  });

  const text = response.text;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1].trim());
    } else {
      return { answer: text, highlightNodeIds: [] };
    }
  }

  return parsed;
}

export async function generateStreamingAnswer(question, queryResults, cypherQuery) {
  const client = getClient();
  const prompt = buildAnswerPrompt(question, queryResults, cypherQuery);

  const response = await client.models.generateContentStream({
    model: 'gemini-2.5-flash',
    contents: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + prompt }] }
    ],
    config: {
      temperature: 0.3,
    },
  });

  return response;
}

export async function chatWithoutGraph(question, conversationHistory = []) {
  const client = getClient();
  const historyStr = conversationHistory.length > 0
    ? '\n\nConversation History:\n' + conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n')
    : '';

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [
      { role: 'user', parts: [{ text: SYSTEM_PROMPT + historyStr + '\n\nUser: ' + question + '\n\nRespond as JSON: { "answer": "your answer", "highlightNodeIds": [] }' }] }
    ],
    config: {
      responseMimeType: 'application/json',
      temperature: 0.5,
    },
  });

  const text = response.text;
  try {
    return JSON.parse(text);
  } catch {
    return { answer: text, highlightNodeIds: [] };
  }
}
