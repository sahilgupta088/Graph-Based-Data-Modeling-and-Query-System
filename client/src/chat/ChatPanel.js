import api from '../api/client.js';

/**
 * Chat Panel — handles message rendering, sending, typing indicators,
 * and Cypher query display.
 */
export default class ChatPanel {
  constructor(options = {}) {
    this.messagesEl = document.getElementById('chatMessages');
    this.inputEl = document.getElementById('chatInput');
    this.sendBtn = document.getElementById('btnSend');
    this.statusEl = document.getElementById('chatStatus');
    this.sessionId = 'session_' + Date.now();
    this.isProcessing = false;

    // Callbacks
    this.onHighlightNodes = options.onHighlightNodes || (() => {});

    this._setupEvents();
  }

  _setupEvents() {
    this.sendBtn.addEventListener('click', () => this._send());

    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._send();
      }
    });

    // Auto-resize textarea
    this.inputEl.addEventListener('input', () => {
      this.inputEl.style.height = 'auto';
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 100) + 'px';
    });
  }

  async _send() {
    const msg = this.inputEl.value.trim();
    if (!msg || this.isProcessing) return;

    this.inputEl.value = '';
    this.inputEl.style.height = 'auto';

    // Add user message
    this._addMessage('user', msg);

    // Show typing indicator
    this.isProcessing = true;
    this.sendBtn.disabled = true;
    this._setStatus('Dodge AI is thinking...');
    const typingEl = this._addTypingIndicator();

    try {
      const response = await api.sendMessage(msg, this.sessionId);

      // Remove typing indicator
      typingEl.remove();

      // Add AI response
      this._addAIResponse(response);

      // Highlight nodes
      if (response.highlightNodeIds && response.highlightNodeIds.length > 0) {
        this.onHighlightNodes(response.highlightNodeIds);
      }
    } catch (err) {
      typingEl.remove();
      this._addMessage('ai', `Sorry, I encountered an error: ${err.message}. Make sure the server is running and your Gemini API key is configured.`);
    } finally {
      this.isProcessing = false;
      this.sendBtn.disabled = false;
      this._setStatus('Dodge AI is awaiting instructions');
    }
  }

  _addMessage(role, text) {
    const div = document.createElement('div');
    div.className = `message message-${role}`;

    if (role === 'user') {
      div.innerHTML = `
        <div class="message-avatar user-avatar">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="#6366f1"><path d="M8 8a3 3 0 100-6 3 3 0 000 6zm-4.5 6a4.5 4.5 0 019 0h-9z"/></svg>
        </div>
        <div class="message-content">
          <div class="message-name">You</div>
          <div class="message-text">${this._escapeHtml(text)}</div>
        </div>
      `;
    } else {
      div.innerHTML = `
        <div class="message-avatar">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="url(#grad3)"/>
            <path d="M10 16L14 12L18 16L14 20Z" fill="white" opacity="0.9"/>
            <defs><linearGradient id="grad3" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
          </svg>
        </div>
        <div class="message-content">
          <div class="message-name">Dodge AI <span class="message-role">Graph Agent</span></div>
          <div class="message-text">${this._formatText(text)}</div>
        </div>
      `;
    }

    this.messagesEl.appendChild(div);
    this._scrollToBottom();
  }

  _addAIResponse(response) {
    const div = document.createElement('div');
    div.className = 'message message-ai';

    let cypherHtml = '';
    if (response.cypherQuery) {
      cypherHtml = `<div class="cypher-display">${this._escapeHtml(response.cypherQuery)}</div>`;
    }

    div.innerHTML = `
      <div class="message-avatar">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="url(#grad3)"/>
          <path d="M10 16L14 12L18 16L14 20Z" fill="white" opacity="0.9"/>
          <defs><linearGradient id="grad3" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
        </svg>
      </div>
      <div class="message-content">
        <div class="message-name">Dodge AI <span class="message-role">Graph Agent</span></div>
        <div class="message-text">${this._formatText(response.answer)}</div>
        ${cypherHtml}
      </div>
    `;

    this.messagesEl.appendChild(div);
    this._scrollToBottom();
  }

  _addTypingIndicator() {
    const div = document.createElement('div');
    div.className = 'message message-ai';
    div.innerHTML = `
      <div class="message-avatar">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="8" fill="url(#grad3)"/>
          <path d="M10 16L14 12L18 16L14 20Z" fill="white" opacity="0.9"/>
          <defs><linearGradient id="grad3" x1="0" y1="0" x2="32" y2="32"><stop stop-color="#6366f1"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs>
        </svg>
      </div>
      <div class="message-content">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    `;
    this.messagesEl.appendChild(div);
    this._scrollToBottom();
    return div;
  }

  _setStatus(text) {
    this.statusEl.textContent = text;
  }

  _scrollToBottom() {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  _formatText(text) {
    if (!text) return '';
    // Basic markdown-like formatting
    let html = this._escapeHtml(text);
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Inline code
    html = html.replace(/`(.*?)`/g, '<code style="background:#e5e7eb;padding:1px 4px;border-radius:3px;font-size:12px;">$1</code>');
    // Newlines
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  updateGraphName(name) {
    document.getElementById('chatSubtitle').textContent = name;
    document.getElementById('welcomeGraphName').innerHTML = `<strong>${name}</strong>`;
  }
}
