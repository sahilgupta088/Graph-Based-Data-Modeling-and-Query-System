import { Router } from 'express';
import multer from 'multer';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { runWrite, getDriver } from '../db/neo4j.js';
import inMemoryGraph from '../db/inMemoryGraph.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/ingest — upload CSV, create nodes & edges
router.post('/', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const entityType = req.body.entityType || 'Entity';
    const mode = req.body.mode || 'nodes'; // 'nodes' or 'edges'

    const rows = await parseCSV(req.file.buffer);

    if (rows.length === 0) {
      return res.status(400).json({ error: 'CSV file is empty' });
    }

    const driver = getDriver();

    if (mode === 'edges') {
      // Edge CSV: expects 'source', 'target', 'type' columns
      const result = await ingestEdges(rows, driver);
      return res.json({ message: `Ingested ${result.count} edges`, ...result });
    }

    // Node CSV: each row becomes a node
    const result = await ingestNodes(rows, entityType, driver);
    res.json({ message: `Ingested ${result.count} ${entityType} nodes`, ...result });
  } catch (err) {
    console.error('Ingest error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingest/clear — clear all graph data
router.post('/clear', async (req, res) => {
  try {
    const driver = getDriver();
    if (driver) {
      await runWrite('MATCH (n) DETACH DELETE n');
    }
    inMemoryGraph.clear();
    res.json({ message: 'All graph data cleared' });
  } catch (err) {
    console.error('Clear error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ingest/sample — load sample Order-to-Cash data
router.post('/sample', async (req, res) => {
  try {
    const driver = getDriver();
    await loadSampleData(driver);
    const count = driver ? '~30' : inMemoryGraph.nodeCount;
    res.json({ message: `Loaded sample Order-to-Cash data (${count} nodes)` });
  } catch (err) {
    console.error('Sample data error:', err);
    res.status(500).json({ error: err.message });
  }
});

function parseCSV(buffer) {
  return new Promise((resolve, reject) => {
    const rows = [];
    const stream = Readable.from(buffer.toString());
    stream
      .pipe(csvParser())
      .on('data', row => rows.push(row))
      .on('end', () => resolve(rows))
      .on('error', reject);
  });
}

async function ingestNodes(rows, entityType, driver) {
  let count = 0;
  const idField = findIdField(rows[0]);

  if (driver) {
    // Batch insert into Neo4j
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      await runWrite(
        `UNWIND $batch AS row
         CREATE (n:\`${entityType}\`)
         SET n = row
         SET n._ingestId = row.${idField || 'id'} `,
        { batch }
      );
      count += batch.length;
    }
  } else {
    // In-memory
    for (const row of rows) {
      const id = row[idField] || String(count);
      inMemoryGraph.addNode(id, entityType, row);
      count++;
    }
  }

  return { count, idField };
}

async function ingestEdges(rows, driver) {
  let count = 0;
  const sourceField = findField(rows[0], ['source', 'from', 'source_id', 'from_id', 'Source']);
  const targetField = findField(rows[0], ['target', 'to', 'target_id', 'to_id', 'Target']);
  const typeField = findField(rows[0], ['type', 'relationship', 'rel_type', 'Type', 'Relationship']);

  if (!sourceField || !targetField) {
    throw new Error('Edge CSV must have source and target columns');
  }

  if (driver) {
    const batchSize = 100;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);
      const relType = typeField ? 'row.' + typeField : '"RELATES_TO"';
      await runWrite(
        `UNWIND $batch AS row
         MATCH (a {_ingestId: row.${sourceField}})
         MATCH (b {_ingestId: row.${targetField}})
         CREATE (a)-[r:RELATES_TO]->(b)
         SET r = row`,
        { batch }
      );
      count += batch.length;
    }
  } else {
    for (const row of rows) {
      const source = row[sourceField];
      const target = row[targetField];
      const type = typeField ? row[typeField] : 'RELATES_TO';
      inMemoryGraph.addEdge(source, target, type, row);
      count++;
    }
  }

  return { count, sourceField, targetField };
}

function findIdField(row) {
  const keys = Object.keys(row);
  const candidates = ['id', 'ID', 'Id', '_id', 'node_id', 'NodeId', 'DocumentNumber', 'OrderNumber'];
  return candidates.find(c => keys.includes(c)) || keys[0];
}

function findField(row, candidates) {
  const keys = Object.keys(row);
  return candidates.find(c => keys.includes(c)) || null;
}

async function loadSampleData(driver) {
  // Sample Order-to-Cash process data
  const sampleNodes = [
    { id: 'SO-1001', type: 'SalesOrder', customer: 'Acme Corp', amount: 15000, currency: 'INR', status: 'Completed', date: '2025-03-15' },
    { id: 'SO-1002', type: 'SalesOrder', customer: 'Global Industries', amount: 28500, currency: 'INR', status: 'Completed', date: '2025-03-18' },
    { id: 'SO-1003', type: 'SalesOrder', customer: 'Tech Solutions', amount: 42000, currency: 'USD', status: 'In Progress', date: '2025-03-20' },
    { id: 'SO-1004', type: 'SalesOrder', customer: 'Delta Manufacturing', amount: 8900, currency: 'INR', status: 'Completed', date: '2025-03-22' },
    { id: 'SO-1005', type: 'SalesOrder', customer: 'Sunrise Retail', amount: 63000, currency: 'INR', status: 'Pending', date: '2025-04-01' },
    { id: 'DL-2001', type: 'Delivery', salesOrder: 'SO-1001', status: 'Shipped', date: '2025-03-17', carrier: 'DHL' },
    { id: 'DL-2002', type: 'Delivery', salesOrder: 'SO-1002', status: 'Shipped', date: '2025-03-20', carrier: 'FedEx' },
    { id: 'DL-2003', type: 'Delivery', salesOrder: 'SO-1003', status: 'Pending', date: '2025-03-25', carrier: 'BlueDart' },
    { id: 'DL-2004', type: 'Delivery', salesOrder: 'SO-1004', status: 'Delivered', date: '2025-03-24', carrier: 'DHL' },
    { id: 'BD-3001', type: 'BillingDocument', salesOrder: 'SO-1001', amount: 15000, currency: 'INR', date: '2025-03-18' },
    { id: 'BD-3002', type: 'BillingDocument', salesOrder: 'SO-1002', amount: 28500, currency: 'INR', date: '2025-03-21' },
    { id: 'BD-3003', type: 'BillingDocument', salesOrder: 'SO-1004', amount: 8900, currency: 'INR', date: '2025-03-25' },
    { id: 'INV-4001', type: 'Invoice', billingDoc: 'BD-3001', amount: 15000, currency: 'INR', status: 'Paid', dueDate: '2025-04-18' },
    { id: 'INV-4002', type: 'Invoice', billingDoc: 'BD-3002', amount: 28500, currency: 'INR', status: 'Overdue', dueDate: '2025-04-10' },
    { id: 'INV-4003', type: 'Invoice', billingDoc: 'BD-3003', amount: 8900, currency: 'INR', status: 'Pending', dueDate: '2025-04-25' },
    { id: 'PAY-5001', type: 'Payment', invoice: 'INV-4001', amount: 15000, currency: 'INR', method: 'Bank Transfer', date: '2025-04-15' },
    { id: 'JE-6001', type: 'JournalEntry', referenceDocument: 'BD-3001', accountingDocument: '9400635958', glAccount: '15500020', amount: -15000, currency: 'INR', postingDate: '2025-03-18' },
    { id: 'JE-6002', type: 'JournalEntry', referenceDocument: 'BD-3002', accountingDocument: '9400635959', glAccount: '15500020', amount: -28500, currency: 'INR', postingDate: '2025-03-21' },
    { id: 'JE-6003', type: 'JournalEntry', referenceDocument: 'PAY-5001', accountingDocument: '9400635960', glAccount: '11000010', amount: 15000, currency: 'INR', postingDate: '2025-04-15' },
    { id: 'CUST-001', type: 'Customer', name: 'Acme Corp', region: 'North', creditLimit: 100000, currency: 'INR' },
    { id: 'CUST-002', type: 'Customer', name: 'Global Industries', region: 'West', creditLimit: 200000, currency: 'INR' },
    { id: 'CUST-003', type: 'Customer', name: 'Tech Solutions', region: 'South', creditLimit: 150000, currency: 'USD' },
    { id: 'CUST-004', type: 'Customer', name: 'Delta Manufacturing', region: 'East', creditLimit: 50000, currency: 'INR' },
    { id: 'CUST-005', type: 'Customer', name: 'Sunrise Retail', region: 'North', creditLimit: 300000, currency: 'INR' },
    { id: 'MAT-001', type: 'Material', name: 'Steel Plate A4', category: 'Raw Material', unitPrice: 500, unit: 'KG' },
    { id: 'MAT-002', type: 'Material', name: 'Circuit Board X1', category: 'Component', unitPrice: 1200, unit: 'PC' },
    { id: 'MAT-003', type: 'Material', name: 'Polymer Sheet B2', category: 'Raw Material', unitPrice: 350, unit: 'KG' },
    { id: 'GL-15500020', type: 'GLAccount', number: '15500020', name: 'Accounts Receivable', type_: 'Asset' },
    { id: 'GL-11000010', type: 'GLAccount', number: '11000010', name: 'Cash and Bank', type_: 'Asset' },
    { id: 'GL-40000010', type: 'GLAccount', number: '40000010', name: 'Revenue', type_: 'Revenue' },
  ];

  const sampleEdges = [
    { source: 'CUST-001', target: 'SO-1001', type: 'PLACED_ORDER' },
    { source: 'CUST-002', target: 'SO-1002', type: 'PLACED_ORDER' },
    { source: 'CUST-003', target: 'SO-1003', type: 'PLACED_ORDER' },
    { source: 'CUST-004', target: 'SO-1004', type: 'PLACED_ORDER' },
    { source: 'CUST-005', target: 'SO-1005', type: 'PLACED_ORDER' },
    { source: 'SO-1001', target: 'DL-2001', type: 'HAS_DELIVERY' },
    { source: 'SO-1002', target: 'DL-2002', type: 'HAS_DELIVERY' },
    { source: 'SO-1003', target: 'DL-2003', type: 'HAS_DELIVERY' },
    { source: 'SO-1004', target: 'DL-2004', type: 'HAS_DELIVERY' },
    { source: 'SO-1001', target: 'BD-3001', type: 'HAS_BILLING' },
    { source: 'SO-1002', target: 'BD-3002', type: 'HAS_BILLING' },
    { source: 'SO-1004', target: 'BD-3003', type: 'HAS_BILLING' },
    { source: 'BD-3001', target: 'INV-4001', type: 'GENERATES_INVOICE' },
    { source: 'BD-3002', target: 'INV-4002', type: 'GENERATES_INVOICE' },
    { source: 'BD-3003', target: 'INV-4003', type: 'GENERATES_INVOICE' },
    { source: 'INV-4001', target: 'PAY-5001', type: 'RECEIVED_PAYMENT' },
    { source: 'BD-3001', target: 'JE-6001', type: 'CREATES_JOURNAL_ENTRY' },
    { source: 'BD-3002', target: 'JE-6002', type: 'CREATES_JOURNAL_ENTRY' },
    { source: 'PAY-5001', target: 'JE-6003', type: 'CREATES_JOURNAL_ENTRY' },
    { source: 'JE-6001', target: 'GL-15500020', type: 'POSTS_TO' },
    { source: 'JE-6002', target: 'GL-15500020', type: 'POSTS_TO' },
    { source: 'JE-6003', target: 'GL-11000010', type: 'POSTS_TO' },
    { source: 'SO-1001', target: 'MAT-001', type: 'CONTAINS_MATERIAL' },
    { source: 'SO-1002', target: 'MAT-002', type: 'CONTAINS_MATERIAL' },
    { source: 'SO-1003', target: 'MAT-001', type: 'CONTAINS_MATERIAL' },
    { source: 'SO-1003', target: 'MAT-003', type: 'CONTAINS_MATERIAL' },
    { source: 'SO-1004', target: 'MAT-003', type: 'CONTAINS_MATERIAL' },
  ];

  if (driver) {
    // Clear and load into Neo4j
    await runWrite('MATCH (n) DETACH DELETE n');
    for (const node of sampleNodes) {
      const label = node.type;
      const props = { ...node };
      delete props.type;
      await runWrite(
        `CREATE (n:\`${label}\` $props) SET n._ingestId = $id`,
        { props, id: node.id }
      );
    }
    for (const edge of sampleEdges) {
      await runWrite(
        `MATCH (a {_ingestId: $source}), (b {_ingestId: $target})
         CREATE (a)-[r:\`${edge.type}\`]->(b)`,
        { source: edge.source, target: edge.target }
      );
    }
  } else {
    // In-memory
    inMemoryGraph.clear();
    for (const node of sampleNodes) {
      inMemoryGraph.addNode(node.id, node.type, node);
    }
    for (const edge of sampleEdges) {
      inMemoryGraph.addEdge(edge.source, edge.target, edge.type);
    }
  }
}

export default router;
