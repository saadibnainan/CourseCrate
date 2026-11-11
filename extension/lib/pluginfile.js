// Understands Moodle file URLs: /pluginfile.php/{context}/{component}/{filearea}/{itemid?}/{path...}/{filename}
// Also handles tokenpluginfile.php and sites running with slash arguments off (?file=/...).

/**
 * @returns {null | {url: string, key: string, ctx: string, component: string,
 *   filearea: string, rest: string[], filename: string}}
 */
export function parsePluginfile(href, base) {
  let u;
  try { u = new URL(href, base); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  let parts;
  const m = /\/(token)?pluginfile\.php(\/.*)?$/.exec(u.pathname);
  if (!m) return null;
  if (m[2]) {
    parts = m[2].split('/').filter(Boolean);
    if (m[1]) parts = parts.slice(1); // drop the token
  } else if (u.searchParams.get('file')) {
    parts = u.searchParams.get('file').split('/').filter(Boolean);
  } else {
    return null;
  }
  if (parts.length < 4) return null;
  const decoded = parts.map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  const [ctx, component, filearea, ...rest] = decoded;
  const filename = rest[rest.length - 1];
  if (!filename) return null;
  // Same file whatever ?forcedownload=1 / #page=3 say: key on the path only.
  u.hash = '';
  for (const p of ['forcedownload', 'embed', 'preview', 'offline', 'theme']) u.searchParams.delete(p);
  const url = u.toString();
  const key = `${u.origin}${u.pathname}${u.searchParams.get('file') ? `?file=${u.searchParams.get('file')}` : ''}`;
  return { url, key, ctx, component, filearea, rest, filename };
}

// Which files are course material. Everything else (avatars, group icons, theme
// images, the site logo, question images) is left alone.
export function isCourseMaterial(f) {
  if (!f) return false;
  if (f.component === 'course') return f.filearea === 'section' || f.filearea === 'legacy';
  if (/^assign(submission|feedback)_/.test(f.component)) return true;
  if (f.component.startsWith('mod_')) return true;
  return false;
}

/**
 * Sub-folders a file should live in, relative to its activity folder.
 * Folder activities keep their own directory tree; assignment files are split
 * into the brief, your submission and teacher feedback.
 */
export function subPathFor(f) {
  if (f.component === 'mod_folder' && f.filearea === 'content') {
    // rest = [revision, ...dirs, filename]
    return f.rest.slice(1, -1);
  }
  if (/^assignsubmission_/.test(f.component)) return ['My submission'];
  if (/^assignfeedback_/.test(f.component)) return ['Feedback'];
  return [];
}

// Elements that point at downloadable files. Inline <img> tags are skipped on
// purpose: they are almost always banners and decoration, not handouts.
const FILE_SELECTORS = [
  'a[href]', 'source[src]', 'video[src]', 'audio[src]', 'object[data]',
  'embed[src]', 'iframe[src]', 'frame[src]', 'img.resourceimage[src]',
].join(',');

function attrUrl(el) {
  return el.getAttribute('href') ?? el.getAttribute('src') ?? el.getAttribute('data');
}

/**
 * Collect course files under `root`. `accept(f)` narrows by component/filearea,
 * `owner(el)` lets callers attribute each element (e.g. to its activity).
 */
export function collectFiles(root, baseUrl, { accept = isCourseMaterial, owner } = {}) {
  const out = [];
  const seen = new Set();
  if (!root) return out;
  for (const el of root.querySelectorAll(FILE_SELECTORS)) {
    const f = parsePluginfile(attrUrl(el), baseUrl);
    if (!f || !accept(f)) continue;
    const who = owner ? owner(el) : null;
    const dedupe = `${who ?? ''}|${f.key}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(owner ? { ...f, owner: who } : f);
  }
  return out;
}
