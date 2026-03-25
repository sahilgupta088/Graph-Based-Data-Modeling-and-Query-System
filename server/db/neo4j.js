import neo4j from 'neo4j-driver';
import dotenv from 'dotenv';
dotenv.config();

let driver = null;

export function getDriver() {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USER;
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !user || !password) {
      console.warn('⚠️  Neo4j credentials not configured. Using in-memory fallback.');
      return null;
    }

    driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
      maxConnectionPoolSize: 50,
      connectionAcquisitionTimeout: 10000,
    });
  }
  return driver;
}

export async function runQuery(cypher, params = {}) {
  const d = getDriver();
  if (!d) throw new Error('Neo4j not connected');
  const session = d.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

export async function runWrite(cypher, params = {}) {
  const d = getDriver();
  if (!d) throw new Error('Neo4j not connected');
  const session = d.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

export async function getSchema() {
  const d = getDriver();
  if (!d) return { labels: [], relationshipTypes: [], properties: {} };
  const session = d.session();
  try {
    // Get labels
    const labelsResult = await session.run('CALL db.labels()');
    const labels = labelsResult.records.map(r => r.get(0));

    // Get relationship types
    const relResult = await session.run('CALL db.relationshipTypes()');
    const relationshipTypes = relResult.records.map(r => r.get(0));

    // Get property keys per label (sample first 5 nodes of each)
    const properties = {};
    for (const label of labels) {
      const propsResult = await session.run(
        `MATCH (n:\`${label}\`) RETURN keys(n) AS props LIMIT 5`
      );
      const allKeys = new Set();
      propsResult.records.forEach(r => r.get('props').forEach(k => allKeys.add(k)));
      properties[label] = [...allKeys];
    }

    return { labels, relationshipTypes, properties };
  } finally {
    await session.close();
  }
}

export async function closeDriver() {
  if (driver) {
    await driver.close();
    driver = null;
  }
}
