// Reads a Moodle course the same way the browser does: with the user's own
// logged-in session. No passwords, tokens or web-service setup involved.
//
// Structure comes from Moodle's own course-format state (Moodle 4.0+), falling
// back to reading the course page HTML on older sites. Files come from each
// activity's page.

import { cleanText, decodeEntities, pool, isAbort } from './util.js';
import { collectFiles, parsePluginfile, isCourseMaterial, subPathFor } from './pluginfile.js';

export class MoodleError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'MoodleError';
    this.code = code;
  }
}

const LOGIN_PATH = /\/(login\/index\.php|login\/|auth\/[^/]+\/login|auth\/[^/]+\/index\.php)/;

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

export class MoodleClient {
  constructor(site, { signal } = {}) {
    this.site = site.replace(/\/+$/, '');
    this.origin = new URL(this.site).origin;
    this.signal = signal;
    this.sesskey = null;
    this.cache = new Map();
  }

  url(path, params = {}) {
    const u = new URL(`${this.site}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
  }

  isLoginUrl(url) {
    try {
      const u = new URL(url);
      if (u.origin !== this.origin) return true; // bounced to an SSO provider
      return LOGIN_PATH.test(u.pathname.slice(new URL(this.site).pathname.replace(/\/$/, '').length));
    } catch {
      return false;
    }
  }

  async fetch(url, init = {}, attempt = 0) {
    if (this.signal?.aborted) throw abortError();
    try {
      return await fetch(url, { credentials: 'include', cache: 'no-cache', signal: this.signal, ...init });
    } catch (err) {
      if (isAbort(err) || attempt >= 2) throw err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      return this.fetch(url, init, attempt + 1);
    }
  }

  /** GET an HTML page and parse it. Cached for the lifetime of the client. */
  page(url) {
    if (!this.cache.has(url)) {
      const p = this.#loadPage(url);
      this.cache.set(url, p);
      p.catch(() => this.cache.delete(url));
    }
    return this.cache.get(url);
  }

  async #loadPage(url) {
    const res = await this.fetch(url);
    if (this.isLoginUrl(res.url)) {
      res.body?.cancel();
      throw new MoodleError('Your Moodle session has ended. Log in to Moodle in this browser, then try again.', 'login');
    }
    if (!res.ok) {
      res.body?.cancel();
      throw new MoodleError(`Moodle answered ${res.status} for ${url}`, `http${res.status}`);
    }
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) {
      res.body?.cancel();
      return { url: res.url, doc: null, html: '', type };
    }
    const html = await res.text();
    this.learnSesskey(html);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('form#login input[name="logintoken"], form.login-form input[name="logintoken"]')
        && !doc.querySelector('a[href*="login/logout.php"]')) {
      throw new MoodleError('Your Moodle session has ended. Log in to Moodle in this browser, then try again.', 'login');
    }
    return { url: res.url, doc, html, type };
  }

  learnSesskey(html) {
    const m = /"sesskey":"([A-Za-z0-9]+)"/.exec(html) || /logout\.php\?sesskey=([A-Za-z0-9]+)/.exec(html);
    if (m) this.sesskey = m[1];
  }

  /** Call one of Moodle's AJAX web services (the ones the Moodle UI itself uses). */
  async ajax(methodname, args) {
    if (!this.sesskey) await this.page(this.url('my/'));
    if (!this.sesskey) throw new MoodleError('Could not find a Moodle session key. Are you logged in?', 'login');
    const res = await this.fetch(this.url('lib/ajax/service.php', { sesskey: this.sesskey, info: methodname }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    });
    if (this.isLoginUrl(res.url)) throw new MoodleError('Your Moodle session has ended.', 'login');
    let data;
    try { data = await res.json(); } catch { throw new MoodleError(`${methodname}: not a JSON reply`, 'ajax'); }
    const r = Array.isArray(data) ? data[0] : data;
    if (!r || r.error) {
      const ex = r?.exception ?? r;
      const code = ex?.errorcode ?? 'ajax';
      if (/requirelogin|servicerequireslogin|invalidsesskey/.test(code)) {
        throw new MoodleError('Your Moodle session has ended. Log in again, then retry.', 'login');
      }
      throw new MoodleError(ex?.message || `${methodname} failed`, code);
    }
    return r.data;
  }
}

// ---------------------------------------------------------------------------
// Courses list (for when the button is clicked outside a course)

export async function listCourses(client) {
  try {
    const data = await client.ajax('core_course_get_enrolled_courses_by_timeline_classification', {
      offset: 0, limit: 0, classification: 'all', sort: 'fullname',
    });
    return (data.courses || []).map((c) => ({
      id: String(c.id),
      name: cleanText(decodeEntities(c.fullname)),
      shortname: cleanText(decodeEntities(c.shortname)),
      category: cleanText(decodeEntities(c.coursecategory || '')),
      image: c.courseimage && !String(c.courseimage).startsWith('data:') ? c.courseimage : null,
    }));
  } catch (err) {
    if (err.code === 'login' || isAbort(err)) throw err;
    // Older Moodle: scrape the dashboard / my courses page.
    const page = await client.page(client.url('my/'));
    const seen = new Map();
    for (const a of page.doc?.querySelectorAll('a[href*="/course/view.php?id="]') ?? []) {
      const id = new URL(a.getAttribute('href'), page.url).searchParams.get('id');
      const name = cleanText(a.textContent);
      if (id && id !== '1' && name && !seen.has(id)) seen.set(id, { id, name, shortname: '', category: '' });
    }
    return [...seen.values()];
  }
}

// ---------------------------------------------------------------------------
// Course crawl

export function mainRegion(doc) {
  return doc?.querySelector('#region-main, [role="main"], #page-content, #content') ?? doc?.body ?? null;
}

function courseNameFrom(doc) {
  const h = doc?.querySelector('.page-header-headings h1, #page-header h1, .page-context-header h1, header h1, h1');
  const fromH = cleanText(h?.textContent);
  if (fromH) return fromH;
  const t = cleanText(doc?.title ?? '');
  return cleanText(t.replace(/^[^:]{0,20}:\s*/, '').split(' | ')[0]) || 'Moodle course';
}

function textOf(el) {
  if (!el) return '';
  const c = el.cloneNode(true);
  c.querySelectorAll('.accesshide, .sr-only, .visually-hidden').forEach((n) => n.remove());
  return cleanText(c.textContent);
}

function normalizeCm(c) {
  return {
    id: String(c.id),
    module: c.module,
    modname: c.modname || c.module,
    name: cleanText(decodeEntities(c.name)) || `${c.modname || c.module} ${c.id}`,
    url: c.url || null,
    available: c.uservisible !== false,
  };
}

/** Moodle 4.0+: the course format's state has every section and activity, whatever the layout. */
async function stateStructure(client, courseId) {
  const raw = await client.ajax('core_courseformat_get_state', { courseid: Number(courseId) });
  const st = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const cms = new Map(st.cm.map((c) => [String(c.id), c]));
  const byId = new Map(st.section.map((s) => [String(s.id), s]));
  const delegated = new Map();
  for (const s of st.section) if (s.component && s.itemid != null) delegated.set(String(s.itemid), s);

  const build = (s) => ({
    id: String(s.id),
    number: s.number ?? s.section,
    title: cleanText(decodeEntities(s.title)) || `Section ${s.number ?? s.section}`,
    url: s.sectionurl || null,
    files: [],
    links: [],
    entries: (s.cmlist || []).map(String).map((cmid) => {
      const cm = cms.get(cmid);
      if (!cm) return null;
      const sub = delegated.get(cmid);
      if (sub) return { type: 'subsection', cmid, available: cm.uservisible !== false, ...build(sub) };
      return { type: 'cm', cm: normalizeCm(cm), files: [], links: [] };
    }).filter(Boolean),
  });

  const order = (st.course?.sectionlist || st.section.map((s) => s.id)).map(String);
  return order.map((id) => byId.get(id)).filter((s) => s && !s.component).map(build);
}

/** Older Moodle (3.x) or a format the state call can't describe: read the course page. */
export function htmlSections(doc, baseUrl) {
  const sections = [];
  const els = [...doc.querySelectorAll('li.section[id^="section-"], [data-for="section"]')]
    .filter((el) => !el.parentElement?.closest('li.section[id^="section-"], [data-for="section"]'));
  for (const el of els) {
    const number = Number(el.getAttribute('data-number') ?? el.id.replace('section-', '')) || 0;
    const title = cleanText(el.getAttribute('data-sectionname'))
      || cleanText(el.getAttribute('aria-label'))
      || textOf(el.querySelector('.sectionname, h3'))
      || (number === 0 ? 'General' : `Section ${number}`);
    const entries = [];
    for (const li of el.querySelectorAll('li.activity[id^="module-"], [data-for="cmitem"]')) {
      if (li.parentElement?.closest('li.activity[id^="module-"], [data-for="cmitem"]')) continue;
      const id = li.getAttribute('data-id') || li.id.replace('module-', '');
      const module = (/(?:^|\s)modtype_(\w+)/.exec(li.className) || [])[1] || 'unknown';
      const link = li.querySelector('a[href*="/mod/"][href*="view.php?id="]');
      const name = cleanText(li.getAttribute('data-activityname'))
        || textOf(li.querySelector('.instancename, .activityname'))
        || textOf(link) || `${module} ${id}`;
      entries.push({
        type: 'cm',
        cm: {
          id, module, modname: module, name,
          url: link ? new URL(link.getAttribute('href'), baseUrl).toString() : null,
          available: module === 'label' || !!link,
        },
        files: [], links: [],
      });
    }
    sections.push({ id: el.getAttribute('data-id') || `num:${number}`, number, title, url: null, files: [], links: [], entries });
  }
  return sections;
}

async function htmlStructure(client, page, courseId) {
  let sections = htmlSections(page.doc, page.url);
  // "One section per page" layouts only list section links on the main page.
  const sectionLinks = new Map();
  for (const a of page.doc.querySelectorAll('a[href*="course/view.php"][href*="section="]')) {
    const u = new URL(a.getAttribute('href'), page.url);
    if (u.searchParams.get('id') === String(courseId) && u.searchParams.get('section')) {
      sectionLinks.set(u.searchParams.get('section'), u.toString());
    }
  }
  const empty = sections.filter((s) => s.number > 0 && s.entries.length === 0);
  if (sectionLinks.size && (sections.length <= 1 || empty.length >= sections.length - 1)) {
    const extra = await pool([...sectionLinks.values()], 3, (u) => client.page(u), client.signal);
    const byNum = new Map(sections.map((s) => [s.number, s]));
    for (const p of extra) {
      for (const s of htmlSections(p.doc, p.url)) {
        const have = byNum.get(s.number);
        if (!have || have.entries.length === 0) byNum.set(s.number, s);
      }
    }
    sections = [...byNum.values()].sort((a, b) => a.number - b.number);
  }
  return { sections, pages: [page] };
}

function walk(sections, fn) {
  for (const s of sections) {
    fn(s, null);
    (function inner(container) {
      for (const e of container.entries) {
        if (e.type === 'subsection') { fn(e, container); inner(e); } else fn(e, container);
      }
    })(s);
  }
}

/**
 * Files and links that sit on the course page itself: section summaries, text
 * & media areas (labels), inline folders and activity descriptions.
 */
function scanCoursePages(pages, sections, origin) {
  const cmById = new Map();
  const secById = new Map();
  walk(sections, (e) => {
    if (e.type === 'cm') cmById.set(e.cm.id, e);
    else { secById.set(String(e.id), e); if (e.number != null) secById.set(`num:${e.number}`, e); }
  });

  const CM_SEL = '[data-for="cmitem"], li.activity[id^="module-"]';
  const SEC_SEL = '[data-for="section"], li.section[id^="section-"]';
  const cmIdOf = (el) => el.getAttribute('data-id') || el.id.replace('module-', '');
  const secOf = (el) => secById.get(el.getAttribute('data-id'))
    || secById.get(`num:${el.getAttribute('data-number') ?? el.id.replace('section-', '')}`);

  for (const page of pages) {
    if (!page.doc) continue;
    for (const el of page.doc.querySelectorAll('a[href], source[src], video[src], audio[src], object[data], embed[src], iframe[src]')) {
      const raw = el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('data');
      // Innermost owner wins: an activity inside a sub-section belongs to that
      // activity, a sub-section's own summary belongs to the sub-section.
      let cmEl = el.closest(CM_SEL);
      const secEl = el.closest(SEC_SEL);
      if (cmEl && secEl && cmEl.contains(secEl)) cmEl = null;
      const cmEntry = cmEl ? cmById.get(cmIdOf(cmEl)) : null;
      const section = !cmEntry && secEl ? secOf(secEl) : null;

      const f = parsePluginfile(raw, page.url);
      if (f) {
        if (!isCourseMaterial(f)) continue;
        if (cmEntry) pushUnique(cmEntry.files, f);
        else if (section) pushUnique(section.files, f);
        continue;
      }
      // External links and embedded videos in section summaries or text & media areas.
      const link = linkFrom(el, page.url, origin);
      if (!link) continue;
      if (cmEntry?.cm.module === 'label') pushUniqueLink(cmEntry.links, link);
      else if (section) pushUniqueLink(section.links, link);
    }
  }
}

/** An outside web address for a link or an embedded player, or null. */
export function externalUrl(raw, base, origin) {
  let u;
  try { u = new URL(raw, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.origin === origin) return null;
  if (u.hostname === 'download.moodle.org') return null; // "Get the mobile app"
  let m;
  // Embedded players become their normal pages, which open anywhere.
  if (/^(www\.)?youtube(-nocookie)?\.com$/.test(u.hostname) && (m = /^\/embed\/([\w-]{6,})/.exec(u.pathname))) {
    return `https://www.youtube.com/watch?v=${m[1]}`;
  }
  if (u.hostname === 'player.vimeo.com' && (m = /^\/video\/(\d+)/.exec(u.pathname))) return `https://vimeo.com/${m[1]}`;
  return u.toString();
}

function linkFrom(el, base, origin) {
  if (el.tagName !== 'A' && el.tagName !== 'IFRAME') return null;
  const url = externalUrl(el.getAttribute('href') ?? el.getAttribute('src'), base, origin);
  if (!url) return null;
  const name = el.tagName === 'IFRAME'
    ? cleanText(el.getAttribute('title')) || 'Embedded video'
    : textOf(el) || cleanText(el.getAttribute('title')) || new URL(url).hostname;
  return { name, url };
}

/** External links inside an activity's content (pages, books). */
function collectLinks(root, base, origin) {
  const out = [];
  for (const el of root?.querySelectorAll('a[href], iframe[src]') ?? []) {
    if (el.closest('footer, #page-footer, nav, .breadcrumb, .activity-header, .activity-navigation')) continue;
    const link = linkFrom(el, base, origin);
    if (link) pushUniqueLink(out, link);
  }
  return out;
}

function pushUnique(list, f) {
  if (!list.some((x) => x.key === f.key)) list.push(f);
}
function pushUniqueLink(list, l) {
  if (!list.some((x) => x.url === l.url)) list.push(l);
}

// ---------------------------------------------------------------------------
// Per-activity handlers

const filesOf = (page, accept) => collectFiles(mainRegion(page.doc), page.url, { accept });

const HANDLERS = {
  async resource(client, e) {
    const page = await client.page(client.url('mod/resource/view.php', { id: e.cm.id, forceview: 1 }));
    let files = page.doc ? filesOf(page, (f) => f.component === 'mod_resource' && f.filearea === 'content') : [];
    if (!files.length) {
      // Last resort: follow the redirect Moodle uses for "force download" and read the final URL.
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      client.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        const res = await fetch(client.url('mod/resource/view.php', { id: e.cm.id, redirect: 1 }), {
          credentials: 'include', signal: ctrl.signal,
        });
        const f = parsePluginfile(res.url);
        if (f) files = [f];
      } finally {
        ctrl.abort();
        client.signal?.removeEventListener('abort', onAbort);
      }
    }
    e.files.push(...files.slice(0, 1).filter((f) => !e.files.some((x) => x.key === f.key)));
  },

  async folder(client, e) {
    const page = await client.page(client.url('mod/folder/view.php', { id: e.cm.id }));
    for (const f of filesOf(page, (x) => x.component === 'mod_folder')) pushUnique(e.files, f);
  },

  async url(client, e) {
    const page = await client.page(client.url('mod/url/view.php', { id: e.cm.id, forceview: 1 }));
    const doc = page.doc;
    let href = doc?.querySelector('.urlworkaround a[href]')?.getAttribute('href')
      || doc?.querySelector('#resourceobject[src], iframe#resourceobject')?.getAttribute('src')
      || doc?.querySelector('object#resourceobject')?.getAttribute('data')
      || doc?.querySelector('frameset frame:last-child')?.getAttribute('src');
    let url;
    try { url = href ? new URL(href, page.url).toString() : null; } catch { url = null; }
    if (!url) url = client.url('mod/url/view.php', { id: e.cm.id, redirect: 1 });
    const desc = textOf(doc?.querySelector('#intro, .activity-description'));
    e.links.push({ name: e.cm.name, url, description: desc.slice(0, 400) });
  },

  async assign(client, e) {
    const page = await client.page(client.url('mod/assign/view.php', { id: e.cm.id }));
    const accept = (f) => (f.component === 'mod_assign' && /^(intro|introattachment|activityattachment)$/.test(f.filearea))
      || /^assign(submission|feedback)_/.test(f.component);
    for (const f of filesOf(page, accept)) pushUnique(e.files, f);
  },

  async forum(client, e, ctx) {
    const first = await client.page(client.url('mod/forum/view.php', { id: e.cm.id }));
    const pages = [first];
    let last = 0;
    for (const a of first.doc?.querySelectorAll('a[href*="mod/forum/view.php"]') ?? []) {
      const u = new URL(a.getAttribute('href'), first.url);
      const p = Number(u.searchParams.get('p') ?? u.searchParams.get('page'));
      if (u.searchParams.get('id') === e.cm.id && p > last) last = p;
    }
    for (let p = 1; p <= Math.min(last, 49); p++) {
      pages.push(await client.page(client.url('mod/forum/view.php', { id: e.cm.id, p })));
    }
    const discussions = new Map();
    for (const page of pages) {
      for (const a of page.doc?.querySelectorAll('a[href*="mod/forum/discuss.php?d="]') ?? []) {
        const u = new URL(a.getAttribute('href'), page.url);
        if (u.searchParams.has('parent')) continue;
        const d = u.searchParams.get('d');
        const subject = cleanText(a.getAttribute('title') || a.getAttribute('aria-label') || a.textContent);
        if (d && !discussions.has(d)) discussions.set(d, subject || `Discussion ${d}`);
        else if (d && subject && discussions.get(d).startsWith('Discussion ')) discussions.set(d, subject);
      }
    }
    const list = [...discussions.entries()].slice(0, 1000);
    ctx.grow(list.length);
    await pool(list, 3, async ([d, subject]) => {
      try {
        const page = await client.page(client.url('mod/forum/discuss.php', { d }));
        for (const f of filesOf(page, (x) => x.component === 'mod_forum')) {
          if (!e.files.some((x) => x.key === f.key)) e.files.push({ ...f, sub: [subject] });
        }
      } finally {
        ctx.tick(subject);
      }
    }, client.signal);
  },

  async page(client, e) {
    const page = await client.page(client.url('mod/page/view.php', { id: e.cm.id }));
    for (const f of filesOf(page, (x) => x.component === 'mod_page')) pushUnique(e.files, f);
    for (const l of collectLinks(mainRegion(page.doc), page.url, client.origin)) pushUniqueLink(e.links, l);
  },

  async book(client, e) {
    let page;
    try {
      page = await client.page(client.url('mod/book/tool/print/index.php', { id: e.cm.id }));
    } catch (err) {
      if (err.code === 'login' || isAbort(err)) throw err;
      page = await client.page(client.url('mod/book/view.php', { id: e.cm.id }));
    }
    for (const f of filesOf(page, (x) => x.component === 'mod_book')) pushUnique(e.files, f);
    for (const l of collectLinks(mainRegion(page.doc), page.url, client.origin)) pushUniqueLink(e.links, l);
  },
};

// Which handlers a scan runs, given the user's "include" settings.
function enabledModules(opts) {
  const m = new Set(['resource', 'folder', 'page', 'book']);
  if (opts.includeLinks) m.add('url');
  if (opts.includeAssign) m.add('assign');
  if (opts.includeForum) m.add('forum');
  return m;
}

/**
 * Crawl one course. `onProgress({phase, done, total, label})` is called as it goes.
 * Returns {site, id, name, url, sections}.
 */
export async function crawlCourse(client, courseId, opts, onProgress = () => {}) {
  const courseUrl = client.url('course/view.php', { id: courseId });
  onProgress({ phase: 'structure', label: 'Reading the course page' });
  const page = await client.page(courseUrl);
  if (/\/enrol\/index\.php/.test(new URL(page.url).pathname)) {
    throw new MoodleError("You're not enrolled in this course, so Moodle won't show its content.", 'notenrolled');
  }
  if (!page.doc) throw new MoodleError('That course page did not load as a web page.', 'notcourse');
  const name = courseNameFrom(page.doc);

  let sections;
  const pages = [page];
  try {
    sections = await stateStructure(client, courseId);
    // Layouts that show one section per page don't render every section on the
    // main page; fetch the missing ones so their summaries and labels count too.
    const rendered = new Set([...page.doc.querySelectorAll('[data-for="section"][data-id]')]
      .map((el) => el.getAttribute('data-id')));
    const missing = [];
    walk(sections, (s) => { if (s.type !== 'cm' && s.url && !rendered.has(s.id)) missing.push(s.url); });
    if (missing.length) {
      onProgress({ phase: 'structure', label: `Opening ${missing.length} section pages` });
      pages.push(...await pool([...new Set(missing)], 3, async (u) => {
        try { return await client.page(u); } catch (err) { if (err.code === 'login' || isAbort(err)) throw err; return { doc: null }; }
      }, client.signal));
    }
  } catch (err) {
    if (err.code === 'login' || isAbort(err)) throw err;
    ({ sections } = await htmlStructure(client, page, courseId));
  }

  scanCoursePages(pages, sections, client.origin);

  const enabled = enabledModules(opts);
  const work = [];
  walk(sections, (e) => {
    if (e.type === 'cm' && e.cm.available && enabled.has(e.cm.module)) work.push(e);
  });

  // Course-page files only count for activity types the user wants.
  walk(sections, (e) => {
    if (e.type === 'cm' && !enabled.has(e.cm.module) && e.cm.module !== 'label') e.files.length = 0;
  });

  let done = 0;
  let total = work.length;
  const ctx = {
    grow: (n) => { total += n; onProgress({ phase: 'activities', done, total }); },
    tick: (label) => { done++; onProgress({ phase: 'activities', done, total, label }); },
  };
  onProgress({ phase: 'activities', done, total });
  await pool(work, 4, async (e) => {
    try {
      await HANDLERS[e.cm.module](client, e, ctx);
    } catch (err) {
      if (err.code === 'login' || isAbort(err)) throw err;
      e.error = err.message || String(err);
    } finally {
      ctx.tick(e.cm.name);
    }
  }, client.signal);

  // Text & media areas have no folder of their own: hoist their files and
  // links into the section they sit in.
  walk(sections, (e, parent) => {
    if (e.type === 'cm' && e.cm.module === 'label' && parent) {
      for (const f of e.files) pushUnique(parent.files, f);
      for (const l of e.links) pushUniqueLink(parent.links, l);
      e.files = [];
      e.links = [];
    }
  });

  // A file that belongs to an activity shouldn't be saved a second time loose in the section.
  const owned = new Set();
  walk(sections, (e) => { if (e.type === 'cm') e.files.forEach((f) => owned.add(f.key)); });
  walk(sections, (e) => { if (e.type !== 'cm') e.files = e.files.filter((f) => !owned.has(f.key)); });

  // Sub-folders (folder trees, "My submission", "Feedback", forum discussions).
  walk(sections, (e) => {
    for (const f of e.files) if (!f.sub) f.sub = subPathFor(f);
  });

  return { site: client.site, origin: client.origin, id: String(courseId), name, url: courseUrl, sections };
}
