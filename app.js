'use strict';

// ── Constants ──────────────────────────────────────────

const COLS = [
  { id: 'todo',     label: 'TO DO',       cls: 'todo'     },
  { id: 'progress', label: 'IN PROGRESS', cls: 'progress' },
  { id: 'done',     label: 'DONE',        cls: 'done'     },
];

const DISCARD_COL = { id: 'discard', label: 'DISCARDED', cls: 'discard' };

const PALETTE = ['#0055CC','#22A06B','#D04900','#6E5DC6','#00B8D9','#E2483D'];

const PRI_LABEL = { high: '↑ High', medium: '→ Med', low: '↓ Low' };

const TYPES = {
  task:        { label: 'Task'        },
  bug:         { label: 'Bug'         },
  enhancement: { label: 'Enhancement' },
  story:       { label: 'Story'       },
};

// ── State ──────────────────────────────────────────────

let projects     = [];
let activeId     = null;
let activeView   = 'board';
let dashboard    = null;
let currentUser  = { name: '', initials: '' };
let modal        = { priority: 'medium', status: 'todo', dueDate: '', type: 'task' };
let detailTaskId = null;
let detailState  = { type: 'task', priority: 'medium', status: 'todo', dueDate: '' };

// ── Supabase data layer ────────────────────────────────

async function dbLoad() {
  // RLS policies automatically filter by the logged-in user
  const { data: projRows, error: e1 } = await supaClient
    .from('projects')
    .select('*')
    .order('created_at', { ascending: true });
  if (e1) throw e1;

  let taskRows    = [];
  let commentRows = [];

  if (projRows.length > 0) {
    const { data: tasks, error: e2 } = await supaClient
      .from('tasks')
      .select('*')
      .in('project_id', projRows.map(p => p.id))
      .order('created_ts', { ascending: true });
    if (e2) throw e2;
    taskRows = tasks ?? [];

    if (taskRows.length > 0) {
      const { data: comms, error: e3 } = await supaClient
        .from('comments')
        .select('*')
        .in('task_id', taskRows.map(t => t.id))
        .order('created_ts', { ascending: true });
      if (e3) throw e3;
      commentRows = comms ?? [];
    }
  }

  projects = projRows.map(p => ({
    id:        p.id,
    name:      p.name,
    color:     p.color,
    key:       p.key,
    counter:   p.counter    ?? 0,
    createdBy: p.created_by ?? null,
    tasks: taskRows
      .filter(t => t.project_id === p.id)
      .map(t => ({
        id:              t.id,
        text:            t.text,
        description:     t.description        ?? '',
        status:          t.status             ?? 'todo',
        priority:        t.priority           ?? 'medium',
        type:            t.type               ?? 'task',
        dueDate:         t.due_date           ?? '',
        key:             t.key                ?? '',
        createdBy:       t.created_by         ?? null,
        createdByUserId: t.created_by_user_id ?? null,
        createdAt:       t.created_ts         ?? Date.now(),
        updatedAt:       t.updated_ts         ?? Date.now(),
        comments: commentRows
          .filter(c => c.task_id === t.id)
          .map(c => ({
            id:        c.id,
            text:      c.text,
            createdAt: c.created_ts,
            author:    { name: c.author_name, initials: c.author_initials },
          })),
      })),
  }));

  activeId = projects[0]?.id ?? null;
}

async function dbCreateProject(p) {
  const { error } = await supaClient.from('projects').insert({
    id:         p.id,
    name:       p.name,
    color:      p.color,
    key:        p.key,
    counter:    p.counter,
    user_id:    window._supaUser.id,
    created_by: p.createdBy ?? null,
  });
  if (error) throw error;
}

async function dbUpdateProject(p) {
  const { error } = await supaClient.from('projects')
    .update({ name: p.name, color: p.color, counter: p.counter })
    .eq('id', p.id);
  if (error) throw error;
}

async function dbDeleteProject(id) {
  // tasks → comments cascade via FK ON DELETE CASCADE
  const { error } = await supaClient.from('projects').delete().eq('id', id);
  if (error) throw error;
}

async function dbCreateTask(task, projectId) {
  const { error } = await supaClient.from('tasks').insert({
    id:                 task.id,
    project_id:         projectId,
    user_id:            window._supaUser.id,
    text:               task.text,
    description:        task.description    ?? '',
    status:             task.status,
    priority:           task.priority,
    type:               task.type           ?? 'task',
    due_date:           task.dueDate        ?? '',
    key:                task.key,
    created_by:         task.createdBy      ?? null,
    created_by_user_id: window._supaUser.id,
    created_ts:         task.createdAt,
    updated_ts:         task.updatedAt,
  });
  if (error) throw error;
}

async function dbUpdateTask(task) {
  const { error } = await supaClient.from('tasks').update({
    text:        task.text,
    description: task.description ?? '',
    status:      task.status,
    priority:    task.priority,
    type:        task.type        ?? 'task',
    due_date:    task.dueDate     ?? '',
    updated_ts:  task.updatedAt,
  }).eq('id', task.id);
  if (error) throw error;
}

async function dbDeleteTask(id) {
  const { error } = await supaClient.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

async function dbAddComment(taskId, text, author) {
  const { data, error } = await supaClient.from('comments').insert({
    task_id:         taskId,
    user_id:         window._supaUser.id,
    text,
    author_name:     author.name     ?? null,
    author_initials: author.initials ?? null,
    created_ts:      Date.now(),
  }).select().single();
  if (error) throw error;
  return {
    id:        data.id,
    text:      data.text,
    createdAt: data.created_ts,
    author:    { name: data.author_name, initials: data.author_initials },
  };
}

async function dbDeleteComment(commentId) {
  const { error } = await supaClient.from('comments').delete().eq('id', commentId);
  if (error) throw error;
}

// ── User / profile ─────────────────────────────────────

function buildUser(name) {
  const parts    = (name || '').trim().split(/\s+/).filter(Boolean);
  const initials = parts.map(w => w[0].toUpperCase()).join('').slice(0, 2) || 'U';
  return { name: (name || '').trim(), initials };
}

function renderProfileUI() {
  document.getElementById('selfAvatar').textContent = currentUser.initials || '?';
  document.getElementById('userAvatar').textContent = currentUser.initials || '?';
  document.getElementById('userName').textContent   = currentUser.name    || 'User';
  document.getElementById('userEmail').textContent  = window._supaUser?.email || '';

  const banner = document.getElementById('profileBanner');
  if (banner) banner.style.display = 'none';
}

// ── Helpers ────────────────────────────────────────────

function makeKey(name, index = 0) {
  const base = name.trim()
    .split(/\s+/)
    .map(w => w[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .join('')
    .slice(0, 4) || `P${index + 1}`;

  const used = new Set(projects.map(p => p.key));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(base + n)) return base + n;
  }
}

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').join('').slice(0, 2) || '?';
}

function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.focus();
  setTimeout(() => el.classList.remove('shake'), 400);
}

function getActive() {
  return projects.find(p => p.id === activeId) ?? null;
}

// ── Date helpers ───────────────────────────────────────

function fmtDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtDue(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function dueStatus(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  if (dateStr < today) return 'overdue';
  const soon = new Date();
  soon.setDate(soon.getDate() + 3);
  if (dateStr <= soon.toISOString().slice(0, 10)) return 'soon';
  return 'ok';
}

function relTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d}d ago`;
  return fmtDate(ts);
}

// ── Dashboard helpers ──────────────────────────────────

function pct(n, total) {
  return total === 0 ? 0 : Math.round((n / total) * 100);
}

function computeDashData() {
  const allTasks = projects.flatMap(p =>
    p.tasks.map(t => ({ ...t, projectName: p.name, projectColor: p.color, projectId: p.id }))
  );
  return {
    projects,
    allTasks,
    total: allTasks.length,
    byStatus: {
      todo:     allTasks.filter(t => t.status === 'todo').length,
      progress: allTasks.filter(t => t.status === 'progress').length,
      done:     allTasks.filter(t => t.status === 'done').length,
    },
    byPriority: {
      high:   allTasks.filter(t => t.priority === 'high').length,
      medium: allTasks.filter(t => t.priority === 'medium').length,
      low:    allTasks.filter(t => t.priority === 'low').length,
    },
    byType: {
      task:        allTasks.filter(t => (t.type ?? 'task') === 'task').length,
      bug:         allTasks.filter(t => t.type === 'bug').length,
      enhancement: allTasks.filter(t => t.type === 'enhancement').length,
      story:       allTasks.filter(t => t.type === 'story').length,
    },
    overdue: allTasks
      .filter(t => t.dueDate && dueStatus(t.dueDate) === 'overdue' && t.status !== 'done' && t.status !== 'discard')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    dueSoon: allTasks
      .filter(t => t.dueDate && dueStatus(t.dueDate) === 'soon' && t.status !== 'done' && t.status !== 'discard')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    recent: [...allTasks].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10),
  };
}

function buildIssueRow(task, opts = {}) {
  const row = document.createElement('div');
  row.className = 'issue-row' + (opts.clickable ? ' clickable' : '');

  const left = document.createElement('div');
  left.className = 'issue-row-left';

  if (task.projectColor) {
    const dot = document.createElement('span');
    dot.className = 'issue-row-proj-dot';
    dot.style.background = task.projectColor;
    dot.title = task.projectName || '';
    left.appendChild(dot);
  }

  const key = document.createElement('code');
  key.className   = 'issue-row-key';
  key.textContent = task.key;

  const text = document.createElement('span');
  text.className   = 'issue-row-text';
  text.textContent = task.text;

  left.append(key, text);

  const right = document.createElement('div');
  right.className = 'issue-row-right';

  if (opts.showDue && task.dueDate) {
    const dueEl = document.createElement('span');
    dueEl.className   = `due-tag ${dueStatus(task.dueDate)}`;
    dueEl.textContent = fmtDue(task.dueDate);
    right.appendChild(dueEl);
  }

  const typeTag = document.createElement('span');
  typeTag.className   = `type-tag ${task.type ?? 'task'}`;
  typeTag.textContent = (TYPES[task.type] ?? TYPES.task).label;

  const priTag = document.createElement('span');
  priTag.className   = `pri-tag ${task.priority}`;
  priTag.textContent = PRI_LABEL[task.priority] ?? task.priority;

  right.append(typeTag, priTag);

  if (opts.showDate && task.updatedAt) {
    const statusDot = document.createElement('span');
    statusDot.className = `issue-row-status-dot ${task.status ?? 'todo'}`;
    statusDot.title = task.status;
    const dateEl = document.createElement('span');
    dateEl.className   = 'issue-row-date';
    dateEl.textContent = relTime(task.updatedAt);
    right.append(statusDot, dateEl);
  }

  row.append(left, right);

  if (opts.clickable) {
    row.addEventListener('click', () => openDetailReadOnly(task));
  }

  return row;
}

// ── Project actions ────────────────────────────────────

function createProject(name) {
  const id = crypto.randomUUID();
  const p  = {
    id,
    name,
    color:     PALETTE[projects.length % PALETTE.length],
    key:       makeKey(name),
    counter:   0,
    tasks:     [],
    createdBy: currentUser.name || null,
  };
  projects.push(p);
  activeId = p.id;
  dbCreateProject(p).catch(e => console.error('createProject:', e));
  render();
}

function removeProject(id) {
  projects = projects.filter(p => p.id !== id);
  if (activeId === id) activeId = projects[0]?.id ?? null;
  dbDeleteProject(id).catch(e => console.error('deleteProject:', e));
  render();
}

function setActive(id) {
  activeId = id;
  showView('board');
  closeSidebar();
}

function showView(view) {
  activeView = view;
  const boardWrap = document.getElementById('boardWrap');
  const chipSub   = document.getElementById('chipSub');

  if (view === 'overview') {
    boardWrap.style.display = 'none';
    if (dashboard) { dashboard.show(); dashboard.refresh(computeDashData()); }
    document.getElementById('createBtn').style.display    = 'none';
    document.getElementById('chipIcon').textContent       = '⊞';
    document.getElementById('chipIcon').style.background = 'var(--blue-dark)';
    document.getElementById('chipName').textContent       = 'Overview';
    if (chipSub) chipSub.textContent = 'Dashboard';
  } else {
    boardWrap.style.display = '';
    if (dashboard) dashboard.hide();
    if (chipSub) chipSub.textContent = 'Board';
    renderBoard();
  }
  renderSidebar();
}

// ── Issue actions ──────────────────────────────────────

function createIssue(text, description, priority, status, dueDate, type) {
  const p = getActive();
  if (!p) return;
  p.counter++;
  const now  = Date.now();
  const id   = crypto.randomUUID();
  const task = {
    id,
    text,
    description:     description || '',
    status,
    priority,
    dueDate:         dueDate     || '',
    type:            type        || 'task',
    comments:        [],
    key:             `${p.key}-${p.counter}`,
    createdBy:       currentUser.name        || null,
    createdByUserId: window._supaUser?.id    ?? null,
    createdAt:       now,
    updatedAt:       now,
  };
  p.tasks.push(task);
  dbCreateTask(task, p.id).catch(e => console.error('createTask:', e));
  dbUpdateProject(p).catch(e => console.error('updateProject counter:', e));
  renderBoard();
}

function moveIssue(taskId, dir) {
  const p = getActive();
  if (!p) return;
  const t = p.tasks.find(t => t.id === taskId);
  if (!t) return;
  const idx  = COLS.findIndex(c => c.id === t.status);
  const next = idx + dir;
  if (next < 0 || next >= COLS.length) return;
  t.status    = COLS[next].id;
  t.updatedAt = Date.now();
  dbUpdateTask(t).catch(e => console.error('moveIssue:', e));
  renderBoard();
}

function discardIssue(taskId) {
  const p = getActive();
  if (!p) return;
  const t = p.tasks.find(t => t.id === taskId);
  if (!t) return;
  t.status    = 'discard';
  t.updatedAt = Date.now();
  dbUpdateTask(t).catch(e => console.error('discardIssue:', e));
  renderBoard();
}

function restoreIssue(taskId) {
  const p = getActive();
  if (!p) return;
  const t = p.tasks.find(t => t.id === taskId);
  if (!t) return;
  t.status    = 'todo';
  t.updatedAt = Date.now();
  dbUpdateTask(t).catch(e => console.error('restoreIssue:', e));
  renderBoard();
}

function removeIssue(taskId) {
  const p = getActive();
  if (!p) return;
  p.tasks = p.tasks.filter(t => t.id !== taskId);
  dbDeleteTask(taskId).catch(e => console.error('deleteTask:', e));
  renderBoard();
}

// ── Render: sidebar ────────────────────────────────────

function renderSidebar() {
  const nav = document.getElementById('projectNav');
  nav.innerHTML = '';

  const overviewEl = document.getElementById('overviewNav');
  if (overviewEl) overviewEl.classList.toggle('active', activeView === 'overview');

  projects.forEach(p => {
    const item = document.createElement('div');
    item.className = 'nav-item' + (p.id === activeId && activeView !== 'overview' ? ' active' : '');
    item.dataset.projectId = p.id;

    const icon = document.createElement('span');
    icon.className = 'nav-proj-icon';
    icon.style.background = p.color;
    icon.textContent = initials(p.name);

    const label = document.createElement('span');
    label.className = 'nav-proj-name';
    label.textContent = p.name;

    const del = document.createElement('button');
    del.className = 'nav-del';
    del.textContent = '✕';
    del.title = 'Delete project';
    del.dataset.projectId = p.id;

    item.append(icon, label, del);
    nav.appendChild(item);
  });
}

// ── Render: board ──────────────────────────────────────

function renderBoard() {
  const board     = document.getElementById('board');
  const chipIcon  = document.getElementById('chipIcon');
  const chipName  = document.getElementById('chipName');
  const createBtn = document.getElementById('createBtn');
  const p = getActive();

  if (!p) {
    board.innerHTML = `
      <div class="board-empty">
        <div class="empty-icon">◈</div>
        <p class="empty-title">Welcome to DevBoard</p>
        <p class="empty-sub">Select a project from the sidebar, or create a new one to get started.</p>
      </div>`;
    chipName.textContent = 'Select a project';
    chipIcon.textContent = '?';
    chipIcon.style.background = 'var(--text-dim)';
    createBtn.style.display = 'none';
    return;
  }

  chipName.textContent = p.name;
  chipIcon.textContent = initials(p.name);
  chipIcon.style.background = p.color;
  createBtn.style.display = '';

  board.innerHTML = '';
  const frag = document.createDocumentFragment();

  COLS.forEach(col => {
    frag.appendChild(buildColumn(col, p.tasks.filter(t => t.status === col.id)));
  });
  frag.appendChild(buildColumn(DISCARD_COL, p.tasks.filter(t => t.status === 'discard')));

  board.appendChild(frag);
}

function buildColumn(col, tasks) {
  const colIdx = COLS.findIndex(c => c.id === col.id);

  const el = document.createElement('div');
  el.className = 'col';
  el.dataset.col = col.id;

  const head = document.createElement('div');
  head.className = 'col-head';

  const dot = document.createElement('span');
  dot.className = `col-dot ${col.cls}`;

  const title = document.createElement('span');
  title.className = 'col-title';
  title.textContent = col.label;

  const count = document.createElement('span');
  count.className = 'col-count';
  count.textContent = tasks.length;

  head.append(dot, title, count);

  const body = document.createElement('div');
  body.className = 'col-body';

  if (tasks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'col-empty';
    empty.textContent = 'No issues';
    body.appendChild(empty);
  } else {
    tasks.forEach(task => body.appendChild(buildCard(task, colIdx)));
  }

  el.append(head, body);
  return el;
}

function buildCard(task, colIdx) {
  const card = document.createElement('div');
  card.className = `issue-card pri-${task.priority}` +
    (task.status === 'done'    ? ' status-done'    : '') +
    (task.status === 'discard' ? ' status-discard' : '');
  card.dataset.action = 'open-detail';
  card.dataset.taskId = task.id;

  const top = document.createElement('div');
  top.className = 'card-top';

  const keyEl = document.createElement('span');
  keyEl.className = 'issue-key';
  keyEl.textContent = task.key;
  top.append(keyEl);

  if (task.status !== 'done') {
    const del = document.createElement('button');
    del.className = 'card-del';
    del.textContent = '✕';
    del.title = 'Delete issue';
    del.dataset.action = 'delete-issue';
    del.dataset.taskId = task.id;
    top.appendChild(del);
  }

  const summary = document.createElement('div');
  summary.className = 'issue-summary';
  summary.textContent = task.text;

  const dates = document.createElement('div');
  dates.className = 'card-dates';

  if (task.dueDate) {
    const status = dueStatus(task.dueDate);
    const dueEl  = document.createElement('span');
    dueEl.className   = `due-tag ${status}`;
    dueEl.textContent = `Due ${fmtDue(task.dueDate)}`;
    dates.appendChild(dueEl);
  }

  if (task.createdAt) {
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    let metaText = `Created ${fmtDate(task.createdAt)}`;
    if (task.updatedAt && task.updatedAt !== task.createdAt) {
      metaText += ` · Updated ${fmtDate(task.updatedAt)}`;
    }
    meta.textContent = metaText;
    dates.appendChild(meta);
  }

  const foot = document.createElement('div');
  foot.className = 'card-foot';

  const tags = document.createElement('div');
  tags.className = 'card-tags';

  const priTag = document.createElement('span');
  priTag.className   = `pri-tag ${task.priority}`;
  priTag.textContent = PRI_LABEL[task.priority] ?? task.priority;

  const typeTag = document.createElement('span');
  typeTag.className   = `type-tag ${task.type ?? 'task'}`;
  typeTag.textContent = (TYPES[task.type] ?? TYPES.task).label;

  tags.append(priTag, typeTag);

  const arrows = document.createElement('div');
  arrows.className = 'move-arrows';

  if (task.status === 'discard') {
    const restore = document.createElement('button');
    restore.className = 'arrow-btn restore-btn';
    restore.textContent = '↩ Restore';
    restore.title = 'Restore to To Do';
    restore.dataset.action = 'restore-issue';
    restore.dataset.taskId = task.id;
    arrows.appendChild(restore);
  } else {
    if (colIdx > 0) {
      const back = document.createElement('button');
      back.className = 'arrow-btn';
      back.textContent = `↑ ${COLS[colIdx - 1].label}`;
      back.title = `Move to ${COLS[colIdx - 1].label}`;
      back.dataset.action = 'move-issue';
      back.dataset.taskId = task.id;
      back.dataset.dir    = '-1';
      arrows.appendChild(back);
    }
    if (colIdx < COLS.length - 1) {
      const fwd = document.createElement('button');
      fwd.className = 'arrow-btn';
      fwd.textContent = `↓ ${COLS[colIdx + 1].label}`;
      fwd.title = `Move to ${COLS[colIdx + 1].label}`;
      fwd.dataset.action = 'move-issue';
      fwd.dataset.taskId = task.id;
      fwd.dataset.dir    = '1';
      arrows.appendChild(fwd);
    }
    if (task.status === 'todo' || task.status === 'progress') {
      const disc = document.createElement('button');
      disc.className = 'arrow-btn discard-btn';
      disc.textContent = '✕ Discard';
      disc.title = 'Move to Discarded';
      disc.dataset.action = 'discard-issue';
      disc.dataset.taskId = task.id;
      arrows.appendChild(disc);
    }
  }

  foot.append(tags, arrows);
  card.append(top, summary, dates, foot);
  return card;
}

// ── Create modal ───────────────────────────────────────

function openModal(defaultStatus = 'todo') {
  modal = { priority: 'medium', status: defaultStatus, dueDate: '', type: 'task' };
  document.getElementById('issueInput').value       = '';
  document.getElementById('issueDescription').value = '';
  document.getElementById('dueDateInput').value     = '';

  document.querySelectorAll('#typePicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === 'task'));
  document.querySelectorAll('#priorityPicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.priority === 'medium'));
  document.querySelectorAll('#statusPicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.status === defaultStatus));

  createPopup.open('#issueInput');
}

function closeModal()  { createPopup.close(); }

function submitModal() {
  const text        = document.getElementById('issueInput').value.trim();
  const description = document.getElementById('issueDescription').value.trim();
  if (!text) { shake(document.getElementById('issueInput')); return; }
  createIssue(text, description, modal.priority, modal.status, modal.dueDate, modal.type);
  closeModal();
}

// ── Comment helpers ────────────────────────────────────

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days < 30 ? `${days}d ago` : fmtDate(ts);
}

function linkify(text) {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return safe.replace(/(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

function renderComments(task) {
  const list  = document.getElementById('commentsList');
  const badge = document.getElementById('commentsCount');
  if (!list) return;
  list.innerHTML = '';
  const comments = task.comments ?? [];
  badge.textContent   = comments.length;
  badge.style.display = comments.length ? '' : 'none';
  const isDone = task.status === 'done';

  comments.forEach(c => {
    const item = document.createElement('div');
    item.className = 'comment-item';

    const authorName     = c.author?.name     || currentUser.name     || 'You';
    const authorInitials = c.author?.initials || currentUser.initials || 'Y';

    const av = document.createElement('span');
    av.className = 'comment-avatar'; av.textContent = authorInitials;

    const body = document.createElement('div');
    body.className = 'comment-body';

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const who  = document.createElement('span'); who.className  = 'comment-who';  who.textContent  = authorName;
    const when = document.createElement('span'); when.className = 'comment-when'; when.textContent = timeAgo(c.createdAt);
    meta.append(who, when);

    const textEl = document.createElement('div');
    textEl.className = 'comment-text';
    textEl.innerHTML = linkify(c.text);

    body.append(meta, textEl);

    const del = document.createElement('button');
    del.className = 'comment-del'; del.textContent = '✕'; del.title = 'Delete comment';
    del.dataset.commentId = c.id; // UUID string
    if (isDone) del.style.display = 'none';

    item.append(av, body, del);
    list.appendChild(item);
  });
}

async function addComment(taskId, text) {
  const p = getActive();
  if (!p) return;
  const task = p.tasks.find(t => t.id === taskId);
  if (!task) return;
  if (!task.comments) task.comments = [];

  try {
    const comment = await dbAddComment(taskId, text, {
      name:     currentUser.name     || null,
      initials: currentUser.initials || null,
    });
    task.comments.push(comment);
    task.updatedAt = Date.now();
    dbUpdateTask(task).catch(e => console.error('updateTask after comment:', e));
    renderComments(task);
  } catch (e) {
    console.error('addComment:', e);
  }
}

function removeComment(taskId, commentId) {
  const p = getActive();
  if (!p) return;
  const task = p.tasks.find(t => t.id === taskId);
  if (!task?.comments) return;
  task.comments  = task.comments.filter(c => c.id !== commentId);
  task.updatedAt = Date.now();
  dbDeleteComment(commentId).catch(e => console.error('deleteComment:', e));
  dbUpdateTask(task).catch(e => console.error('updateTask after comment delete:', e));
  renderComments(task);
}

// ── Detail modal ───────────────────────────────────────

function openDetail(taskId) {
  const p = getActive();
  if (!p) return;
  const task = p.tasks.find(t => t.id === taskId);
  if (!task) return;

  detailTaskId = taskId;
  detailState  = {
    type:     task.type     || 'task',
    priority: task.priority || 'medium',
    status:   task.status   || 'todo',
    dueDate:  task.dueDate  || '',
  };

  document.getElementById('detailKey').textContent         = task.key;
  document.getElementById('detailSummary').value           = task.text;
  document.getElementById('detailDescription').value       = task.description || '';
  document.getElementById('detailDueDate').value           = task.dueDate || '';
  document.getElementById('detailCreated').textContent  = task.createdAt ? fmtDate(task.createdAt) : '—';
  document.getElementById('detailUpdated').textContent  = task.updatedAt ? fmtDate(task.updatedAt) : '—';
  document.getElementById('detailReporter').textContent = task.createdBy || currentUser.name || '—';

  document.querySelectorAll('#detailTypePicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === detailState.type));
  document.querySelectorAll('#detailPriorityPicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.priority === detailState.priority));
  document.querySelectorAll('#detailStatusPicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.status === detailState.status));

  document.getElementById('commentInput').value = '';
  document.getElementById('commentRequiredMsg').style.display = 'none';
  renderComments(task);
  setDetailReadOnly(task.status === 'done');
  detailPopup.open('#detailSummary');
}

function setDetailReadOnly(isDone) {
  document.getElementById('detailSummary').readOnly     = isDone;
  document.getElementById('detailDescription').readOnly = isDone;
  document.getElementById('detailDueDate').disabled     = isDone;

  document.querySelectorAll(
    '#detailTypePicker .seg-btn, #detailPriorityPicker .seg-btn, #detailStatusPicker .seg-btn'
  ).forEach(b => { b.disabled = isDone; });

  document.getElementById('detailSave').style.display     = isDone ? 'none' : '';
  document.getElementById('detailDelete').style.display   = isDone ? 'none' : '';
  document.getElementById('detailMoveBack').style.display = isDone ? '' : 'none';
  document.getElementById('commentAdd').style.display     = isDone ? 'none' : '';

  document.getElementById('detailOverlay')
    .querySelector('.modal').classList.toggle('modal-readonly', isDone);
}

function openDetailReadOnly(task) {
  const p = projects.find(proj => proj.id === task.projectId);
  const fullTask = p?.tasks.find(t => t.id === task.id) ?? task;

  detailTaskId = fullTask.id;
  detailState  = {
    type:     fullTask.type     || 'task',
    priority: fullTask.priority || 'medium',
    status:   fullTask.status   || 'todo',
    dueDate:  fullTask.dueDate  || '',
  };

  document.getElementById('detailKey').textContent       = fullTask.key;
  document.getElementById('detailSummary').value         = fullTask.text;
  document.getElementById('detailDescription').value     = fullTask.description || '';
  document.getElementById('detailDueDate').value         = fullTask.dueDate || '';
  document.getElementById('detailCreated').textContent   = fullTask.createdAt ? fmtDate(fullTask.createdAt) : '—';
  document.getElementById('detailUpdated').textContent   = fullTask.updatedAt ? fmtDate(fullTask.updatedAt) : '—';
  document.getElementById('detailReporter').textContent  = fullTask.createdBy || currentUser.name || '—';

  document.querySelectorAll('#detailTypePicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === detailState.type));
  document.querySelectorAll('#detailPriorityPicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.priority === detailState.priority));
  document.querySelectorAll('#detailStatusPicker .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.status === detailState.status));

  document.getElementById('commentInput').value = '';
  document.getElementById('commentRequiredMsg').style.display = 'none';
  renderComments(fullTask);
  setDetailReadOnly(true);
  document.getElementById('detailMoveBack').style.display = 'none';
  detailPopup.open('#detailKey');
}

function saveDetail() {
  const p = getActive();
  if (!p) return;
  const task = p.tasks.find(t => t.id === detailTaskId);
  if (!task) return;

  const summary = document.getElementById('detailSummary').value.trim();
  if (!summary) { shake(document.getElementById('detailSummary')); return; }

  if (detailState.status === 'done' && !(task.comments?.length)) {
    const msg = document.getElementById('commentRequiredMsg');
    const ci  = document.getElementById('commentInput');
    msg.style.display = '';
    ci.focus();
    ci.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  task.text        = summary;
  task.description = document.getElementById('detailDescription').value.trim();
  task.dueDate     = document.getElementById('detailDueDate').value;
  task.type        = detailState.type;
  task.priority    = detailState.priority;
  task.status      = detailState.status;
  task.updatedAt   = Date.now();

  dbUpdateTask(task).catch(e => console.error('saveDetail:', e));
  renderBoard();
  detailPopup.close();
}

// ── Mobile sidebar ─────────────────────────────────────

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('backdrop').classList.add('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('backdrop').classList.remove('open');
}

// ── Full render ────────────────────────────────────────

function render() {
  renderSidebar();
  renderBoard();
  if (dashboard && activeView === 'overview') dashboard.refresh(computeDashData());
}

// ── Widget definitions ─────────────────────────────────

class TotalIssuesWidget extends BaseWidget {
  constructor() { super({ id: 'total', title: 'Total Issues', cols: 2 }); }
  render({ total, byStatus }) {
    const wrap = document.createElement('div'); wrap.className = 'w-total';
    const num = document.createElement('div'); num.className = 'w-big-num'; num.textContent = total;
    const sub = document.createElement('div'); sub.className = 'w-total-sub';
    sub.textContent = total === 0 ? 'No issues yet' : `${pct(byStatus.done, total)}% complete`;
    const pills = document.createElement('div'); pills.className = 'w-status-pills';
    [{ key: 'todo', label: 'To Do', cls: 'todo' }, { key: 'progress', label: 'In Progress', cls: 'progress' }, { key: 'done', label: 'Done', cls: 'done' }]
      .forEach(({ key, label, cls }) => {
        const p = document.createElement('span'); p.className = `status-pill ${cls}`; p.textContent = `${byStatus[key]} ${label}`; pills.appendChild(p);
      });
    wrap.append(num, sub, pills); return wrap;
  }
}

class StatusBarWidget extends BaseWidget {
  constructor() { super({ id: 'status-dist', title: 'Status Distribution', cols: 4 }); }
  render({ total, byStatus }) {
    const wrap = document.createElement('div');
    if (total === 0) { wrap.className = 'w-empty'; wrap.textContent = 'No issues yet'; return wrap; }
    wrap.className = 'w-bar-chart';
    const area = document.createElement('div'); area.className = 'bar-chart-area';
    const labelsRow = document.createElement('div'); labelsRow.className = 'bar-chart-labels';
    const maxVal = Math.max(byStatus.todo, byStatus.progress, byStatus.done, 1);
    [{ key: 'todo', label: 'To Do', cls: 'todo' }, { key: 'progress', label: 'In Progress', cls: 'progress' }, { key: 'done', label: 'Done', cls: 'done' }].forEach(({ key, label, cls }) => {
      const val = byStatus[key];
      const col = document.createElement('div'); col.className = 'bar-col';
      const count = document.createElement('span'); count.className = 'bar-count'; count.textContent = val;
      const pctEl = document.createElement('span'); pctEl.className = 'bar-pct'; pctEl.textContent = `${pct(val, total)}%`;
      const fill = document.createElement('div'); fill.className = `bar-fill ${cls}`; fill.style.height = `${Math.max(pct(val, maxVal), 2)}%`;
      col.append(count, pctEl, fill);
      area.appendChild(col);
      const lbl = document.createElement('span'); lbl.className = 'bar-label-col'; lbl.textContent = label;
      labelsRow.appendChild(lbl);
    });
    wrap.append(area, labelsRow);
    return wrap;
  }
}

class PriorityWidget extends BaseWidget {
  constructor() { super({ id: 'priority', title: 'By Priority', cols: 2 }); }
  render({ total, byPriority }) {
    const wrap = document.createElement('div'); wrap.className = 'w-breakdown';
    [{ key: 'high', label: '↑ High', cls: 'pri-high' }, { key: 'medium', label: '→ Medium', cls: 'pri-medium' }, { key: 'low', label: '↓ Low', cls: 'pri-low' }].forEach(({ key, label, cls }) => {
      const row = document.createElement('div'); row.className = 'breakdown-row';
      const lbl = document.createElement('span'); lbl.className = 'breakdown-label'; lbl.textContent = label;
      const bar = document.createElement('div'); bar.className = 'breakdown-bar';
      const fill = document.createElement('div'); fill.className = `breakdown-fill ${cls}`; fill.style.width = `${pct(byPriority[key], total)}%`;
      bar.appendChild(fill);
      const val = document.createElement('span'); val.className = 'breakdown-val'; val.textContent = byPriority[key];
      row.append(lbl, bar, val); wrap.appendChild(row);
    });
    return wrap;
  }
}

class TypeWidget extends BaseWidget {
  constructor() { super({ id: 'types', title: 'By Type', cols: 2 }); }
  render({ total, byType }) {
    const wrap = document.createElement('div'); wrap.className = 'w-breakdown';
    [{ key: 'task', label: 'Task', cls: 'type-task' }, { key: 'bug', label: 'Bug', cls: 'type-bug' }, { key: 'enhancement', label: 'Enhancement', cls: 'type-enhancement' }, { key: 'story', label: 'Story', cls: 'type-story' }].forEach(({ key, label, cls }) => {
      const row = document.createElement('div'); row.className = 'breakdown-row';
      const dot = document.createElement('span'); dot.className = `type-dot ${key}`;
      const lbl = document.createElement('span'); lbl.className = 'breakdown-label'; lbl.textContent = label;
      const bar = document.createElement('div'); bar.className = 'breakdown-bar';
      const fill = document.createElement('div'); fill.className = `breakdown-fill ${cls}`; fill.style.width = `${pct(byType[key], total)}%`;
      bar.appendChild(fill);
      const val = document.createElement('span'); val.className = 'breakdown-val'; val.textContent = byType[key];
      row.append(dot, lbl, bar, val); wrap.appendChild(row);
    });
    return wrap;
  }
}

class ProjectHealthWidget extends BaseWidget {
  constructor() { super({ id: 'proj-health', title: 'Project Health', cols: 2 }); }
  render({ projects: projs }) {
    const wrap = document.createElement('div');
    if (projs.length === 0) { wrap.className = 'w-empty'; wrap.textContent = 'No projects yet'; return wrap; }
    wrap.className = 'w-projects';
    projs.forEach(p => {
      const done = p.tasks.filter(t => t.status === 'done').length;
      const total = p.tasks.length;
      const donePct = pct(done, total);
      const row = document.createElement('div'); row.className = 'proj-health-row';
      const icon = document.createElement('span'); icon.className = 'proj-health-icon'; icon.style.background = p.color; icon.textContent = initials(p.name);
      const info = document.createElement('div'); info.className = 'proj-health-info';
      const nameRow = document.createElement('div'); nameRow.className = 'proj-health-name-row';
      const name = document.createElement('span'); name.className = 'proj-health-name'; name.textContent = p.name;
      const count = document.createElement('span'); count.className = 'proj-health-count'; count.textContent = `${done}/${total} · ${donePct}%`;
      nameRow.append(name, count);
      const bar = document.createElement('div'); bar.className = 'proj-health-bar';
      const fill = document.createElement('div'); fill.className = 'proj-health-fill'; fill.style.width = `${donePct}%`; fill.style.background = p.color;
      bar.appendChild(fill); info.append(nameRow, bar); row.append(icon, info); wrap.appendChild(row);
    });
    return wrap;
  }
}

class OverdueWidget extends BaseWidget {
  constructor() { super({ id: 'overdue', title: 'Overdue', cols: 3 }); }
  render({ overdue }) {
    const count = overdue.length;
    this._head.innerHTML = count > 0
      ? `Overdue <span class="widget-head-badge danger">${count}</span>`
      : 'Overdue';
    const wrap = document.createElement('div');
    if (count === 0) { wrap.className = 'w-empty w-good'; wrap.textContent = '✓ No overdue issues'; return wrap; }
    wrap.className = 'w-issue-list';
    overdue.forEach(t => wrap.appendChild(buildIssueRow(t, { showDue: true, clickable: true })));
    return wrap;
  }
}

class DueSoonWidget extends BaseWidget {
  constructor() { super({ id: 'due-soon', title: 'Due Soon', cols: 3 }); }
  render({ dueSoon }) {
    const count = dueSoon.length;
    this._head.innerHTML = count > 0
      ? `Due Soon <span class="widget-head-badge warn">${count}</span>`
      : 'Due Soon';
    const wrap = document.createElement('div');
    if (count === 0) { wrap.className = 'w-empty'; wrap.textContent = 'Nothing due in the next 3 days'; return wrap; }
    wrap.className = 'w-issue-list';
    dueSoon.forEach(t => wrap.appendChild(buildIssueRow(t, { showDue: true, clickable: true })));
    return wrap;
  }
}

class RecentWidget extends BaseWidget {
  constructor() { super({ id: 'recent', title: 'Recent Activity', cols: 6 }); }
  render({ recent }) {
    const wrap = document.createElement('div');
    if (recent.length === 0) { wrap.className = 'w-empty'; wrap.textContent = 'No activity yet'; return wrap; }
    wrap.className = 'w-recent';
    recent.forEach(t => wrap.appendChild(buildIssueRow(t, { showDate: true, clickable: true })));
    return wrap;
  }
}

// ── Boot ───────────────────────────────────────────────

const createPopup = new BasePopup('overlay');
const detailPopup = new BasePopup('detailOverlay');

dashboard = new BaseDashboard('dashWrap');
dashboard.register(new TotalIssuesWidget())
         .register(new StatusBarWidget())
         .register(new PriorityWidget())
         .register(new TypeWidget())
         .register(new ProjectHealthWidget())
         .register(new OverdueWidget())
         .register(new DueSoonWidget())
         .register(new RecentWidget());

(async () => {
  const user = await checkAuth(); // redirects to /login.html if no session
  if (!user) return;

  window._supaUser = user;
  currentUser      = buildUser(user.user_metadata?.full_name || user.email);

  renderProfileUI();

  try {
    await dbLoad();
  } catch (err) {
    console.error('Failed to load data:', err);
  }

  render();
})();

// ── Event listeners ────────────────────────────────────

document.getElementById('logoutBtn').addEventListener('click', logoutUser);

document.getElementById('newProjectForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = document.getElementById('projectInput');
  const name  = input.value.trim();
  if (!name) { shake(input); return; }
  createProject(name);
  input.value = '';
});

document.getElementById('projectNav').addEventListener('click', e => {
  const delBtn = e.target.closest('.nav-del');
  if (delBtn) { removeProject(delBtn.dataset.projectId); return; }
  const item = e.target.closest('.nav-item');
  if (item) setActive(item.dataset.projectId);
});

document.getElementById('overviewNav').addEventListener('click', () => { showView('overview'); closeSidebar(); });
document.getElementById('createBtn').addEventListener('click', () => openModal());
document.getElementById('hamburger').addEventListener('click', openSidebar);
document.getElementById('backdrop').addEventListener('click', closeSidebar);

// ── Create modal ───────────────────────────────────────

document.getElementById('modalClose').addEventListener('click', closeModal);
document.getElementById('modalCancel').addEventListener('click', closeModal);
document.getElementById('modalCreate').addEventListener('click', submitModal);
document.getElementById('issueInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitModal(); });

document.getElementById('typePicker').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn[data-type]'); if (!btn) return;
  modal.type = btn.dataset.type;
  document.querySelectorAll('#typePicker .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('priorityPicker').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn[data-priority]'); if (!btn) return;
  modal.priority = btn.dataset.priority;
  document.querySelectorAll('#priorityPicker .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('statusPicker').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn[data-status]'); if (!btn) return;
  modal.status = btn.dataset.status;
  document.querySelectorAll('#statusPicker .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('dueDateInput').addEventListener('change', e => { modal.dueDate = e.target.value; });

// ── Detail modal ───────────────────────────────────────

document.getElementById('detailClose').addEventListener('click',  () => detailPopup.close());
document.getElementById('detailCancel').addEventListener('click', () => detailPopup.close());
document.getElementById('detailSave').addEventListener('click', saveDetail);
document.getElementById('detailDelete').addEventListener('click', () => {
  if (detailTaskId === null) return;
  removeIssue(detailTaskId);
  detailPopup.close();
});
document.getElementById('detailMoveBack').addEventListener('click', () => {
  const p = getActive();
  if (!p || detailTaskId === null) return;
  const task = p.tasks.find(t => t.id === detailTaskId);
  if (!task) return;
  task.status    = 'progress';
  task.updatedAt = Date.now();
  dbUpdateTask(task).catch(e => console.error('moveBack:', e));
  renderBoard();
  detailPopup.close();
});
document.getElementById('detailSummary').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveDetail(); } });

document.getElementById('detailTypePicker').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn[data-type]'); if (!btn) return;
  detailState.type = btn.dataset.type;
  document.querySelectorAll('#detailTypePicker .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('detailPriorityPicker').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn[data-priority]'); if (!btn) return;
  detailState.priority = btn.dataset.priority;
  document.querySelectorAll('#detailPriorityPicker .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('detailStatusPicker').addEventListener('click', e => {
  const btn = e.target.closest('.seg-btn[data-status]'); if (!btn) return;
  detailState.status = btn.dataset.status;
  document.querySelectorAll('#detailStatusPicker .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
});
document.getElementById('detailDueDate').addEventListener('change', e => { detailState.dueDate = e.target.value; });

// ── Comments ───────────────────────────────────────────

document.getElementById('commentSubmit').addEventListener('click', async () => {
  const text = document.getElementById('commentInput').value.trim();
  if (!text) { shake(document.getElementById('commentInput')); return; }
  const btn = document.getElementById('commentSubmit');
  btn.disabled = true;
  await addComment(detailTaskId, text);
  btn.disabled = false;
  document.getElementById('commentInput').value = '';
  document.getElementById('commentRequiredMsg').style.display = 'none';
});
document.getElementById('commentDiscard').addEventListener('click', () => {
  document.getElementById('commentInput').value = '';
  document.getElementById('commentRequiredMsg').style.display = 'none';
});
document.getElementById('commentsList').addEventListener('click', e => {
  const btn = e.target.closest('.comment-del');
  if (!btn) return;
  removeComment(detailTaskId, btn.dataset.commentId); // UUID string — no Number() cast
});

// ── Board delegation ───────────────────────────────────

document.getElementById('board').addEventListener('click', e => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action, taskId, dir } = target.dataset;

  if (action === 'delete-issue') {
    removeIssue(taskId);
  } else if (action === 'discard-issue') {
    discardIssue(taskId);
  } else if (action === 'restore-issue') {
    restoreIssue(taskId);
  } else if (action === 'move-issue') {
    const t = getActive()?.tasks.find(t => t.id === taskId);
    if (Number(dir) === 1 && t?.status === 'progress' && !(t.comments?.length)) {
      openDetail(taskId);
      setTimeout(() => {
        document.getElementById('commentRequiredMsg').style.display = '';
        document.getElementById('commentInput').focus();
        document.getElementById('commentInput').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 80);
      return;
    }
    moveIssue(taskId, Number(dir));
  } else if (action === 'open-detail') {
    openDetail(taskId);
  }
});
