/**
 * In-memory graph store — used as fallback when Neo4j is not configured.
 * Stores nodes and edges in plain arrays, supports basic querying.
 */

class InMemoryGraph {
  constructor() {
    this.nodes = new Map();   // id → { id, label, properties }
    this.edges = [];          // [{ source, target, type, properties }]
  }

  addNode(id, label, properties = {}) {
    this.nodes.set(String(id), { id: String(id), label, properties });
  }

  addEdge(sourceId, targetId, type, properties = {}) {
    this.edges.push({
      source: String(sourceId),
      target: String(targetId),
      type,
      properties,
    });
  }

  getNode(id) {
    return this.nodes.get(String(id)) || null;
  }

  getAllNodes() {
    return [...this.nodes.values()];
  }

  getAllEdges() {
    return [...this.edges];
  }

  getFullGraph() {
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
    };
  }

  getSchema() {
    const labels = new Set();
    const propertyKeys = {};
    const relationshipTypes = new Set();

    for (const node of this.nodes.values()) {
      labels.add(node.label);
      if (!propertyKeys[node.label]) propertyKeys[node.label] = new Set();
      Object.keys(node.properties).forEach(k => propertyKeys[node.label].add(k));
    }

    for (const edge of this.edges) {
      relationshipTypes.add(edge.type);
    }

    const properties = {};
    for (const [label, keys] of Object.entries(propertyKeys)) {
      properties[label] = [...keys];
    }

    return {
      labels: [...labels],
      relationshipTypes: [...relationshipTypes],
      properties,
    };
  }

  getNeighbors(nodeId) {
    const id = String(nodeId);
    const neighborIds = new Set();
    const relatedEdges = [];

    for (const edge of this.edges) {
      if (edge.source === id) {
        neighborIds.add(edge.target);
        relatedEdges.push(edge);
      } else if (edge.target === id) {
        neighborIds.add(edge.source);
        relatedEdges.push(edge);
      }
    }

    const neighbors = [...neighborIds].map(nid => this.nodes.get(nid)).filter(Boolean);
    return { node: this.getNode(id), neighbors, edges: relatedEdges };
  }

  searchNodes(query) {
    const lower = query.toLowerCase();
    const results = [];
    for (const node of this.nodes.values()) {
      const propsStr = JSON.stringify(node.properties).toLowerCase();
      if (node.label.toLowerCase().includes(lower) || propsStr.includes(lower)) {
        results.push(node);
      }
    }
    return results;
  }

  clear() {
    this.nodes.clear();
    this.edges.length = 0;
  }

  get nodeCount() {
    return this.nodes.size;
  }

  get edgeCount() {
    return this.edges.length;
  }
}

// Singleton
const graph = new InMemoryGraph();
export default graph;
