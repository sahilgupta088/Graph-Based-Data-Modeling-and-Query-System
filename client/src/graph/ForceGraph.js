import * as d3 from 'd3';

/**
 * Canvas-based D3 Force-Directed Graph.
 * Optimized for 1000+ nodes, with hover tooltips, click popovers, and highlight API.
 */

const NODE_COLORS = {
  SalesOrder: '#6366f1',
  Delivery: '#06b6d4',
  BillingDocument: '#f59e0b',
  Invoice: '#ef4444',
  Payment: '#10b981',
  JournalEntry: '#8b5cf6',
  Customer: '#ec4899',
  Material: '#f97316',
  GLAccount: '#64748b',
  Entity: '#94a3b8',
};

const DEFAULT_COLOR = '#94a3b8';

export default class ForceGraph {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.simulation = null;
    this.transform = d3.zoomIdentity;
    this.hoveredNode = null;
    this.selectedNode = null;
    this.highlightedNodeIds = new Set();
    this.showOverlay = true;
    this.isMinimized = false;

    // Callbacks
    this.onNodeHover = options.onNodeHover || (() => {});
    this.onNodeClick = options.onNodeClick || (() => {});
    this.onNodeUnhover = options.onNodeUnhover || (() => {});

    this._setupCanvas();
    this._setupInteractions();
    this._animate();
  }

  _setupCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.scale(dpr, dpr);
    this.width = rect.width;
    this.height = rect.height;

    // Handle resize
    this._resizeObserver = new ResizeObserver(() => {
      if (this.isMinimized) return;
      const r = this.canvas.parentElement.getBoundingClientRect();
      const d = window.devicePixelRatio || 1;
      this.canvas.width = r.width * d;
      this.canvas.height = r.height * d;
      this.canvas.style.width = `${r.width}px`;
      this.canvas.style.height = `${r.height}px`;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.scale(d, d);
      this.width = r.width;
      this.height = r.height;
      this._render();
    });
    this._resizeObserver.observe(this.canvas.parentElement);
  }

  _setupInteractions() {
    // Zoom & Pan
    this.zoom = d3.zoom()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        this.transform = event.transform;
        this._render();
      });

    d3.select(this.canvas).call(this.zoom);

    // Mouse move for hover detection
    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.transform.x) / this.transform.k;
      const y = (e.clientY - rect.top - this.transform.y) / this.transform.k;
      const node = this._findNodeAt(x, y);

      if (node !== this.hoveredNode) {
        this.hoveredNode = node;
        this.canvas.style.cursor = node ? 'pointer' : 'grab';
        if (node) {
          this.onNodeHover(node, e.clientX, e.clientY);
        } else {
          this.onNodeUnhover();
        }
        this._render();
      }
    });

    // Click for popover
    this.canvas.addEventListener('click', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left - this.transform.x) / this.transform.k;
      const y = (e.clientY - rect.top - this.transform.y) / this.transform.k;
      const node = this._findNodeAt(x, y);

      if (node) {
        this.selectedNode = node;
        this.onNodeClick(node, e.clientX, e.clientY);
      } else {
        this.selectedNode = null;
        this.onNodeClick(null);
      }
      this._render();
    });

    // Drag
    d3.select(this.canvas).call(
      d3.drag()
        .container(this.canvas)
        .subject((event) => {
          const x = (event.x - this.transform.x) / this.transform.k;
          const y = (event.y - this.transform.y) / this.transform.k;
          return this._findNodeAt(x, y);
        })
        .on('start', (event) => {
          if (!event.active) this.simulation?.alphaTarget(0.3).restart();
          if (event.subject) {
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
          }
        })
        .on('drag', (event) => {
          if (event.subject) {
            event.subject.fx = (event.x - this.transform.x) / this.transform.k;
            event.subject.fy = (event.y - this.transform.y) / this.transform.k;
          }
        })
        .on('end', (event) => {
          if (!event.active) this.simulation?.alphaTarget(0);
          if (event.subject) {
            event.subject.fx = null;
            event.subject.fy = null;
          }
        })
    );
  }

  setData(nodes, edges) {
    // Build node map for edge linking
    const nodeMap = new Map();
    this.nodes = nodes.map(n => {
      const node = { ...n, x: Math.random() * this.width, y: Math.random() * this.height };
      nodeMap.set(n.id, node);
      return node;
    });

    this.edges = edges
      .map(e => ({
        ...e,
        source: nodeMap.get(e.source),
        target: nodeMap.get(e.target),
      }))
      .filter(e => e.source && e.target);

    this._createSimulation();
  }

  _createSimulation() {
    if (this.simulation) this.simulation.stop();

    this.simulation = d3.forceSimulation(this.nodes)
      .force('link', d3.forceLink(this.edges).id(d => d.id).distance(80).strength(0.3))
      .force('charge', d3.forceManyBody().strength(-120).distanceMax(400))
      .force('center', d3.forceCenter(this.width / 2, this.height / 2))
      .force('collision', d3.forceCollide().radius(12))
      .force('x', d3.forceX(this.width / 2).strength(0.05))
      .force('y', d3.forceY(this.height / 2).strength(0.05))
      .alphaDecay(0.02)
      .on('tick', () => this._render());
  }

  _findNodeAt(x, y) {
    const radius = 8;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const n = this.nodes[i];
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy < (radius + 4) * (radius + 4)) {
        return n;
      }
    }
    return null;
  }

  _render() {
    const ctx = this.ctx;
    const w = this.width;
    const h = this.height;

    ctx.save();
    ctx.clearRect(0, 0, w, h);

    // Apply transform
    ctx.translate(this.transform.x, this.transform.y);
    ctx.scale(this.transform.k, this.transform.k);

    // Draw edges
    ctx.lineWidth = 0.8;
    for (const edge of this.edges) {
      const isHighlighted =
        this.highlightedNodeIds.has(edge.source?.id) ||
        this.highlightedNodeIds.has(edge.target?.id);
      const isHovered =
        edge.source === this.hoveredNode ||
        edge.target === this.hoveredNode;

      if (isHighlighted) {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.7)';
        ctx.lineWidth = 2;
      } else if (isHovered) {
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.5)';
        ctx.lineWidth = 1.5;
      } else {
        ctx.strokeStyle = 'rgba(199, 210, 254, 0.5)';
        ctx.lineWidth = 0.8;
      }

      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.lineTo(edge.target.x, edge.target.y);
      ctx.stroke();
    }

    // Draw nodes
    for (const node of this.nodes) {
      const color = NODE_COLORS[node.label] || DEFAULT_COLOR;
      const isHighlighted = this.highlightedNodeIds.has(node.id);
      const isHovered = node === this.hoveredNode;
      const isSelected = node === this.selectedNode;

      let radius = 5;
      if (isHighlighted) radius = 9;
      else if (isHovered || isSelected) radius = 7;

      // Glow for highlighted nodes
      if (isHighlighted) {
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 2, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.3;
        ctx.fill();
        ctx.restore();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = isHovered || isSelected || isHighlighted ? color : color + '99';
      ctx.fill();

      // Border
      if (isHovered || isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label (only for highlighted or zoomed-in)
      if (this.showOverlay && (isHighlighted || isHovered || isSelected || this.transform.k > 1.5)) {
        const labelText = node.properties?.id || node.properties?.name || node.label;
        ctx.font = `${isHighlighted ? '600' : '500'} ${isHighlighted ? '10' : '9'}px Inter, sans-serif`;
        ctx.fillStyle = isHighlighted ? color : '#374151';
        ctx.textAlign = 'center';
        ctx.fillText(labelText, node.x, node.y + radius + 12);
      }
    }

    ctx.restore();
  }

  _animate() {
    // Continuous highlight pulse animation
    if (this.highlightedNodeIds.size > 0) {
      this._render();
    }
    requestAnimationFrame(() => this._animate());
  }

  // --- Public API ---

  highlightNodes(ids) {
    this.highlightedNodeIds = new Set(ids.map(String));
    if (ids.length > 0) {
      this._zoomToNodes(ids);
    }
    this._render();
  }

  clearHighlights() {
    this.highlightedNodeIds.clear();
    this._render();
  }

  _zoomToNodes(ids) {
    const targetNodes = this.nodes.filter(n => ids.includes(n.id));
    if (targetNodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of targetNodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }

    const padding = 100;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const dx = maxX - minX + padding * 2;
    const dy = maxY - minY + padding * 2;
    const scale = Math.min(this.width / dx, this.height / dy, 3);

    const t = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(this.canvas)
      .transition()
      .duration(750)
      .call(this.zoom.transform, t);
  }

  zoomToFit() {
    if (this.nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }

    const padding = 60;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const dx = maxX - minX + padding * 2;
    const dy = maxY - minY + padding * 2;
    const scale = Math.min(this.width / dx, this.height / dy, 2);

    const t = d3.zoomIdentity
      .translate(this.width / 2, this.height / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(this.canvas)
      .transition()
      .duration(750)
      .call(this.zoom.transform, t);
  }

  toggleOverlay() {
    this.showOverlay = !this.showOverlay;
    this._render();
    return this.showOverlay;
  }

  destroy() {
    if (this.simulation) this.simulation.stop();
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }
}
