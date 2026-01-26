#!/usr/bin/env node
/**
 * Project Manager MCP Dashboard v2
 * Modern dashboard with:
 * - Tailwind-inspired design (CSS-only, no build step)
 * - Real-time updates
 * - Project timeline view
 * - Memory graph visualization
 * - Context snapshot viewer
 */
import * as http from 'http';
import * as url from 'url';
import Database from 'better-sqlite3';
import * as path from 'path';
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/Users/ibyeongchang/Documents/dev/ai-service-generator';
const DB_PATH = path.join(WORKSPACE_ROOT, '.claude', 'sessions.db');
const PORT = parseInt(process.env.PORT || '8000');
const db = new Database(DB_PATH);
function getStats() {
    const memoriesCount = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
    const sessionsCount = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const relationsCount = db.prepare('SELECT COUNT(*) as count FROM memory_relations').get().count;
    const patternsCount = db.prepare('SELECT COUNT(*) as count FROM work_patterns').get().count;
    let embeddingsCount = 0;
    try {
        embeddingsCount = db.prepare('SELECT COUNT(*) as count FROM embeddings').get().count;
    }
    catch { /* ignore */ }
    const memoryTypes = db.prepare('SELECT memory_type, COUNT(*) as count FROM memories GROUP BY memory_type').all();
    const projects = db.prepare('SELECT DISTINCT project FROM memories WHERE project IS NOT NULL UNION SELECT DISTINCT project FROM sessions WHERE project IS NOT NULL').all();
    // 최근 활동
    const recentActivity = db.prepare(`
    SELECT 'memory' as type, content, created_at as timestamp, project
    FROM memories
    ORDER BY created_at DESC
    LIMIT 5
  `).all();
    return {
        memories: memoriesCount,
        sessions: sessionsCount,
        relations: relationsCount,
        patterns: patternsCount,
        embeddings: embeddingsCount,
        embeddingCoverage: memoriesCount > 0 ? Math.round((embeddingsCount / memoriesCount) * 100) : 100,
        projects,
        memoryTypes,
        recentActivity
    };
}
function getProjectContext(project) {
    try {
        const projectContext = db.prepare('SELECT * FROM project_context WHERE project = ?').get(project);
        const activeContext = db.prepare('SELECT * FROM active_context WHERE project = ?').get(project);
        const tasks = db.prepare(`
      SELECT id, title, status, priority
      FROM tasks
      WHERE project = ? AND status IN ('pending', 'in_progress')
      ORDER BY priority DESC, created_at DESC
      LIMIT 5
    `).all(project);
        return {
            project,
            fixed: {
                techStack: projectContext?.tech_stack ? JSON.parse(projectContext.tech_stack) : {},
                architectureDecisions: projectContext?.architecture_decisions ? JSON.parse(projectContext.architecture_decisions) : [],
                codePatterns: projectContext?.code_patterns ? JSON.parse(projectContext.code_patterns) : [],
                specialNotes: projectContext?.special_notes || null
            },
            active: {
                currentState: activeContext?.current_state || 'No active context',
                recentFiles: activeContext?.recent_files ? JSON.parse(activeContext.recent_files) : [],
                blockers: activeContext?.blockers || null,
                lastVerification: activeContext?.last_verification || null,
                updatedAt: activeContext?.updated_at || null
            },
            pendingTasks: tasks
        };
    }
    catch {
        return null;
    }
}
function getMemories(params) {
    const type = params.get('type');
    const project = params.get('project');
    const search = params.get('search');
    const limit = parseInt(params.get('limit') || '50');
    let sql = 'SELECT * FROM memories WHERE 1=1';
    const sqlParams = [];
    if (type) {
        sql += ' AND memory_type = ?';
        sqlParams.push(type);
    }
    if (project) {
        sql += ' AND project = ?';
        sqlParams.push(project);
    }
    if (search) {
        sql += ' AND (content LIKE ? OR tags LIKE ?)';
        sqlParams.push(`%${search}%`, `%${search}%`);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    sqlParams.push(limit);
    return db.prepare(sql).all(...sqlParams);
}
function getMemory(id) {
    return db.prepare('SELECT * FROM memories WHERE id = ?').get(id);
}
function updateMemory(id, data) {
    const updates = [];
    const params = [];
    if (data.content !== undefined) {
        updates.push('content = ?');
        params.push(data.content);
    }
    if (data.tags !== undefined) {
        updates.push('tags = ?');
        params.push(JSON.stringify(data.tags));
    }
    if (data.importance !== undefined) {
        updates.push('importance = ?');
        params.push(data.importance);
    }
    if (data.memory_type !== undefined) {
        updates.push('memory_type = ?');
        params.push(data.memory_type);
    }
    if (updates.length === 0)
        return { success: false, message: 'No updates' };
    params.push(id);
    const result = db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return { success: result.changes > 0 };
}
function deleteMemoryById(id) {
    const result = db.prepare('DELETE FROM memories WHERE id = ?').run(id);
    return { success: result.changes > 0 };
}
function getTimeline(project) {
    let sql = `
    SELECT
      'memory' as event_type,
      id,
      content as title,
      memory_type as subtype,
      created_at as timestamp,
      project
    FROM memories
    ${project ? 'WHERE project = ?' : ''}
    UNION ALL
    SELECT
      'session' as event_type,
      id,
      last_work as title,
      current_status as subtype,
      timestamp,
      project
    FROM sessions
    ${project ? 'WHERE project = ?' : ''}
    ORDER BY timestamp DESC
    LIMIT 100
  `;
    return project
        ? db.prepare(sql).all(project, project)
        : db.prepare(sql).all();
}
function getRelations(memoryId) {
    if (memoryId) {
        return db.prepare(`
      SELECT r.*,
        s.content as source_content, s.memory_type as source_type,
        t.content as target_content, t.memory_type as target_type
      FROM memory_relations r
      JOIN memories s ON r.source_id = s.id
      JOIN memories t ON r.target_id = t.id
      WHERE r.source_id = ? OR r.target_id = ?
    `).all(memoryId, memoryId);
    }
    return db.prepare(`
    SELECT r.*,
      s.content as source_content, s.memory_type as source_type,
      t.content as target_content, t.memory_type as target_type
    FROM memory_relations r
    JOIN memories s ON r.source_id = s.id
    JOIN memories t ON r.target_id = t.id
    LIMIT 100
  `).all();
}
// ===== HTML 템플릿 (Modern Design) =====
const HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Project Manager MCP</title>
  <style>
    /* ===== Reset & Variables ===== */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      /* Colors - Slate palette (not purple gradient!) */
      --bg-primary: #0f172a;
      --bg-secondary: #1e293b;
      --bg-tertiary: #334155;
      --bg-hover: #475569;

      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;

      --accent-primary: #0ea5e9;    /* Sky blue */
      --accent-success: #22c55e;    /* Green */
      --accent-warning: #f59e0b;    /* Amber */
      --accent-error: #ef4444;      /* Red */
      --accent-purple: #8b5cf6;     /* Purple for learning */

      /* Spacing */
      --space-1: 4px;
      --space-2: 8px;
      --space-3: 12px;
      --space-4: 16px;
      --space-5: 20px;
      --space-6: 24px;
      --space-8: 32px;

      /* Border radius */
      --radius-sm: 6px;
      --radius-md: 8px;
      --radius-lg: 12px;
      --radius-xl: 16px;

      /* Font */
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
    }

    body {
      font-family: var(--font-sans);
      background: var(--bg-primary);
      color: var(--text-primary);
      line-height: 1.6;
      min-height: 100vh;
    }

    /* ===== Layout ===== */
    .app {
      display: grid;
      grid-template-columns: 280px 1fr;
      min-height: 100vh;
    }

    .sidebar {
      background: var(--bg-secondary);
      border-right: 1px solid var(--bg-tertiary);
      padding: var(--space-6);
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }

    .main {
      padding: var(--space-6);
      overflow-y: auto;
    }

    /* ===== Sidebar ===== */
    .logo {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      margin-bottom: var(--space-8);
      font-size: 1.25rem;
      font-weight: 600;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-purple));
      border-radius: var(--radius-md);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }

    .nav { list-style: none; }

    .nav-item {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      color: var(--text-secondary);
      cursor: pointer;
      transition: all 0.2s;
      margin-bottom: var(--space-1);
    }

    .nav-item:hover { background: var(--bg-tertiary); color: var(--text-primary); }
    .nav-item.active { background: var(--accent-primary); color: white; }

    .nav-section {
      margin-top: var(--space-6);
      margin-bottom: var(--space-2);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    /* ===== Stats Cards ===== */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-6);
    }

    .stat-card {
      background: var(--bg-secondary);
      border: 1px solid var(--bg-tertiary);
      border-radius: var(--radius-lg);
      padding: var(--space-5);
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .stat-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }

    .stat-label {
      font-size: 0.875rem;
      color: var(--text-secondary);
      margin-bottom: var(--space-2);
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 700;
      color: var(--accent-primary);
    }

    .stat-change {
      font-size: 0.75rem;
      color: var(--accent-success);
      margin-top: var(--space-1);
    }

    /* ===== Cards ===== */
    .card {
      background: var(--bg-secondary);
      border: 1px solid var(--bg-tertiary);
      border-radius: var(--radius-lg);
      overflow: hidden;
    }

    .card-header {
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--bg-tertiary);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .card-title {
      font-size: 1rem;
      font-weight: 600;
    }

    .card-body { padding: var(--space-5); }

    /* ===== Table ===== */
    .table-container { overflow-x: auto; }

    table { width: 100%; border-collapse: collapse; }

    th, td {
      padding: var(--space-3) var(--space-4);
      text-align: left;
      border-bottom: 1px solid var(--bg-tertiary);
    }

    th {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--bg-primary);
    }

    tr:hover td { background: var(--bg-tertiary); }

    /* ===== Tags/Badges ===== */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: var(--space-1) var(--space-2);
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 500;
    }

    .badge-observation { background: rgba(14, 165, 233, 0.2); color: var(--accent-primary); }
    .badge-decision { background: rgba(245, 158, 11, 0.2); color: var(--accent-warning); }
    .badge-learning { background: rgba(139, 92, 246, 0.2); color: var(--accent-purple); }
    .badge-error { background: rgba(239, 68, 68, 0.2); color: var(--accent-error); }
    .badge-pattern { background: rgba(34, 197, 94, 0.2); color: var(--accent-success); }
    .badge-preference { background: rgba(236, 72, 153, 0.2); color: #ec4899; }

    .importance {
      display: inline-flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1) var(--space-2);
      background: var(--bg-tertiary);
      border-radius: var(--radius-sm);
      font-size: 0.75rem;
    }
    .importance.high { background: rgba(239, 68, 68, 0.2); color: var(--accent-error); }
    .importance.medium { background: rgba(245, 158, 11, 0.2); color: var(--accent-warning); }

    /* ===== Buttons ===== */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-4);
      border: none;
      border-radius: var(--radius-md);
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary { background: var(--accent-primary); color: white; }
    .btn-primary:hover { background: #0284c7; }

    .btn-ghost { background: transparent; color: var(--text-secondary); }
    .btn-ghost:hover { background: var(--bg-tertiary); color: var(--text-primary); }

    .btn-danger { background: var(--accent-error); color: white; }
    .btn-danger:hover { background: #dc2626; }

    /* ===== Form Elements ===== */
    .input, .select {
      padding: var(--space-2) var(--space-3);
      background: var(--bg-primary);
      border: 1px solid var(--bg-tertiary);
      border-radius: var(--radius-md);
      color: var(--text-primary);
      font-size: 0.875rem;
    }

    .input:focus, .select:focus {
      outline: none;
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.2);
    }

    .search-box {
      display: flex;
      gap: var(--space-2);
      margin-bottom: var(--space-4);
    }

    .search-box .input { flex: 1; }

    /* ===== Timeline ===== */
    .timeline {
      position: relative;
      padding-left: var(--space-6);
    }

    .timeline::before {
      content: '';
      position: absolute;
      left: 8px;
      top: 0;
      bottom: 0;
      width: 2px;
      background: var(--bg-tertiary);
    }

    .timeline-item {
      position: relative;
      padding-bottom: var(--space-5);
    }

    .timeline-item::before {
      content: '';
      position: absolute;
      left: -22px;
      top: 4px;
      width: 12px;
      height: 12px;
      background: var(--accent-primary);
      border-radius: 50%;
      border: 2px solid var(--bg-secondary);
    }

    .timeline-item.memory::before { background: var(--accent-purple); }
    .timeline-item.session::before { background: var(--accent-success); }

    .timeline-content {
      background: var(--bg-tertiary);
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
    }

    .timeline-time {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: var(--space-1);
    }

    /* ===== Context View ===== */
    .context-section {
      margin-bottom: var(--space-5);
    }

    .context-section-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--text-secondary);
      margin-bottom: var(--space-2);
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }

    .context-list {
      list-style: none;
    }

    .context-list li {
      padding: var(--space-2) 0;
      border-bottom: 1px solid var(--bg-tertiary);
      font-size: 0.875rem;
    }

    .context-list li:last-child { border-bottom: none; }

    .context-code {
      font-family: var(--font-mono);
      font-size: 0.8rem;
      background: var(--bg-primary);
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm);
    }

    /* ===== Modal ===== */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      backdrop-filter: blur(4px);
      justify-content: center;
      align-items: center;
      z-index: 1000;
    }

    .modal-overlay.active { display: flex; }

    .modal {
      background: var(--bg-secondary);
      border-radius: var(--radius-xl);
      width: 90%;
      max-width: 600px;
      max-height: 80vh;
      overflow-y: auto;
    }

    .modal-header {
      padding: var(--space-5);
      border-bottom: 1px solid var(--bg-tertiary);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .modal-body { padding: var(--space-5); }

    .modal-footer {
      padding: var(--space-4) var(--space-5);
      border-top: 1px solid var(--bg-tertiary);
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }

    /* ===== Toast ===== */
    .toast {
      position: fixed;
      bottom: var(--space-5);
      right: var(--space-5);
      padding: var(--space-3) var(--space-5);
      background: var(--accent-success);
      color: white;
      border-radius: var(--radius-md);
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s;
      z-index: 1001;
    }

    .toast.show { transform: translateY(0); opacity: 1; }
    .toast.error { background: var(--accent-error); }

    /* ===== Utilities ===== */
    .truncate {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 300px;
    }

    .empty-state {
      text-align: center;
      padding: var(--space-8);
      color: var(--text-muted);
    }

    .empty-state-icon { font-size: 3rem; margin-bottom: var(--space-4); }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }

    /* ===== Responsive ===== */
    @media (max-width: 768px) {
      .app { grid-template-columns: 1fr; }
      .sidebar {
        position: fixed;
        left: -280px;
        transition: left 0.3s;
        z-index: 100;
      }
      .sidebar.open { left: 0; }
      .stats-grid { grid-template-columns: 1fr 1fr; }
      .grid-2 { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="logo">
        <div class="logo-icon">🧠</div>
        <span>MCP Dashboard</span>
      </div>

      <ul class="nav" id="nav">
        <li class="nav-item active" data-view="overview">📊 Overview</li>
        <li class="nav-item" data-view="memories">💾 Memories</li>
        <li class="nav-item" data-view="timeline">📅 Timeline</li>
        <li class="nav-item" data-view="context">🎯 Context</li>
        <li class="nav-item" data-view="relations">🔗 Relations</li>
      </ul>

      <div class="nav-section">Projects</div>
      <ul class="nav" id="project-nav"></ul>
    </aside>

    <!-- Main Content -->
    <main class="main" id="main-content">
      <!-- Content will be rendered here -->
    </main>
  </div>

  <!-- Modal -->
  <div class="modal-overlay" id="modal">
    <div class="modal">
      <div class="modal-header">
        <h3 id="modal-title">Modal Title</h3>
        <button class="btn btn-ghost" onclick="closeModal()">✕</button>
      </div>
      <div class="modal-body" id="modal-body"></div>
      <div class="modal-footer" id="modal-footer"></div>
    </div>
  </div>

  <!-- Toast -->
  <div class="toast" id="toast"></div>

  <script>
    // State
    let currentView = 'overview';
    let currentProject = null;
    let stats = {};

    // API
    async function api(endpoint, options = {}) {
      const res = await fetch('/api' + endpoint, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers }
      });
      return res.json();
    }

    // Toast
    function showToast(message, isError = false) {
      const toast = document.getElementById('toast');
      toast.textContent = message;
      toast.className = 'toast show' + (isError ? ' error' : '');
      setTimeout(() => toast.className = 'toast', 3000);
    }

    // Modal
    function openModal(title, bodyHtml, footerHtml = '') {
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-body').innerHTML = bodyHtml;
      document.getElementById('modal-footer').innerHTML = footerHtml;
      document.getElementById('modal').classList.add('active');
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('active');
    }

    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        currentView = item.dataset.view;
        currentProject = item.dataset.project || null;
        render();
      });
    });

    // Render functions
    async function render() {
      const main = document.getElementById('main-content');

      switch (currentView) {
        case 'overview':
          main.innerHTML = await renderOverview();
          break;
        case 'memories':
          main.innerHTML = await renderMemories();
          break;
        case 'timeline':
          main.innerHTML = await renderTimeline();
          break;
        case 'context':
          main.innerHTML = await renderContext();
          break;
        case 'relations':
          main.innerHTML = await renderRelations();
          break;
      }
    }

    async function renderOverview() {
      stats = await api('/stats');

      // Update project nav
      const projectNav = document.getElementById('project-nav');
      projectNav.innerHTML = stats.projects?.map(p => \`
        <li class="nav-item" data-view="context" data-project="\${p.project}">
          📁 \${p.project}
        </li>
      \`).join('') || '<li class="nav-item" style="opacity:0.5">No projects</li>';

      // Re-bind events
      projectNav.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
          document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
          currentView = item.dataset.view;
          currentProject = item.dataset.project;
          render();
        });
      });

      return \`
        <h1 style="margin-bottom: var(--space-6)">Dashboard Overview</h1>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">Total Memories</div>
            <div class="stat-value">\${stats.memories}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Sessions</div>
            <div class="stat-value">\${stats.sessions}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Relations</div>
            <div class="stat-value">\${stats.relations}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Embeddings</div>
            <div class="stat-value">\${stats.embeddings || 0}</div>
            <div class="stat-change">\${stats.embeddingCoverage}% coverage</div>
          </div>
        </div>

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <span class="card-title">Memory Types</span>
            </div>
            <div class="card-body">
              \${stats.memoryTypes?.map(t => \`
                <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-2);">
                  <span class="badge badge-\${t.memory_type}">\${t.memory_type}</span>
                  <span>\${t.count}</span>
                </div>
              \`).join('') || 'No memories'}
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">Recent Activity</span>
            </div>
            <div class="card-body">
              <div class="timeline">
                \${stats.recentActivity?.slice(0, 5).map(a => \`
                  <div class="timeline-item \${a.type}">
                    <div class="timeline-content">
                      <div class="truncate">\${a.content?.substring(0, 100) || 'No content'}</div>
                      <div class="timeline-time">\${new Date(a.timestamp).toLocaleString()}</div>
                    </div>
                  </div>
                \`).join('') || '<div class="empty-state">No recent activity</div>'}
              </div>
            </div>
          </div>
        </div>
      \`;
    }

    async function renderMemories() {
      const memories = await api('/memories?limit=50');

      return \`
        <h1 style="margin-bottom: var(--space-6)">Memories</h1>

        <div class="search-box">
          <input type="text" class="input" id="search" placeholder="Search memories..." onkeyup="debounce(searchMemories, 300)()">
          <select class="select" id="type-filter" onchange="searchMemories()">
            <option value="">All Types</option>
            <option value="observation">Observation</option>
            <option value="decision">Decision</option>
            <option value="learning">Learning</option>
            <option value="error">Error</option>
            <option value="pattern">Pattern</option>
          </select>
        </div>

        <div class="card">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Type</th>
                  <th>Content</th>
                  <th>Project</th>
                  <th>Importance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="memories-tbody">
                \${memories.length === 0 ? '<tr><td colspan="6" class="empty-state">No memories found</td></tr>' : ''}
                \${memories.map(m => \`
                  <tr>
                    <td>\${m.id}</td>
                    <td><span class="badge badge-\${m.memory_type}">\${m.memory_type}</span></td>
                    <td class="truncate" title="\${m.content?.replace(/"/g, '&quot;')}">\${m.content}</td>
                    <td>\${m.project || '-'}</td>
                    <td>
                      <span class="importance \${m.importance >= 8 ? 'high' : m.importance >= 5 ? 'medium' : ''}">
                        ⭐ \${m.importance}
                      </span>
                    </td>
                    <td>
                      <button class="btn btn-ghost" onclick="viewMemory(\${m.id})">View</button>
                      <button class="btn btn-ghost" onclick="editMemory(\${m.id})">Edit</button>
                      <button class="btn btn-danger" onclick="deleteMemory(\${m.id})">×</button>
                    </td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;
    }

    async function renderTimeline() {
      const timeline = await api('/timeline' + (currentProject ? '?project=' + currentProject : ''));

      return \`
        <h1 style="margin-bottom: var(--space-6)">Timeline \${currentProject ? '- ' + currentProject : ''}</h1>

        <div class="card">
          <div class="card-body">
            <div class="timeline">
              \${timeline.length === 0 ? '<div class="empty-state"><div class="empty-state-icon">📅</div>No timeline events</div>' : ''}
              \${timeline.map(e => \`
                <div class="timeline-item \${e.event_type}">
                  <div class="timeline-content">
                    <div style="display: flex; justify-content: space-between; margin-bottom: var(--space-1);">
                      <span class="badge badge-\${e.subtype || 'observation'}">\${e.subtype || e.event_type}</span>
                      <span style="font-size: 0.75rem; color: var(--text-muted)">\${e.project || ''}</span>
                    </div>
                    <div class="truncate">\${e.title}</div>
                    <div class="timeline-time">\${new Date(e.timestamp).toLocaleString()}</div>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>
        </div>
      \`;
    }

    async function renderContext() {
      if (!currentProject) {
        return \`
          <h1 style="margin-bottom: var(--space-6)">Project Context</h1>
          <div class="card">
            <div class="card-body empty-state">
              <div class="empty-state-icon">🎯</div>
              <p>Select a project from the sidebar to view its context</p>
            </div>
          </div>
        \`;
      }

      const context = await api('/context/' + currentProject);

      if (!context) {
        return \`
          <h1 style="margin-bottom: var(--space-6)">Project Context - \${currentProject}</h1>
          <div class="card">
            <div class="card-body empty-state">
              <div class="empty-state-icon">📭</div>
              <p>No context found for this project</p>
            </div>
          </div>
        \`;
      }

      return \`
        <h1 style="margin-bottom: var(--space-6)">Project Context - \${currentProject}</h1>

        <div class="grid-2">
          <div class="card">
            <div class="card-header">
              <span class="card-title">📌 Fixed Context</span>
            </div>
            <div class="card-body">
              <div class="context-section">
                <div class="context-section-title">🛠 Tech Stack</div>
                <ul class="context-list">
                  \${Object.entries(context.fixed?.techStack || {}).map(([k, v]) => \`
                    <li><strong>\${k}:</strong> \${v}</li>
                  \`).join('') || '<li>Not set</li>'}
                </ul>
              </div>

              <div class="context-section">
                <div class="context-section-title">🏗 Architecture Decisions</div>
                <ul class="context-list">
                  \${context.fixed?.architectureDecisions?.map(d => \`<li>\${d}</li>\`).join('') || '<li>None</li>'}
                </ul>
              </div>

              <div class="context-section">
                <div class="context-section-title">📝 Code Patterns</div>
                <ul class="context-list">
                  \${context.fixed?.codePatterns?.map(p => \`<li class="context-code">\${p}</li>\`).join('') || '<li>None</li>'}
                </ul>
              </div>
            </div>
          </div>

          <div class="card">
            <div class="card-header">
              <span class="card-title">⚡ Active Context</span>
            </div>
            <div class="card-body">
              <div class="context-section">
                <div class="context-section-title">📍 Current State</div>
                <p>\${context.active?.currentState || 'No active state'}</p>
              </div>

              <div class="context-section">
                <div class="context-section-title">📁 Recent Files</div>
                <ul class="context-list">
                  \${context.active?.recentFiles?.map(f => \`<li class="context-code">\${f}</li>\`).join('') || '<li>None</li>'}
                </ul>
              </div>

              <div class="context-section">
                <div class="context-section-title">✅ Last Verification</div>
                <p>
                  \${context.active?.lastVerification
                    ? \`<span class="badge badge-\${context.active.lastVerification === 'passed' ? 'pattern' : 'error'}">\${context.active.lastVerification}</span>\`
                    : 'Not run'}
                </p>
              </div>

              \${context.active?.blockers ? \`
                <div class="context-section">
                  <div class="context-section-title" style="color: var(--accent-error)">🚫 Blockers</div>
                  <p>\${context.active.blockers}</p>
                </div>
              \` : ''}
            </div>
          </div>
        </div>

        \${context.pendingTasks?.length > 0 ? \`
          <div class="card" style="margin-top: var(--space-4)">
            <div class="card-header">
              <span class="card-title">📋 Pending Tasks</span>
            </div>
            <div class="table-container">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Title</th>
                    <th>Status</th>
                    <th>Priority</th>
                  </tr>
                </thead>
                <tbody>
                  \${context.pendingTasks.map(t => \`
                    <tr>
                      <td>\${t.id}</td>
                      <td>\${t.title}</td>
                      <td><span class="badge badge-\${t.status === 'in_progress' ? 'learning' : 'observation'}">\${t.status}</span></td>
                      <td><span class="importance \${t.priority >= 8 ? 'high' : t.priority >= 5 ? 'medium' : ''}">P\${t.priority}</span></td>
                    </tr>
                  \`).join('')}
                </tbody>
              </table>
            </div>
          </div>
        \` : ''}
      \`;
    }

    async function renderRelations() {
      const relations = await api('/relations');

      return \`
        <h1 style="margin-bottom: var(--space-6)">Memory Relations</h1>

        <div class="card">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Relation</th>
                  <th>Target</th>
                  <th>Strength</th>
                </tr>
              </thead>
              <tbody>
                \${relations.length === 0 ? '<tr><td colspan="4" class="empty-state">No relations found</td></tr>' : ''}
                \${relations.map(r => \`
                  <tr>
                    <td>
                      <span class="badge badge-\${r.source_type}">\${r.source_type}</span>
                      <div class="truncate" style="max-width: 200px">\${r.source_content}</div>
                    </td>
                    <td><strong>\${r.relation_type}</strong></td>
                    <td>
                      <span class="badge badge-\${r.target_type}">\${r.target_type}</span>
                      <div class="truncate" style="max-width: 200px">\${r.target_content}</div>
                    </td>
                    <td>\${r.strength}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      \`;
    }

    // Memory actions
    async function viewMemory(id) {
      const m = await api('/memories/' + id);
      const tags = JSON.parse(m.tags || '[]');

      openModal('Memory #' + m.id, \`
        <div style="margin-bottom: var(--space-4)">
          <span class="badge badge-\${m.memory_type}">\${m.memory_type}</span>
          <span class="importance \${m.importance >= 8 ? 'high' : m.importance >= 5 ? 'medium' : ''}">⭐ \${m.importance}</span>
        </div>
        <div style="background: var(--bg-primary); padding: var(--space-4); border-radius: var(--radius-md); white-space: pre-wrap; margin-bottom: var(--space-4);">\${m.content}</div>
        <p><strong>Tags:</strong> \${tags.map(t => \`<span class="badge badge-observation">\${t}</span>\`).join(' ') || 'None'}</p>
        <p><strong>Project:</strong> \${m.project || 'None'}</p>
        <p><strong>Created:</strong> \${new Date(m.created_at).toLocaleString()}</p>
      \`, \`
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="editMemory(\${m.id})">Edit</button>
      \`);
    }

    async function editMemory(id) {
      const m = await api('/memories/' + id);
      const tags = JSON.parse(m.tags || '[]');

      openModal('Edit Memory #' + m.id, \`
        <label style="display: block; margin-bottom: var(--space-2); color: var(--text-secondary)">Content</label>
        <textarea id="edit-content" class="input" style="width: 100%; min-height: 120px; resize: vertical;">\${m.content}</textarea>

        <label style="display: block; margin: var(--space-4) 0 var(--space-2); color: var(--text-secondary)">Type</label>
        <select id="edit-type" class="select" style="width: 100%">
          \${['observation', 'decision', 'learning', 'error', 'pattern', 'preference'].map(t =>
            \`<option value="\${t}" \${t === m.memory_type ? 'selected' : ''}>\${t}</option>\`
          ).join('')}
        </select>

        <label style="display: block; margin: var(--space-4) 0 var(--space-2); color: var(--text-secondary)">Tags (comma-separated)</label>
        <input type="text" id="edit-tags" class="input" style="width: 100%" value="\${tags.join(', ')}">

        <label style="display: block; margin: var(--space-4) 0 var(--space-2); color: var(--text-secondary)">Importance (1-10)</label>
        <input type="number" id="edit-importance" class="input" style="width: 100%" value="\${m.importance}" min="1" max="10">
      \`, \`
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveMemory(\${m.id})">Save</button>
      \`);
    }

    async function saveMemory(id) {
      const content = document.getElementById('edit-content').value;
      const memory_type = document.getElementById('edit-type').value;
      const tags = document.getElementById('edit-tags').value.split(',').map(t => t.trim()).filter(Boolean);
      const importance = parseInt(document.getElementById('edit-importance').value);

      await api('/memories/' + id, {
        method: 'PUT',
        body: JSON.stringify({ content, memory_type, tags, importance })
      });

      closeModal();
      showToast('Memory updated');
      render();
    }

    async function deleteMemory(id) {
      if (!confirm('Delete this memory?')) return;
      await api('/memories/' + id, { method: 'DELETE' });
      showToast('Memory deleted');
      render();
    }

    async function searchMemories() {
      const search = document.getElementById('search')?.value || '';
      const type = document.getElementById('type-filter')?.value || '';

      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (type) params.set('type', type);

      const memories = await api('/memories?' + params);
      const tbody = document.getElementById('memories-tbody');

      if (memories.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No memories found</td></tr>';
        return;
      }

      tbody.innerHTML = memories.map(m => \`
        <tr>
          <td>\${m.id}</td>
          <td><span class="badge badge-\${m.memory_type}">\${m.memory_type}</span></td>
          <td class="truncate" title="\${m.content?.replace(/"/g, '&quot;')}">\${m.content}</td>
          <td>\${m.project || '-'}</td>
          <td>
            <span class="importance \${m.importance >= 8 ? 'high' : m.importance >= 5 ? 'medium' : ''}">
              ⭐ \${m.importance}
            </span>
          </td>
          <td>
            <button class="btn btn-ghost" onclick="viewMemory(\${m.id})">View</button>
            <button class="btn btn-ghost" onclick="editMemory(\${m.id})">Edit</button>
            <button class="btn btn-danger" onclick="deleteMemory(\${m.id})">×</button>
          </td>
        </tr>
      \`).join('');
    }

    // Debounce
    function debounce(fn, delay) {
      let timeout;
      return function() {
        clearTimeout(timeout);
        timeout = setTimeout(fn, delay);
      };
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeModal();
    });

    // Init
    render();
  </script>
</body>
</html>`;
// ===== HTTP 서버 =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '/';
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    const json = (data, status = 200) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    };
    const parseBody = () => {
        return new Promise((resolve) => {
            let body = '';
            req.on('data', chunk => body += chunk);
            req.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                }
                catch {
                    resolve({});
                }
            });
        });
    };
    try {
        // API Routes
        if (pathname.startsWith('/api')) {
            const apiPath = pathname.slice(4);
            const params = new URLSearchParams(parsedUrl.search || '');
            if (apiPath === '/stats' && req.method === 'GET') {
                return json(getStats());
            }
            if (apiPath === '/memories' && req.method === 'GET') {
                return json(getMemories(params));
            }
            const memoryMatch = apiPath.match(/^\/memories\/(\d+)$/);
            if (memoryMatch) {
                const id = parseInt(memoryMatch[1]);
                if (req.method === 'GET')
                    return json(getMemory(id));
                if (req.method === 'PUT') {
                    const body = await parseBody();
                    return json(updateMemory(id, body));
                }
                if (req.method === 'DELETE')
                    return json(deleteMemoryById(id));
            }
            if (apiPath === '/timeline' && req.method === 'GET') {
                const project = params.get('project') || undefined;
                return json(getTimeline(project));
            }
            const contextMatch = apiPath.match(/^\/context\/(.+)$/);
            if (contextMatch && req.method === 'GET') {
                return json(getProjectContext(contextMatch[1]));
            }
            if (apiPath === '/relations' && req.method === 'GET') {
                const memoryId = params.get('memoryId');
                return json(getRelations(memoryId ? parseInt(memoryId) : undefined));
            }
            return json({ error: 'Not found' }, 404);
        }
        // HTML
        if (pathname === '/' || pathname === '/index.html') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML_TEMPLATE);
            return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
    catch (error) {
        console.error('Error:', error);
        json({ error: String(error) }, 500);
    }
});
server.listen(PORT, '127.0.0.1', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🧠 Project Manager MCP Dashboard v2                        ║
║                                                              ║
║   Open: http://127.0.0.1:${PORT}                               ║
║   DB:   ${DB_PATH}
║                                                              ║
║   Features:                                                  ║
║   • Modern Tailwind-inspired design                          ║
║   • Project context viewer                                   ║
║   • Timeline view                                            ║
║   • Memory graph                                             ║
║                                                              ║
║   Press Ctrl+C to stop                                       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
