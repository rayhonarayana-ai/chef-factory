// CHEF FACTORY — Gate 1 — Control Plane UI (vanilla, mobile-friendly).
'use strict';

let TOKEN = localStorage.getItem('cf_token') || null;
let CFG = { supabaseUrl: '', anonKey: '' };
const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    signOut();
    throw new Error('Session expired — sign in again');
  }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------- Auth ----------
async function login() {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  $('login-msg').classList.add('hidden');
  try {
    const res = await fetch(`${CFG.supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CFG.anonKey },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || data.error || 'login failed');
    TOKEN = data.access_token;
    localStorage.setItem('cf_token', TOKEN);
    showApp();
  } catch (e) {
    $('login-msg').textContent = e.message;
    $('login-msg').classList.remove('hidden');
  }
}

function signOut() {
  TOKEN = null;
  localStorage.removeItem('cf_token');
  showLogin();
}

function showLogin() {
  document.getElementById('nav').classList.add('hidden');
  $('logout').classList.add('hidden');
  for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
  $('screen-login').classList.remove('hidden');
}

function showApp() {
  document.getElementById('nav').classList.remove('hidden');
  $('logout').classList.remove('hidden');
  $('screen-login').classList.add('hidden');
  route();
}

// ---------- Router ----------
const SCREENS = ['chat', 'projects', 'passport', 'agents', 'tasks', 'approvals', 'costs', 'audit', 'status'];

function route() {
  const hash = location.hash.replace('#/', '') || 'chat';
  const screen = SCREENS.includes(hash) ? hash : 'chat';
  for (const s of SCREENS) $(`screen-${s}`).classList.add('hidden');
  $(`screen-${screen}`).classList.remove('hidden');
  for (const a of document.querySelectorAll('nav a')) a.classList.toggle('active', a.getAttribute('href') === `#/${screen}`);
  render(screen);
}

async function render(screen) {
  try {
    switch (screen) {
      case 'chat': await loadProjectsInto($('task-project'), true); break;
      case 'projects': await renderProjects(); break;
      case 'passport': await renderPassport(); break;
      case 'agents': await renderAgents(); break;
      case 'tasks': await renderTasks(); break;
      case 'approvals': await renderApprovals(); break;
      case 'costs': await renderCosts(); break;
      case 'audit': await renderAudit(); break;
      case 'status': await renderStatus(); break;
    }
  } catch (e) {
    console.error(e);
  }
}

// ---------- Chat ----------
$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

async function sendChat() {
  const input = $('chat-input');
  const command = input.value.trim();
  if (!command) return;
  input.value = '';
  const out = $('chat-output');
  const turn = document.createElement('div');
  turn.className = 'chat-turn';
  turn.innerHTML = `<div class="user">You: ${escapeHtml(command)}</div><div class="muted">CHEF is processing…</div>`;
  out.prepend(turn);
  try {
    const r = await api('/chat', { method: 'POST', body: { command } });
    turn.lastElementChild.remove();
    turn.appendChild(renderExplanation(r));
  } catch (e) {
    turn.lastElementChild.textContent = 'Error: ' + e.message;
  }
}

function renderExplanation(r) {
  const box = document.createElement('div');
  box.className = 'explanation';
  const e = r.explanation || {};
  const intent = r.intent || {};
  const lines = [];
  lines.push(`<div class="field"><b>Outcome:</b> ${r.outcome}</div>`);
  lines.push(`<div class="field"><b>Decision:</b> ${escapeHtml(e.decision || '')}</div>`);
  lines.push(`<div class="field"><b>Why:</b> ${escapeHtml(e.why || '')}</div>`);
  if (r.project) lines.push(`<div class="field"><b>Project:</b> ${escapeHtml(r.project.slug)}</div>`);
  lines.push(`<div class="field"><b>Environment:</b> ${r.environment} · <b>Risk:</b> ${r.risk}</div>`);
  if (r.authority) lines.push(`<div class="field"><b>Authority:</b> ${escapeHtml(r.authority.reason)}</div>`);
  if (e.evidence && e.evidence.length) lines.push(`<div class="field"><b>Evidence:</b> ${escapeHtml(e.evidence.join(' · '))}</div>`);
  if (r.approvalId) lines.push(`<div class="field"><b>Approval required:</b> <code>${r.approvalId}</code> — decide it under Approvals.</div>`);
  if (r.task) lines.push(`<div class="field"><b>Task:</b> <code>${r.task.id}</code> · status <code>${r.task.status}</code> · attempts ${r.task.attempts}/${r.task.maxAttempts}</div>`);
  lines.push(`<div class="field"><b>Correlation:</b> <code>${r.correlationId}</code></div>`);
  if (intent.status && intent.status !== 'resolved') {
    lines.push(`<div class="field"><b>Intent:</b> ${intent.status} — missing: ${escapeHtml((intent.missing || []).join(', '))}</div>`);
  }
  box.innerHTML = lines.join('');
  return box;
}

// ---------- Projects ----------
$('project-create').addEventListener('click', async () => {
  const name = $('project-name').value.trim();
  const slug = $('project-slug').value.trim();
  const description = $('project-desc').value.trim();
  if (!name || !slug) return alert('name and slug required');
  try {
    await api('/projects', { method: 'POST', body: { name, slug, description } });
    $('project-name').value = $('project-slug').value = $('project-desc').value = '';
    await renderProjects();
  } catch (e) { alert(e.message); }
});

async function renderProjects() {
  const { projects } = await api('/projects');
  const el = $('project-list');
  el.innerHTML = projects.length
    ? projects.map((p) => `
      <div class="item">
        <div class="row">
          <span class="title">${escapeHtml(p.name)}</span>
          <span class="badge ${p.status === 'active' ? 'ok' : 'warn'}">${p.status}</span>
        </div>
        <div class="sub">${escapeHtml(p.slug)}${p.description ? ' — ' + escapeHtml(p.description) : ''}</div>
      </div>`).join('')
    : '<div class="muted">No projects yet. Use CHEF Chat or the create form.</div>';
  await loadProjectsInto($('task-project'), true);
}

// ---------- Passport ----------
async function renderPassport() {
  const sel = $('passport-project');
  await loadProjectsInto(sel, false);
  const form = $('passport-form');
  const summary = $('passport-summary');
  const projectId = sel.value;
  if (!projectId) { form.innerHTML = ''; summary.textContent = 'Select a project.'; return; }
  try {
    const { passport, summary: s } = await api(`/passports/${projectId}`);
    form.innerHTML = ['identity', 'technology', 'repository', 'databaseRef', 'environments', 'deployment', 'dependencies', 'models', 'runtimes', 'businessModel', 'status', 'risks', 'credentialsReferences', 'operationalHealth', 'documentationState']
      .map((f) => `<label>${f}<textarea data-field="${f}" rows="3">${escapeHtml(JSON.stringify(passport[f] ?? {}, null, 2))}</textarea></label>`)
      .join('');
    summary.textContent = 'Summary: ' + JSON.stringify(s, null, 2);
  } catch (e) { form.innerHTML = `<span class="error">${escapeHtml(e.message)}</span>`; }
}

$('passport-save').addEventListener('click', async () => {
  const projectId = $('passport-project').value;
  const patch = {};
  for (const ta of document.querySelectorAll('#passport-form textarea[data-field]')) {
    try { patch[ta.dataset.field] = JSON.parse(ta.value); } catch { /* leave as-is */ }
  }
  try {
    await api(`/passports/${projectId}`, { method: 'PUT', body: { patch } });
    await renderPassport();
  } catch (e) { alert(e.message); }
});

// ---------- Agents ----------
async function renderAgents() {
  const { agents } = await api('/agents');
  $('agent-list').innerHTML = agents.length
    ? agents.map((a) => `
      <div class="item">
        <div class="row">
          <span class="title">${escapeHtml(a.name)}</span>
          <span class="badge ${a.status === 'active' ? 'ok' : 'warn'}">${a.status}</span>
        </div>
        <div class="sub">${escapeHtml(a.slug)} · ${escapeHtml(a.role)}</div>
      </div>`).join('')
    : '<div class="muted">No agents yet.</div>';
}

// ---------- Tasks ----------
async function loadProjectsInto(sel, addAll) {
  try {
    const { projects } = await api('/projects');
    sel.innerHTML = (addAll ? '<option value="">All projects</option>' : '<option value="">Select…</option>') +
      projects.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  } catch { sel.innerHTML = ''; }
}

$('task-refresh').addEventListener('click', renderTasks);

async function renderTasks() {
  const projectId = $('task-project').value;
  const status = $('task-status').value;
  const q = new URLSearchParams();
  if (projectId) q.set('projectId', projectId);
  if (status) q.set('status', status);
  const { tasks } = await api(`/tasks?${q}`);
  $('task-list').innerHTML = tasks.length
    ? tasks.map((t) => `
      <div class="item">
        <div class="row">
          <span class="title">${escapeHtml(t.title)}</span>
          <span class="badge ${t.status === 'completed' ? 'ok' : t.status === 'failed' ? 'bad' : 'warn'}">${t.status}</span>
        </div>
        <div class="sub">${escapeHtml(t.id)} · risk ${t.riskLevel} · attempts ${t.attempts}/${t.maxAttempts}${t.error ? ' · ' + escapeHtml(t.error.message || '') : ''}</div>
      </div>`).join('')
    : '<div class="muted">No tasks.</div>';
}

// ---------- Approvals ----------
async function renderApprovals() {
  const { approvals } = await api('/approvals');
  const el = $('approval-list');
  if (!approvals.length) { el.innerHTML = '<div class="muted">No approvals.</div>'; return; }
  el.innerHTML = approvals.map((a) => `
    <div class="item">
      <div class="row">
        <span class="title">${escapeHtml(a.action)}</span>
        <span class="badge ${a.status === 'pending' ? 'warn' : a.status === 'approved' ? 'ok' : 'bad'}">${a.status}</span>
      </div>
      <div class="sub">${escapeHtml(a.description || '')} · risk ${a.riskLevel || 'n/a'}${a.taskId ? ' · task ' + a.taskId : ''}</div>
      ${a.status === 'pending' ? `
        <div class="row">
          <input data-approval="${a.id}" placeholder="Reason (optional)" style="flex:1" />
          <button data-approve="${a.id}">Approve</button>
          <button data-reject="${a.id}" class="danger">Reject</button>
        </div>` : ''}
    </div>`).join('');
  el.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => resolveApproval(b.dataset.approve, 'approved', 'approve')));
  el.querySelectorAll('[data-reject]').forEach((b) => b.addEventListener('click', () => resolveApproval(b.dataset.reject, 'rejected', 'reject')));
}

async function resolveApproval(id, decision, kind) {
  const reason = document.querySelector(`[data-approval="${id}"]`)?.value || '';
  try {
    await api(`/approvals/${id}/decision`, { method: 'POST', body: { decision, reason } });
    await renderApprovals();
  } catch (e) { alert(e.message); }
}

// ---------- Costs ----------
async function renderCosts() {
  const { costs, total } = await api('/costs');
  $('cost-list').innerHTML = `
    <div class="stat-card" style="text-align:left"><div class="num">$${total.toFixed(4)}</div><div class="lbl">Total cost (USD)</div></div>
    <table><thead><tr><th>Project</th><th>Cost</th><th>Month budget</th><th>Status</th></tr></thead><tbody>
    ${costs.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>$${c.cost.toFixed(4)}</td><td>${c.budget.maxAmount === null ? 'unset' : '$' + c.budget.maxAmount}</td><td>${c.budget.exceeded ? '<span class="health-critical">OVER BUDGET</span>' : 'ok'}</td></tr>`).join('')}
    </tbody></table>`;
}

// ---------- Audit ----------
$('audit-refresh').addEventListener('click', renderAudit);
async function renderAudit() {
  const limit = Number($('audit-limit').value || 50);
  const { audit } = await api(`/audit?limit=${limit}`);
  $('audit-list').innerHTML = `<div class="muted">${audit.length} events (append-only).</div>
    <table><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Result</th><th>Task</th></tr></thead><tbody>
    ${audit.map((a) => `<tr><td>${new Date(a.created_at).toLocaleString()}</td><td>${escapeHtml(a.action)}</td><td>${escapeHtml(a.actor_type || '')}</td><td>${escapeHtml(a.authorization_result || '')}</td><td>${a.task_id ? '<code>' + a.task_id.slice(0, 8) + '</code>' : ''}</td></tr>`).join('')}
    </tbody></table>`;
}

// ---------- Daily Status ----------
async function renderStatus() {
  const { status } = await api('/status');
  const cards = [
    ['Active', status.activeTasks], ['Blocked', status.blockedTasks], ['Failures', status.failures],
    ['Pending approvals', status.pendingApprovals], ['Cost', '$' + status.cost.toFixed(4)],
  ].map(([l, n]) => `<div class="stat-card"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
  const projects = status.projects.map((p) => `
    <div class="item">
      <div class="row"><span class="title">${escapeHtml(p.projectName)}</span>
        <span class="health-${p.health}">${p.health}</span></div>
      <div class="sub">active ${p.activeTasks} · blocked ${p.blockedTasks} · failures ${p.failures} · approvals ${p.pendingApprovals} · $${p.cost.toFixed(4)}</div>
    </div>`).join('') || '<div class="muted">No projects.</div>';
  $('status-view').innerHTML = `
    <div class="stat-cards">${cards}</div>
    <h3>Projects</h3><div class="list">${projects}</div>
    <h3>Alerts</h3>
    <div class="list">${status.alerts.length ? status.alerts.map((a) => `<div class="item"><div class="sub">${escapeHtml(a)}</div></div>`).join('') : '<div class="muted">No alerts.</div>'}</div>
    <h3>Owner decisions required</h3>
    <div class="list">${status.decisionsRequired.length ? status.decisionsRequired.map((d) => `<div class="item"><div class="sub">${escapeHtml(d)}</div></div>`).join('') : '<div class="muted">None.</div>'}</div>`;
}

// ---------- Boot ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

(async function boot() {
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    CFG = cfg;
  } catch { /* server unreachable */ }
  $('login-btn').addEventListener('click', login);
  $('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('logout').addEventListener('click', signOut);
  window.addEventListener('hashchange', route);
  if (TOKEN) showApp(); else showLogin();
})();
