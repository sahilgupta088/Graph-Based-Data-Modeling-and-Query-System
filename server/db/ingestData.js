import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { runWrite, getDriver, closeDriver } from './neo4j.js';

const DATA_DIR = path.resolve('../data/sap-o2c-data');

// Schema mapping: folder name -> { Label, ID field }
const NODE_MAPPINGS = {
  'billing_document_headers': { label: 'BillingDocument', idField: 'billingDocument' },
  'business_partners': { label: 'BusinessPartner', idField: 'businessPartner' },
  'plants': { label: 'Plant', idField: 'plant' },
  'products': { label: 'Product', idField: 'product' },
  'sales_order_headers': { label: 'SalesOrder', idField: 'salesOrder' },
  'outbound_delivery_headers': { label: 'Delivery', idField: 'deliveryDocument' },
  // Adding more mappings...
};

const EDGE_MAPPINGS = {
  'billing_document_items': [
    { label: 'BillingDocumentItem', idField: 'billingDocumentItem' },
    { fromLabel: 'BillingDocument', fromIdField: 'billingDocument', toLabel: 'BillingDocumentItem', toIdField: 'billingDocumentItem', relType: 'CONTAINS_ITEM' },
    { fromLabel: 'BillingDocumentItem', fromIdField: 'billingDocumentItem', toLabel: 'Product', toIdField: 'product', relType: 'FOR_PRODUCT' }
  ],
  'sales_order_items': [
    { label: 'SalesOrderItem', idField: 'salesOrderItem' },
    { fromLabel: 'SalesOrder', fromIdField: 'salesOrder', toLabel: 'SalesOrderItem', toIdField: 'salesOrderItem', relType: 'CONTAINS_ITEM' },
    { fromLabel: 'SalesOrderItem', fromIdField: 'salesOrderItem', toLabel: 'Product', toIdField: 'product', relType: 'FOR_PRODUCT' }
  ],
  'outbound_delivery_items': [
    { label: 'DeliveryItem', idField: 'deliveryDocumentItem' },
    { fromLabel: 'Delivery', fromIdField: 'deliveryDocument', toLabel: 'DeliveryItem', toIdField: 'deliveryDocumentItem', relType: 'CONTAINS_ITEM' },
    { fromLabel: 'DeliveryItem', fromIdField: 'deliveryDocumentItem', toLabel: 'Product', toIdField: 'product', relType: 'FOR_PRODUCT' }
  ],
  'customer_company_assignments': [
    { fromLabel: 'BusinessPartner', fromIdField: 'customer', toLabel: 'CompanyCode', toIdField: 'companyCode', relType: 'ASSIGNED_TO_COMPANY' }
  ]
};

async function ingestFolder(folderName) {
  const folderPath = path.join(DATA_DIR, folderName);
  if (!fs.existsSync(folderPath)) {
    console.log(`Skipping ${folderName} - not found`);
    return;
  }

  const mapping = NODE_MAPPINGS[folderName];
  const edgeMappingArr = EDGE_MAPPINGS[folderName];

  if (!mapping && !edgeMappingArr) {
    console.log(`Skipping ${folderName} - no mapping defined`);
    return;
  }

  const files = fs.readdirSync(folderPath).filter(f => f.endsWith('.jsonl'));
  let count = 0;

  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath),
      crlfDelay: Infinity
    });

    const batchSize = 500;
    let batch = [];

    for await (const line of rl) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      
      // Clean up object (remove nested objects for properties)
      const cleanObj = {};
      for (const [k, v] of Object.entries(obj)) {
        if (v && typeof v === 'object') {
          if (v.time) cleanObj[k] = v.time;
          else if (v.hours !== undefined) cleanObj[k] = `${v.hours}:${v.minutes}:${v.seconds}`;
          else cleanObj[k] = JSON.stringify(v);
        } else {
          cleanObj[k] = v;
        }
      }

      batch.push(cleanObj);

      if (batch.length >= batchSize) {
        await processBatch(folderName, batch, mapping, edgeMappingArr);
        count += batch.length;
        batch = [];
      }
    }

    if (batch.length > 0) {
      await processBatch(folderName, batch, mapping, edgeMappingArr);
      count += batch.length;
    }
  }

  console.log(`Ingested ${count} records from ${folderName}`);
}

async function processBatch(folderName, batch, mapping, edgeMappingArr) {
  if (mapping) {
    // Insert Nodes
    await runWrite(
      `UNWIND $batch AS row
       MERGE (n:\`${mapping.label}\` { \`${mapping.idField}\`: row.\`${mapping.idField}\` })
       SET n += row`,
      { batch }
    );
  }

  if (edgeMappingArr) {
    for (const em of edgeMappingArr) {
      if (em.label) {
        // It's a node
        await runWrite(
          `UNWIND $batch AS row
           MERGE (n:\`${em.label}\` { \`${em.idField}\`: row.\`${em.idField}\` })
           SET n += row`,
          { batch }
        );
      } else if (em.fromLabel && em.toLabel) {
        // It's an edge
        await runWrite(
          `UNWIND $batch AS row
           WITH row WHERE row.\`${em.fromIdField}\` IS NOT NULL AND row.\`${em.toIdField}\` IS NOT NULL
           MERGE (a:\`${em.fromLabel}\` { \`${em.fromIdField}\`: row.\`${em.fromIdField}\` })
           MERGE (b:\`${em.toLabel}\` { \`${em.toIdField}\`: row.\`${em.toIdField}\` })
           MERGE (a)-[r:\`${em.relType}\`]->(b)`,
          { batch }
        );
      }
    }
  }
}

async function main() {
  const driver = getDriver();
  if (!driver) {
    console.error('Neo4j connection not configured.');
    process.exit(1);
  }

  console.log('Starting ingestion from JSONL files...');
  
  // 1. Create constraints for performance
  console.log('Creating constraints...');
  const statements = [
    'CREATE CONSTRAINT IF NOT EXISTS FOR (c:BusinessPartner) REQUIRE c.businessPartner IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (c:Product) REQUIRE c.product IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (c:SalesOrder) REQUIRE c.salesOrder IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (c:BillingDocument) REQUIRE c.billingDocument IS UNIQUE',
    'CREATE CONSTRAINT IF NOT EXISTS FOR (c:Delivery) REQUIRE c.deliveryDocument IS UNIQUE',
  ];
  for (const s of statements) {
    await runWrite(s).catch(e => console.log('Constraint rule already exists or unsupported'));
  }

  // 2. Ingest dimension tables
  const order = [
    'business_partners',
    'plants',
    'products',
    'customer_company_assignments',
    'sales_order_headers',
    'sales_order_items',
    'outbound_delivery_headers',
    'outbound_delivery_items',
    'billing_document_headers',
    'billing_document_items'
  ];

  for (const folder of order) {
    await ingestFolder(folder);
  }

  // Also ingest any other folders defined in mappings
  const allFolders = fs.readdirSync(DATA_DIR).filter(f => fs.statSync(path.join(DATA_DIR, f)).isDirectory());
  for (const folder of allFolders) {
    if (!order.includes(folder)) {
      await ingestFolder(folder);
    }
  }

  console.log('Ingestion complete!');
  await closeDriver();
}

main().catch(console.error);
