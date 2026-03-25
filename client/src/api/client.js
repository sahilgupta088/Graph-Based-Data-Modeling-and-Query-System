const API_BASE = '/api';

class ApiClient {
  async get(path) {
    const res = await fetch(`${API_BASE}${path}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'API request failed');
    }
    return res.json();
  }

  async post(path, data) {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'API request failed');
    }
    return res.json();
  }

  async uploadFile(path, file, extraFields = {}) {
    const formData = new FormData();
    formData.append('file', file);
    for (const [key, value] of Object.entries(extraFields)) {
      formData.append(key, value);
    }
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || 'Upload failed');
    }
    return res.json();
  }

  // Graph endpoints
  async getGraph(limit = 500) {
    return this.get(`/graph?limit=${limit}`);
  }

  async getNode(id) {
    return this.get(`/graph/node/${encodeURIComponent(id)}`);
  }

  async getSchema() {
    return this.get('/graph/schema');
  }

  async searchNodes(query) {
    return this.get(`/graph/search?q=${encodeURIComponent(query)}`);
  }

  // Chat
  async sendMessage(message, sessionId = 'default') {
    return this.post('/chat', { message, sessionId });
  }

  // Ingest
  async uploadCSV(file, entityType, mode) {
    return this.uploadFile('/ingest', file, { entityType, mode });
  }

  async loadSampleData() {
    return this.post('/ingest/sample', {});
  }

  async clearData() {
    return this.post('/ingest/clear', {});
  }

  // Health
  async health() {
    return this.get('/health');
  }
}

export default new ApiClient();
