import ForceGraph from './graph/ForceGraph.js';
import ChatPanel from './chat/ChatPanel.js';
import api from './api/client.js';

/**
 * Main Application — wires together graph visualization, chat panel,
 * data ingestion, and all UI interactions.
 */

let graph = null;
let chat = null;

// ─── Toast Notification ────────────────────────────
function showToast(message, type = 'info') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── Initialize ────────────────────────────────────
async function init() {
  const canvas = document.getElementById('graphCanvas');
  const tooltip = document.getElementById('nodeTooltip');
  const popover = document.getElementById('nodePopover');
  const graphEmpty = document.getElementById('graphEmpty');
  const graphStats = document.getElementById('graphStats');

  // Initialize Graph
  graph = new ForceGraph(canvas, {
    onNodeHover: (node, mx, my) => {
      if (!node) return;
      tooltip.style.display = 'block';
      tooltip.style.left = `${mx + 12}px`;
      tooltip.style.top = `${my - 10}px`;
      tooltip.innerHTML = `
        <div class="tooltip-label">${node.label}</div>
        <div class="tooltip-id">${node.properties?.id || node.properties?.name || node.id}</div>
      `;
    },
    onNodeUnhover: () => {
      tooltip.style.display = 'none';
    },
    onNodeClick: (node, mx, my) => {
      if (!node) {
        popover.style.display = 'none';
        return;
      }
      showNodePopover(node, mx, my);
    },
  });

  // Initialize Chat
  chat = new ChatPanel({
    onHighlightNodes: (ids) => {
      graph.highlightNodes(ids);
      showToast(`Highlighted ${ids.length} node(s) on the graph`, 'success');
    },
  });

  // ─── Top Bar Actions (Removed) ─────────────────────────

  // ─── Graph Controls ─────────────────────────────
  document.getElementById('btnMinimize').addEventListener('click', () => {
    const section = document.getElementById('graphSection');
    graph.isMinimized = !graph.isMinimized;
    section.classList.toggle('minimized');
    document.getElementById('btnMinimize').querySelector('svg')?.replaceWith(
      graph.isMinimized ? '⬜' : '➖'
    );
  });

  document.getElementById('btnToggleOverlay').addEventListener('click', () => {
    const showing = graph.toggleOverlay();
    document.getElementById('overlayLabel').textContent = showing
      ? 'Hide Granular Overlay'
      : 'Show Granular Overlay';
    document.getElementById('btnToggleOverlay').classList.toggle('btn-active', showing);
  });

  document.getElementById('btnZoomFit').addEventListener('click', () => {
    graph.zoomToFit();
  });

  // ─── Load initial data ─────────────────────────
  try {
    await loadGraphData();
  } catch {
    // Server not running — that's ok, show empty state
  }
}

// ─── Load Graph Data ──────────────────────────────
async function loadGraphData() {
  const graphEmpty = document.getElementById('graphEmpty');
  const graphStats = document.getElementById('graphStats');

  try {
    const data = await api.getGraph();

    if (data.nodes.length === 0) {
      graphEmpty.style.display = 'block';
      graphStats.textContent = '';
      return;
    }

    graphEmpty.style.display = 'none';
    graph.setData(data.nodes, data.edges);
    graphStats.textContent = `${data.nodes.length} nodes · ${data.edges.length} edges`;

    // Update title
    const schema = await api.getSchema();
    if (schema.labels.length > 0) {
      const title = schema.labels.includes('SalesOrder') ? 'Order to Cash' : schema.labels[0] + ' Graph';
      document.getElementById('graphTitle').textContent = title;
      chat.updateGraphName(title);
    }

    // Auto zoom to fit after simulation settles
    setTimeout(() => graph.zoomToFit(), 1500);
  } catch (err) {
    console.error('Failed to load graph:', err);
    graphEmpty.style.display = 'block';
  }
}

// ─── Node Popover ──────────────────────────────────
function showNodePopover(node, mx, my) {
  const popover = document.getElementById('nodePopover');
  const props = node.properties || {};
  const keys = Object.keys(props).filter(k => !k.startsWith('_'));

  const maxShow = 8;
  const visibleKeys = keys.slice(0, maxShow);
  const hiddenCount = keys.length - maxShow;

  let propsHtml = visibleKeys
    .map(k => `<div class="popover-row"><span class="popover-key">${k}:</span><span class="popover-value">${props[k] ?? ''}</span></div>`)
    .join('');

  if (hiddenCount > 0) {
    propsHtml += `<div class="popover-hidden">${hiddenCount} additional fields hidden for readability</div>`;
  }

  // Count connections
  const connectionCount = graph.edges.filter(
    e => (e.source?.id || e.source) === node.id || (e.target?.id || e.target) === node.id
  ).length;

  popover.innerHTML = `
    <button class="popover-close" id="popoverClose">&times;</button>
    <div class="popover-header">
      <h3>${node.label}</h3>
      <div class="popover-entity">Entity: ${node.label}</div>
    </div>
    <div class="popover-body">${propsHtml}</div>
    <div class="popover-connections">Connections: ${connectionCount}</div>
  `;

  // Position
  const pw = 320;
  let left = mx + 16;
  let top = my - 20;
  if (left + pw > window.innerWidth) left = mx - pw - 16;
  if (top + 400 > window.innerHeight) top = window.innerHeight - 420;
  if (top < 60) top = 60;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.display = 'block';

  document.getElementById('popoverClose').addEventListener('click', () => {
    popover.style.display = 'none';
  });
}

// ─── Start ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
