import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import graphRoutes from './routes/graph.js';
import chatRoutes from './routes/chat.js';
import ingestRoutes from './routes/ingest.js';
import { closeDriver } from './db/neo4j.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));

// Routes
app.use('/api/graph', graphRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/ingest', ingestRoutes);

// Serve static frontend in production
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve frontend build
app.use(express.static(path.join(__dirname, '../client/dist')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// React / Vite SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Graph Knowledge Server running on http://localhost:${PORT}`);
  console.log(`   📊 Graph API:  http://localhost:${PORT}/api/graph`);
  console.log(`   💬 Chat API:   http://localhost:${PORT}/api/chat`);
  console.log(`   📥 Ingest API: http://localhost:${PORT}/api/ingest`);
  console.log(`   ❤️  Health:     http://localhost:${PORT}/api/health\n`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await closeDriver();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeDriver();
  process.exit(0);
});
