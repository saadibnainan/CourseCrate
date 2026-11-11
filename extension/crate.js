import { MoodleClient, crawlCourse, listCourses } from './lib/moodle.js';
import { buildPlan, fileIdsUnder } from './lib/plan.js';
import { saveToFolders, saveAsZip } from './lib/download.js';
import { renderLinksPage } from './lib/linkspage.js';
import {
  loadSettings, saveSettings, SCAN_KEYS, loadSynced, recordSynced, forgetSynced,
  rememberCourse, recentCourses,
} from './lib/settings.js';
import { formatBytes, isAbort, todayStamp, sanitizeSegment } from './lib/util.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const state = {
  site: null,
  origin: null,
  courseId: params.get('course'),
  settings: null,
  client: null,
  course: null,
  synced: {},
  plan: null,
  selected: new Set(),
  rows: new Map(), // file id -> row element
  groups: [], // [{el, checkbox, ids}]
  running: null, // AbortController
  scanAbort: null,
  status: new Map(), // file id -> status
};

// ---------------------------------------------------------------------------
// views

function show(id) {
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== id;
}

function showError(title, text, { login = false, retry = start } = {}) {
  $('#error-title').textContent = title;
  $('#error-text').textContent = text;
  const a = $('#error-login');
  a.hidden = !login;
  if (login) a.href = `${state.site}/login/index.php`;
  $('#error-retry').onclick = () => retry();
  show('view-error');
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null) e.append(kid);
  return e;
}

// ---------------------------------------------------------------------------
// start

async function start() {
  state.settings = await loadSettings();
  const site = params.get('site');
  if (!site || !/^https?:\/\//.test(site)) return showStart();

  state.site = site.replace(/\/+$/, '');
  state.origin = new URL(state.site).origin;
  $('#site-chip').textContent = new URL(state.site).host;
  $('#site-chip').hidden = false;

  const pattern = `${state.origin}/*`;
  if (!(await browser.permissions.contains({ origins: [pattern] }))) {
    $('#perm-host').textContent = new URL(state.site).host;
    $('#perm-btn').onclick = async () => {
      const ok = await browser.permissions.request({ origins: [pattern] });
      if (ok) start();
    };
    return show('view-permission');
  }

  if (!state.courseId) return showCourses();
  return scan();
}

async function showStart() {
  if (params.get('welcome')) $('#welcome-eyebrow').hidden = false;
  const recent = await recentCourses();
  if (recent.length) {
    const list = $('#recent-list');
    list.replaceChildren(...recent.map((r) => el('li', {},
      el('a', { href: `crate.html?${new URLSearchParams({ site: r.site, course: r.courseId })}` },
        el('span', { text: r.name }),
        el('span', { class: 'host', text: new URL(r.site).host })))));
    $('#recent').hidden = false;
  }
  show('view-start');
}

async function showCourses() {
  show('view-scan');
  $('#scan-title').textContent = 'Finding your courses…';
  $('#scan-label').textContent = ' ';
  try {
    const client = new MoodleClient(state.site);
    const courses = await listCourses(client);
    $('#courses-site').textContent = new URL(state.site).host;
    const grid = $('#course-grid');
    if (!courses.length) {
      grid.replaceChildren(el('li', { class: 'empty', text: "Moodle didn't list any courses for you. Open a course page and click the CourseCrate button there." }));
    } else {
      grid.replaceChildren(...courses.map((c) => el('li', {},
        el('a', { href: `crate.html?${new URLSearchParams({ site: state.site, course: c.id })}` },
          el('div', { class: 'cat', text: c.category || c.shortname || '' }),
          el('div', { class: 'name', text: c.name })))));
    }
    show('view-courses');
  } catch (err) {
    handleError(err, showCourses);
  }
}

function handleError(err, retry) {
  if (isAbort(err)) return;
  console.error(err);
  if (err.code === 'login') {
    showError('Log in to Moodle first', 'CourseCrate uses your normal Moodle login. Log in on this site in Firefox, then try again.', { login: true, retry });
  } else if (err.code === 'notenrolled') {
    showError('No access to this course', err.message, { retry });
  } else {
    showError('Something went wrong', err.message || String(err), { retry });
  }
}

// ---------------------------------------------------------------------------
// scan

async function scan({ fresh = true } = {}) {
  state.scanAbort?.abort();
  const ctrl = new AbortController();
  state.scanAbort = ctrl;
  if (fresh || !state.client) state.client = new MoodleClient(state.site, { signal: ctrl.signal });
  else state.client.signal = ctrl.signal;

  show('view-scan');
  $('#scan-title').textContent = 'Reading the course…';
  $('#scan-bar').style.width = '4%';
  $('#scan-label').textContent = ' ';
  $('#scan-cancel').onclick = () => { ctrl.abort(); history.length > 1 ? history.back() : showStart(); };

  try {
    const course = await crawlCourse(state.client, state.courseId, state.settings, (p) => {
      if (p.phase === 'structure') {
        $('#scan-label').textContent = p.label;
      } else {
        $('#scan-title').textContent = `Looking inside ${p.total} activit${p.total === 1 ? 'y' : 'ies'}…`;
        $('#scan-bar').style.width = `${Math.max(4, Math.round((p.done / Math.max(1, p.total)) * 100))}%`;
        if (p.label) $('#scan-label').textContent = p.label;
      }
    });
    if (ctrl.signal.aborted) return;
    state.course = course;
    state.synced = await loadSynced(state.origin, state.courseId);
    document.title = `${course.name} · CourseCrate`;
    rememberCourse({ site: state.site, courseId: state.courseId, name: course.name });
    rebuild({ resetSelection: true });
    show('view-course');
  } catch (err) {
    handleError(err, () => scan());
  }
}

// ---------------------------------------------------------------------------
// plan + tree

function rebuild({ resetSelection = false } = {}) {
  const prev = state.plan;
  state.plan = buildPlan(state.course, state.settings, state.synced);
  const next = new Set();
  for (const [id, f] of state.plan.files) {
    const keep = !resetSelection && prev?.files.has(id);
    if (keep ? state.selected.has(id) : f.selected) next.add(id);
  }
  state.selected = next;
  renderHeader();
  renderTree();
  renderSide();
}

function renderHeader() {
  const { course, plan } = state;
  $('#course-name').textContent = course.name;
  $('#course-link').href = course.url;
  const files = [...plan.files.values()];
  const remote = files.filter((f) => !f.generated);
  const synced = remote.filter((f) => f.synced).length;
  const sections = course.sections.length;
  $('#course-stats').textContent = [
    `${sections} section${sections === 1 ? '' : 's'}`,
    `${remote.length} file${remote.length === 1 ? '' : 's'}`,
    synced ? `${synced} already downloaded` : null,
  ].filter(Boolean).join(' · ');
  $('#select-new').hidden = !synced;
}

function renderTree() {
  const tree = $('#tree');
  state.rows.clear();
  state.groups = [];
  tree.classList.toggle('show-skipped', $('#show-skipped').checked);

  const sections = state.plan.sections.filter((s) => s.children.length);
  if (sections.length && sections.every((s) => !fileIdsUnder(s).length)) $('#show-skipped').checked = true;
  tree.classList.toggle('show-skipped', $('#show-skipped').checked);
  if (!sections.length) {
    tree.replaceChildren(el('div', { class: 'empty', text: 'No downloadable files found in this course.' }));
    return;
  }
  tree.replaceChildren(...sections.map((s) => renderGroup(s, true)));
  refreshChecks();
}

function renderGroup(node, isSection) {
  const ids = fileIdsUnder(node);
  const box = el('input', { type: 'checkbox', 'aria-label': `Select ${node.label}` });
  box.disabled = !ids.length;
  box.addEventListener('change', () => {
    for (const id of ids) box.checked ? state.selected.add(id) : state.selected.delete(id);
    refreshChecks();
  });
  const wrap = el('div', {
    class: `${isSection ? 'section' : 'group'}${node.collapsed ? ' collapsed' : ''}${ids.length ? '' : ' no-files'}`,
    role: 'treeitem',
  });
  const caret = el('button', { class: 'caret', 'aria-label': 'Expand or collapse', onclick: () => wrap.classList.toggle('collapsed') });
  const fileCount = ids.length;
  const row = el('div', { class: 'row' },
    caret, box,
    isSection ? null : el('span', { class: `badge b-${(node.badge || '').toLowerCase()}`, text: node.badge }),
    el('span', { class: 'label' }, node.label),
    el('span', { class: 'count', text: fileCount ? `${fileCount} file${fileCount === 1 ? '' : 's'}` : '' }));
  const kids = el('div', { class: 'kids', role: 'group' }, node.children.map(renderNode));
  wrap.append(row, kids);
  state.groups.push({ box, ids });
  return wrap;
}

function renderNode(node) {
  if (node.type === 'group') return renderGroup(node, false);
  if (node.type === 'info') {
    return el('div', { class: `row info${node.muted ? ' muted' : ''}${node.error ? ' err' : ''}` },
      el('span', { class: 'caret-space' }),
      el('span', { class: 'caret-space' }),
      el('span', { class: 'badge', text: node.badge }),
      el('span', { class: 'label', title: node.label }, node.label, el('span', { class: 'note', text: node.note })));
  }
  const f = state.plan.files.get(node.id);
  const box = el('input', { type: 'checkbox', 'aria-label': `Select ${f.label}` });
  box.addEventListener('change', () => {
    box.checked ? state.selected.add(f.id) : state.selected.delete(f.id);
    refreshChecks();
  });
  const title = node.links
    ? node.links.map((l) => `${l.name} — ${l.url}`).join('\n')
    : f.path.join('/');
  const status = el('span', { class: `status ${state.status.get(f.id) ?? ''}` });
  const row = el('div', { class: 'row', title },
    el('span', { class: 'caret-space' }),
    box,
    el('span', { class: `badge b-${(node.badge || '').toLowerCase()}`, text: node.badge }),
    el('span', { class: 'label' }, f.label, node.note ? el('span', { class: 'note', text: node.note }) : null),
    f.synced ? el('span', { class: 'tag', text: 'Have it' }) : null,
    status);
  state.rows.set(f.id, { row, box, status });
  return row;
}

function refreshChecks() {
  for (const [id, r] of state.rows) r.box.checked = state.selected.has(id);
  for (const g of state.groups) {
    const n = g.ids.filter((id) => state.selected.has(id)).length;
    g.box.checked = n > 0 && n === g.ids.length;
    g.box.indeterminate = n > 0 && n < g.ids.length;
  }
  updateGoButton();
}

function updateGoButton() {
  const n = state.selected.size;
  const btn = $('#go');
  if (state.running) return;
  const remote = [...state.selected].filter((id) => !state.plan.files.get(id)?.generated).length;
  btn.disabled = n === 0;
  if (n === 0) {
    const synced = [...state.plan.files.values()].some((f) => f.synced);
    btn.textContent = synced ? "You're up to date" : 'Nothing selected';
  } else {
    const what = remote ? `${remote} file${remote === 1 ? '' : 's'}` : `${n} link page${n === 1 ? '' : 's'}`;
    btn.textContent = state.settings.mode === 'zip' ? `Download ${what} as ZIP` : `Download ${what}`;
  }
  $('#go-note').textContent = state.settings.mode === 'zip'
    ? 'The ZIP is built in memory. For very large courses, use Folders.'
    : 'Files stream straight into your Downloads folder.';
}

// ---------------------------------------------------------------------------
// side panel / settings

function renderSide() {
  const s = state.settings;
  for (const r of document.querySelectorAll('input[name=mode]')) r.checked = r.value === s.mode;
  for (const r of document.querySelectorAll('input[name=nameBy]')) r.checked = r.value === s.nameBy;
  for (const c of document.querySelectorAll('input[data-setting]')) c.checked = !!s[c.dataset.setting];
  const root = state.plan.root;
  const dest = s.mode === 'zip'
    ? ['Downloads', ...root.slice(0, -1), `${root[root.length - 1]}.zip`]
    : ['Downloads', ...root, ''];
  $('#dest').textContent = dest.join(' / ');
  const synced = Object.keys(state.synced).length;
  $('#sync-note').textContent = synced ? `${synced} file${synced === 1 ? '' : 's'} saved before from this course` : 'Remembers what CourseCrate saved';
  $('#forget').hidden = !synced;
  updateGoButton();
}

async function changeSetting(patch) {
  state.settings = await saveSettings(patch);
  if (!state.course) return;
  if (Object.keys(patch).some((k) => SCAN_KEYS.includes(k)) && Object.values(patch).some(Boolean)) {
    return scan({ fresh: false }); // pages already read come from the cache
  }
  rebuild();
}

function wireSide() {
  for (const r of document.querySelectorAll('input[name=mode]')) r.addEventListener('change', () => changeSetting({ mode: r.value }));
  for (const r of document.querySelectorAll('input[name=nameBy]')) r.addEventListener('change', () => changeSetting({ nameBy: r.value }));
  for (const c of document.querySelectorAll('input[data-setting]')) {
    c.addEventListener('change', () => changeSetting({ [c.dataset.setting]: c.checked }));
  }
  $('#show-skipped').addEventListener('change', (e) => $('#tree').classList.toggle('show-skipped', e.target.checked));
  $('#rescan').addEventListener('click', () => scan({ fresh: true }));
  $('#forget').addEventListener('click', async () => {
    if (!confirm('Forget which files CourseCrate already saved from this course? The next download will include everything again. Files on your disk are not touched.')) return;
    await forgetSynced(state.origin, state.courseId);
    state.synced = {};
    rebuild({ resetSelection: true });
  });
  for (const b of document.querySelectorAll('[data-select]')) {
    b.addEventListener('click', () => {
      const all = [...state.plan.files.values()];
      const mode = b.dataset.select;
      state.selected = new Set(all.filter((f) => mode === 'all' || (mode === 'new' && !f.synced)).map((f) => f.id));
      refreshChecks();
    });
  }
  $('#go').addEventListener('click', run);
  $('#run-cancel').addEventListener('click', () => state.running?.abort());
}

// ---------------------------------------------------------------------------
// download run

function setStatus(id, status, info = {}) {
  state.status.set(id, status);
  const r = state.rows.get(id);
  if (r) {
    r.status.className = `status ${status}`;
    if (info.error || info.warning) r.row.title = info.error || info.warning;
  }
}

async function run() {
  if (state.running || !state.selected.size) return;
  const s = state.settings;
  const { plan, course } = state;
  const jobs = [];
  for (const [id, f] of plan.files) {
    if (!state.selected.has(id)) continue;
    let text = null;
    let mime = null;
    if (f.generated?.kind === 'links') {
      text = renderLinksPage({ courseName: course.name, sectionTitle: f.generated.title, links: f.generated.links });
      mime = 'text/html';
    } else if (typeof f.generated === 'string') {
      text = f.generated;
      mime = 'application/octet-stream';
    }
    jobs.push({ id, key: f.key, url: f.url, path: f.path, ext: f.ext, text, mime, label: f.label });
  }

  const ctrl = new AbortController();
  state.running = ctrl;
  state.status.clear();
  for (const r of state.rows.values()) r.status.className = 'status';
  $('#go').hidden = true;
  $('#go-note').hidden = true;
  $('#result').hidden = true;
  $('#run').hidden = false;
  document.body.classList.add('running');
  const total = jobs.length;
  let finished = 0;
  const byId = new Map(jobs.map((j) => [j.id, j]));
  const onStatus = (id, status, info) => {
    if (id === '__zip__') {
      $('#run-label').textContent = 'Saving the ZIP file…';
      return;
    }
    setStatus(id, status, info);
    if (status === 'active') $('#run-label').textContent = byId.get(id)?.label ?? '';
    else finished++;
    $('#run-count').textContent = `${finished} of ${total}`;
    $('#run-bar').style.width = `${Math.round((finished / total) * 100)}%`;
  };
  const onBytes = (b) => { $('#run-bytes').textContent = formatBytes(b); };
  $('#run-count').textContent = `0 of ${total}`;
  $('#run-bytes').textContent = '';
  $('#run-bar').style.width = '0%';

  let result;
  let fatal = null;
  try {
    if (s.mode === 'zip') {
      const root = plan.root;
      const base = root[root.length - 1];
      const anySynced = Object.keys(state.synced).length && s.sync;
      const zipFile = sanitizeSegment(anySynced ? `${base} (new files ${todayStamp()}).zip` : `${base}.zip`);
      result = await saveAsZip(jobs, {
        signal: ctrl.signal,
        concurrency: s.concurrency,
        zipName: [...root.slice(0, -1), zipFile],
        innerStart: root.length - 1,
        isLoginUrl: (u) => state.client?.isLoginUrl(u),
        onStatus, onBytes,
      });
    } else {
      result = await saveToFolders(jobs, {
        signal: ctrl.signal, concurrency: s.concurrency, cleanList: s.cleanDownloadList, onStatus, onBytes,
      });
    }
  } catch (err) {
    fatal = err;
  }

  state.running = null;
  document.body.classList.remove('running');
  $('#run').hidden = true;
  $('#go').hidden = false;

  const done = result?.done ?? [];
  const toRecord = done.filter((j) => j.key).map((j) => ({ key: j.key, path: j.path.join('/') }));
  if (toRecord.length) {
    await recordSynced(state.origin, state.courseId, toRecord);
    state.synced = await loadSynced(state.origin, state.courseId);
  }

  const failed = result?.failed ?? [];
  const resultBox = $('#result');
  resultBox.hidden = false;
  const aborted = result?.aborted || isAbort(fatal);
  if (fatal && !isAbort(fatal)) {
    $('#result-text').textContent = fatal.message || String(fatal);
  } else if (aborted) {
    $('#result-text').textContent = `Stopped. ${done.length} of ${total} saved.`;
  } else {
    const where = s.mode === 'zip' ? 'into one ZIP' : 'to your Downloads folder';
    const nFiles = done.filter((j) => j.text == null).length;
    const nPages = done.length - nFiles;
    const what = [
      nFiles ? `${nFiles} file${nFiles === 1 ? '' : 's'}` : null,
      nPages ? `${nPages} link page${nPages === 1 ? '' : 's'}` : null,
    ].filter(Boolean).join(' and ') || 'nothing';
    $('#result-text').textContent = failed.length
      ? `Saved ${what} ${where}. ${failed.length} failed.`
      : `Saved ${what} ${where}.`;
  }
  $('#go-note').hidden = true;
  const firstId = result?.firstDownloadId;
  $('#show-folder').hidden = firstId == null;
  $('#show-folder').onclick = () => browser.downloads.show(firstId).catch(() => browser.downloads.showDefaultFolder());

  const fl = $('#failures');
  fl.hidden = !failed.length;
  if (failed.length) {
    $('#failures-summary').textContent = `${failed.length} file${failed.length === 1 ? '' : 's'} didn't download`;
    $('#failures-list').replaceChildren(...failed.map(({ job, error }) => el('li', {}, job.label, el('span', { text: error }))));
  }

  // Keep the tree's status marks, refresh "Have it" tags and the selection.
  const statuses = new Map(state.status);
  rebuild({ resetSelection: s.sync });
  for (const [id, st] of statuses) setStatus(id, st);
}

// ---------------------------------------------------------------------------

window.addEventListener('beforeunload', (e) => {
  if (state.running) { e.preventDefault(); e.returnValue = ''; }
});

wireSide();
start().catch((err) => handleError(err, start));
