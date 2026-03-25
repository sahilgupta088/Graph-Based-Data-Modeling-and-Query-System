import { Router } from 'express';
import neo4j from 'neo4j-driver';
import { runQuery, getSchema as getNeo4jSchema, getDriver } from '../db/neo4j.js';
import inMemoryGraph from '../db/inMemoryGraph.js';

const router = Router();

// Helper to convert Neo4j integer to JS number
function toNumber(val) {
  if (val && typeof val.toNumber === 'function') return val.toNumber();
  if (val && typeof val.low !== 'undefined') return val.low;
  return val;
}

// GET /api/graph — full graph for visualization
router.get('/', async (req, res) => {
  try {
    const driver = getDriver();

    if (!driver) {
      // Fallback to in-memory graph
      const data = inMemoryGraph.getFullGraph();
      return res.json({
        nodes: data.nodes,
        edges: data.edges,
        stats: { nodeCount: data.nodes.length, edgeCount: data.edges.length },
      });
    }

    const limit = parseInt(req.query.limit) || 500;
    const records = await runQuery(
      `MATCH (n) 
       WITH n LIMIT $limit
       OPTIONAL MATCH (n)-[r]->(m)
       RETURN n, r, m`,
      { limit: neo4j.int(limit) }
    );

    const nodesMap = new Map();
    const edges = [];

    for (const record of records) {
      const n = record.get('n');
      if (n) {
        const id = toNumber(n.identity);
        if (!nodesMap.has(id)) {
          nodesMap.set(id, {
            id: String(id),
            label: n.labels[0] || 'Unknown',
            properties: Object.fromEntries(
              Object.entries(n.properties).map(([k, v]) => [k, toNumber(v) ?? v])
            ),
          });
        }
      }

      const m = record.get('m');
      if (m) {
        const mid = toNumber(m.identity);
        if (!nodesMap.has(mid)) {
          nodesMap.set(mid, {
            id: String(mid),
            label: m.labels[0] || 'Unknown',
            properties: Object.fromEntries(
              Object.entries(m.properties).map(([k, v]) => [k, toNumber(v) ?? v])
            ),
          });
        }
      }

      const r = record.get('r');
      if (r) {
        edges.push({
          source: String(toNumber(r.start)),
          target: String(toNumber(r.end)),
          type: r.type,
          properties: Object.fromEntries(
            Object.entries(r.properties).map(([k, v]) => [k, toNumber(v) ?? v])
          ),
        });
      }
    }

    const nodes = [...nodesMap.values()];
    res.json({
      nodes,
      edges,
      stats: { nodeCount: nodes.length, edgeCount: edges.length },
    });
  } catch (err) {
    console.error('Graph fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graph/node/:id — single node details with neighbors
router.get('/node/:id', async (req, res) => {
  try {
    const driver = getDriver();
    const nodeId = req.params.id;

    if (!driver) {
      const data = inMemoryGraph.getNeighbors(nodeId);
      return res.json(data);
    }

    const id = parseInt(nodeId);
    const records = await runQuery(
      `MATCH (n) WHERE id(n) = $id
       OPTIONAL MATCH (n)-[r]-(m)
       RETURN n, r, m`,
      { id }
    );

    if (records.length === 0) {
      return res.status(404).json({ error: 'Node not found' });
    }

    const n = records[0].get('n');
    const node = {
      id: String(toNumber(n.identity)),
      label: n.labels[0],
      properties: Object.fromEntries(
        Object.entries(n.properties).map(([k, v]) => [k, toNumber(v) ?? v])
      ),
    };

    const neighbors = [];
    const edgesArr = [];
    const seen = new Set();

    for (const record of records) {
      const m = record.get('m');
      const r = record.get('r');
      if (m && r) {
        const mid = String(toNumber(m.identity));
        if (!seen.has(mid)) {
          seen.add(mid);
          neighbors.push({
            id: mid,
            label: m.labels[0],
            properties: Object.fromEntries(
              Object.entries(m.properties).map(([k, v]) => [k, toNumber(v) ?? v])
            ),
          });
        }
        edgesArr.push({
          source: String(toNumber(r.start)),
          target: String(toNumber(r.end)),
          type: r.type,
        });
      }
    }

    res.json({ node, neighbors, edges: edgesArr, connectionCount: neighbors.length });
  } catch (err) {
    console.error('Node fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graph/schema — schema info
router.get('/schema', async (req, res) => {
  try {
    const driver = getDriver();
    if (!driver) {
      return res.json(inMemoryGraph.getSchema());
    }
    const schema = await getNeo4jSchema();
    res.json(schema);
  } catch (err) {
    console.error('Schema fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/graph/search?q=term
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json([]);

    const driver = getDriver();
    if (!driver) {
      return res.json(inMemoryGraph.searchNodes(q));
    }

    const records = await runQuery(
      `MATCH (n) 
       WHERE any(prop in keys(n) WHERE toString(n[prop]) CONTAINS $q) 
       RETURN n LIMIT 20`,
      { q }
    );

    const nodes = records.map(r => {
      const n = r.get('n');
      return {
        id: String(toNumber(n.identity)),
        label: n.labels[0],
        properties: Object.fromEntries(
          Object.entries(n.properties).map(([k, v]) => [k, toNumber(v) ?? v])
        ),
      };
    });

    res.json(nodes);
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
