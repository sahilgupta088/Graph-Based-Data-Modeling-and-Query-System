# Dodge AI — Knowledge Graph Visualization + LLM Chat Agent

An interactive knowledge graph visualization platform with an AI-powered chat agent that lets users explore graph data using natural language. Built for the Graph Project assessment.

![Architecture](https://img.shields.io/badge/Architecture-Monorepo-blue)
![Backend](https://img.shields.io/badge/Backend-Express%20%2B%20Neo4j-green)
![Frontend](https://img.shields.io/badge/Frontend-Vite%20%2B%20D3.js-purple)
![LLM](https://img.shields.io/badge/LLM-Google%20Gemini-orange)

---

## ✨ Features

### Core
- **Interactive Graph Visualization** — D3.js force-directed graph on HTML Canvas (performant at 1000+ nodes)
- **AI Chat Agent (Dodge AI)** — Natural language interface to explore graph data
- **CSV Data Ingestion** — Upload any CSV to populate the graph
- **Sample Data** — Pre-built Order-to-Cash process dataset

### Deep-Dive Features
1. **Natural Language → Cypher Query Translation**
   - User asks a question in plain English
   - LLM generates a read-only Cypher query based on the graph schema
   - Query is executed against Neo4j (or in-memory store)
   - Results are synthesized into a natural language answer
   - The generated Cypher query is shown for transparency

2. **Graph Node Highlighting from Chat Responses**
   - AI returns relevant node IDs alongside each answer
   - Frontend highlights those nodes with animated glow effects
   - Camera auto-pans and zooms to the highlighted cluster
   - Provides visual bridge between conversation and graph

### Additional
- Conversation memory (per session)
- Click-to-inspect node detail popovers
- Graph zoom/pan/drag
- Toast notifications
- Responsive layout

---

## 🏗️ Architecture

```
┌─────────────────┐     REST API      ┌─────────────────┐
│   Frontend       │ ◄──────────────► │   Backend        │
│   Vite + D3.js   │                  │   Express.js     │
│   (Canvas graph) │                  │                  │
│   (Chat Panel)   │                  │   ┌──────────┐   │
└─────────────────┘                  │   │ LLM Layer │   │
                                      │   │ (Gemini)  │   │
                                      │   └────┬─────┘   │
                                      │        │         │
                                      │   ┌────▼─────┐   │
                                      │   │ Neo4j /   │   │
                                      │   │ In-Memory │   │
                                      │   └──────────┘   │
                                      └─────────────────┘
```

### Why These Technologies?

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Graph DB** | Neo4j AuraDB Free | Native graph database with Cypher query language — the AI can generate Cypher queries directly. Free cloud tier means no local install. Falls back to in-memory store if not configured. |
| **LLM** | Google Gemini 2.5 Flash | Free tier with generous limits, fast inference, good at structured JSON output (critical for NL→Cypher translation). |
| **Graph Viz** | D3.js (Canvas) | SVG doesn't scale past ~200 nodes. Canvas rendering handles 1000+ nodes smoothly. D3's force simulation provides automatic layout. |
| **Frontend** | Vite + Vanilla JS | Zero framework overhead, fast HMR, no build complexity. |
| **Backend** | Express.js | Simple, well-understood, same language as frontend. |

---

## 🛡️ LLM Prompting Strategy & Guardrails

### Prompt Architecture
1. **System Prompt** — Establishes Dodge AI's identity, sets strict rules (read-only, max 25 results, include node IDs)
2. **Schema Injection** — Before each query, the full graph schema (labels, properties, relationship types) is injected into the prompt
3. **Two-Step Pipeline**:
   - Step 1: NL → Cypher (structured JSON output with `responseMimeType: 'application/json'`)
   - Step 2: Results → Natural Language Answer (with `highlightNodeIds[]`)

### Guardrails
- **Keyword Blocklist**: `CREATE`, `MERGE`, `SET`, `DELETE`, `DETACH`, `REMOVE`, `DROP`, `CALL`, `FOREACH` — any generated Cypher containing these is rejected
- **String-Aware Parsing**: Blocked keywords inside quoted strings are ignored (prevents false positives)
- **Query Timeout**: Neo4j session timeout prevents runaway queries
- **Result Limits**: Default `LIMIT 25` in prompts
- **Graceful Error Handling**: If Cypher execution fails, the error is passed back to the LLM to explain what went wrong and suggest a rephrased question

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- (Optional) Neo4j AuraDB Free account
- Google Gemini API key ([get one here](https://ai.google.dev))

### 1. Clone & Install

```bash
git clone <repo-url>
cd graph-project

# Install backend
cd server
npm install

# Install frontend
cd ../client
npm install
```

### 2. Configure Environment

```bash
# In /server/.env
GEMINI_API_KEY=your_key_here
NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io   # optional
NEO4J_USER=neo4j                                  # optional
NEO4J_PASSWORD=your_password                      # optional
PORT=3001
```

> **Note:** Neo4j is optional. Without it, the app uses an in-memory graph store that supports all features.

### 3. Run

```bash
# Terminal 1 — Backend
cd server
npm run dev

# Terminal 2 — Frontend
cd client
npm run dev
```

Open **http://localhost:5173**

### 4. Load Data

1. Click **"Load Sample"** in the top bar to load demo Order-to-Cash data
2. Or click **"Upload CSV"** to load your own data

---

## 📁 Project Structure

```
graph-project/
├── server/                   # Backend
│   ├── server.js             # Express entry point
│   ├── db/
│   │   ├── neo4j.js          # Neo4j driver & query helpers
│   │   └── inMemoryGraph.js  # Fallback in-memory graph
│   ├── llm/
│   │   ├── gemini.js         # Gemini SDK integration
│   │   └── prompts.js        # Prompt templates
│   ├── routes/
│   │   ├── graph.js          # Graph CRUD endpoints
│   │   ├── chat.js           # AI chat endpoint
│   │   └── ingest.js         # Data ingestion
│   └── .env
├── client/                   # Frontend
│   ├── index.html            # Main HTML shell
│   ├── vite.config.js
│   └── src/
│       ├── main.js           # App entry point
│       ├── graph/
│       │   └── ForceGraph.js # D3 canvas graph
│       ├── chat/
│       │   └── ChatPanel.js  # Chat UI component
│       ├── api/
│       │   └── client.js     # API client
│       └── styles/
│           └── index.css     # Design system
├── .env.example
└── README.md
```

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/graph` | Fetch all nodes & edges |
| GET | `/api/graph/node/:id` | Get node details + neighbors |
| GET | `/api/graph/schema` | Get graph schema |
| GET | `/api/graph/search?q=` | Search nodes |
| POST | `/api/chat` | Send message to AI agent |
| POST | `/api/ingest` | Upload CSV data |
| POST | `/api/ingest/sample` | Load sample dataset |
| POST | `/api/ingest/clear` | Clear all data |
| GET | `/api/health` | Health check |

---

## 📝 License

MIT
