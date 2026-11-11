// Turns a crawled course into (a) a tree for the UI and (b) a flat list of
// files with their final paths. Re-run whenever a naming setting changes; no
// network involved.

import { sanitizeSegment, splitExt, pad } from './util.js';

const NOTHING = {
  quiz: 'Quiz', choice: 'Choice', feedback: 'Feedback survey', h5pactivity: 'H5P', lesson: 'Lesson',
  wiki: 'Wiki', glossary: 'Glossary', workshop: 'Workshop', scorm: 'SCORM package', lti: 'External tool',
  data: 'Database', chat: 'Chat', hvp: 'H5P', choicegroup: 'Group choice', attendance: 'Attendance', zoom: 'Zoom', survey: 'Survey', bigbluebuttonbn: 'Video meeting', qbank: 'Question bank',
  subsection: 'Subsection',
};

// Activity types the user can switch off in the "Include" settings.
const OFF = {
  assign: (s) => !s.includeAssign,
  forum: (s) => !s.includeForum,
  url: (s) => !s.includeLinks,
};

/** FNV-1a, 32 bit. Only used to tell generated files apart. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const MODULE_LABEL = {
  resource: 'File', folder: 'Folder', url: 'Link', assign: 'Assignment', forum: 'Forum', page: 'Page',
  book: 'Book', label: 'Text', ...NOTHING,
};

/**
 * @param course  crawlCourse() result
 * @param s       settings
 * @param synced  {[key]: {path, at}} from earlier runs (sync mode)
 */
export function buildPlan(course, s, synced = {}) {
  const files = new Map(); // id -> file
  const used = new Set(); // lower-cased full paths
  const root = [s.rootFolder, course.name].map((x) => (x ? sanitizeSegment(x) : null)).filter(Boolean);

  const claim = (segs) => {
    const dir = segs.slice(0, -1);
    const [base, ext] = splitExt(segs[segs.length - 1]);
    let name = segs[segs.length - 1];
    for (let n = 2; used.has([...dir, name].join('/').toLowerCase()); n++) name = `${base} (${n})${ext}`;
    const full = [...dir, name];
    used.add(full.join('/').toLowerCase());
    return full;
  };

  const addRemote = (f, segs, label) => {
    const id = f.key;
    if (files.has(id)) return null; // same file linked twice: keep the first
    const path = claim([...root, ...segs.map((x) => sanitizeSegment(x))]);
    const prev = synced[f.key];
    const file = {
      id, key: f.key, url: f.url, path, label: label ?? f.filename,
      ext: splitExt(f.filename)[1].slice(1).toLowerCase(),
      synced: !!prev,
      selected: !(s.sync && prev),
    };
    files.set(id, file);
    return { type: 'file', id };
  };

  // Generated files (Links.html, .url shortcuts) are keyed by their content, so
  // sync mode only offers them again when their links changed.
  const addGenerated = (id, segs, label, content) => {
    const path = claim([...root, ...segs.map((x) => sanitizeSegment(x))]);
    const key = `gen:${hash(path.join('/') + JSON.stringify(content))}`;
    const prev = synced[key];
    const ext = splitExt(path[path.length - 1])[1].slice(1).toLowerCase();
    const file = { id, key, generated: content, path, label, ext, synced: !!prev, selected: !(s.sync && prev) };
    files.set(id, file);
    return { type: 'file', id };
  };

  function container(c, dirSegs, numberWidth = 2) {
    const children = [];
    const links = [];
    let n = 0;
    const prefix = () => (s.numberPrefixes ? `${pad(++n, numberWidth)} - ` : '');

    for (const e of c.entries) {
      if (e.type === 'subsection') {
        const name = `${prefix()}${e.title}`;
        const node = container(e, [...dirSegs, name]);
        node.label = e.title;
        node.badge = 'Subsection';
        if (node.children.length) children.push(node);
        continue;
      }
      const { cm } = e;
      const badge = MODULE_LABEL[cm.module] ?? cm.modname;
      if (!cm.available) {
        children.push({ type: 'info', label: cm.name, badge, note: 'Not available to you', muted: true });
        continue;
      }
      if (cm.module === 'label') continue;
      if (OFF[cm.module]?.(s)) {
        children.push({ type: 'info', label: cm.name, badge, note: 'Turned off in the Include settings', muted: true });
        continue;
      }
      if (e.error) {
        children.push({ type: 'info', label: cm.name, badge, note: `Couldn't read: ${e.error}`, error: true });
        continue;
      }
      if (cm.module === 'url') {
        for (const l of e.links) links.push(l);
        // Firefox refuses to save .url files directly, so shortcuts only go into ZIPs.
        if (s.urlShortcuts && s.mode === 'zip' && e.links[0]) {
          const segs = [...dirSegs, `${prefix()}${cm.name}.url`];
          const shortcut = `[InternetShortcut]\r\nURL=${e.links[0].url}\r\n`;
          children.push({ ...addGenerated(`url:${cm.id}`, segs, `${cm.name}.url`, shortcut), badge: 'Link' });
        }
        continue;
      }
      // Links found inside pages and books go to the section's Links.html.
      for (const l of e.links) links.push({ ...l, description: l.description || `In “${cm.name}”` });

      if (cm.module === 'resource' && e.files.length === 1) {
        const f = e.files[0];
        const [, ext] = splitExt(f.filename);
        let name = s.nameBy === 'filename' ? f.filename : cm.name;
        if (s.nameBy !== 'filename' && ext && !name.toLowerCase().endsWith(ext.toLowerCase())) name += ext;
        const node = addRemote(f, [...dirSegs, `${prefix()}${name}`], cm.name);
        if (node) children.push({ ...node, badge: (ext.slice(1) || 'file').toUpperCase() });
        continue;
      }
      if (e.files.length) {
        const folder = [...dirSegs, `${prefix()}${cm.name}`];
        const group = { type: 'group', label: cm.name, badge, children: [], collapsed: true };
        for (const f of e.files) {
          const label = [...(f.sub ?? []), f.filename].join(' / ');
          const node = addRemote(f, [...folder, ...(f.sub ?? []), f.filename], label);
          if (node) group.children.push({ ...node, badge: (splitExt(f.filename)[1].slice(1) || 'file').toUpperCase() });
        }
        if (group.children.length) children.push(group);
        continue;
      }
      const why = e.links.length
        ? (s.includeLinks ? `${e.links.length} link${e.links.length === 1 ? '' : 's'}, listed in Links.html` : 'Only links (Links index is off)')
        : NOTHING[cm.module] ? 'Nothing to download' : (cm.module in MODULE_LABEL ? 'No files found' : 'Not supported yet');
      children.push({ type: 'info', label: cm.name, badge, note: why, muted: true });
    }

    // Files sitting directly in the section summary or a text & media area.
    for (const f of c.files ?? []) {
      const node = addRemote(f, [...dirSegs, f.filename], f.filename);
      if (node) children.push({ ...node, badge: (splitExt(f.filename)[1].slice(1) || 'file').toUpperCase(), note: 'In section text' });
    }

    for (const l of c.links ?? []) links.push(l);
    if (s.includeLinks && links.length) {
      const id = `links:${c.id}`;
      const node = addGenerated(id, [...dirSegs, 'Links.html'], 'Links.html', { kind: 'links', title: c.title, links });
      children.push({ ...node, badge: 'HTML', note: `${links.length} link${links.length === 1 ? '' : 's'}`, links });
    }

    return { type: 'group', label: c.title, children, collapsed: false };
  }

  const width = String(course.sections.length).length > 2 ? 3 : 2;
  const sections = course.sections.map((sec, i) => {
    const name = s.numberPrefixes ? `${pad(i, width)} - ${sec.title}` : sec.title;
    const node = container(sec, [name]);
    node.section = true;
    return node;
  });

  return { root, sections, files };
}

/** Every file id under a tree node. */
export function fileIdsUnder(node, out = []) {
  if (node.type === 'file') out.push(node.id);
  for (const c of node.children ?? []) fileIdsUnder(c, out);
  return out;
}
