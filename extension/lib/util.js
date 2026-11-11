// Small helpers shared by the crawler, the planner and the UI.

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const MAX_SEGMENT = 120;

/** Decode HTML entities ("Cinema: Class &#38; Conflict") into plain text. */
export function decodeEntities(text) {
  if (text == null) return '';
  const s = String(text);
  if (!/[&<]/.test(s)) return s;
  const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${s}</body></html>`, 'text/html');
  return doc.body.textContent || '';
}

/** Collapse whitespace (including NBSP and the invisible bidi marks Moodle adds). */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/[​-‏‪-‮⁦-⁩﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitExt(name) {
  const m = /^(.*?)(\.[A-Za-z0-9]{1,8})$/.exec(name);
  if (!m || !m[1]) return [name, ''];
  return [m[1], m[2]];
}

/**
 * Make one path segment safe on Windows, macOS and Linux, and acceptable to
 * Firefox's downloads API (which rejects names it would have to rewrite).
 */
export function sanitizeSegment(raw, fallback = 'untitled') {
  let s = cleanText(raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/"/g, "'")
    .replace(/\s*:\s*/g, ' - ')
    .replace(/[\\/]/g, '-')
    .replace(/[*?<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  if (s.length > MAX_SEGMENT) {
    const [base, ext] = splitExt(s);
    s = base.slice(0, MAX_SEGMENT - ext.length).trim() + ext;
  }
  return s;
}

export function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Run `fn` over `items` with at most `limit` in flight. Stops early when `signal` aborts. */
export async function pool(items, limit, fn, signal) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function isAbort(err) {
  return err?.name === 'AbortError';
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function todayStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
