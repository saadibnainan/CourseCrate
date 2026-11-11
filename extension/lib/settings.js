export const DEFAULTS = Object.freeze({
  mode: 'folders', // 'folders' | 'zip'
  includeLinks: true,
  includeAssign: true,
  includeForum: true,
  sync: true,
  numberPrefixes: true,
  nameBy: 'title', // 'title' (activity name) | 'filename' (original file name)
  urlShortcuts: false,
  rootFolder: 'CourseCrate',
  cleanDownloadList: true,
  concurrency: 3,
});

// Settings that change what gets crawled (the rest only change names/paths).
export const SCAN_KEYS = ['includeLinks', 'includeAssign', 'includeForum'];

export async function loadSettings() {
  const { settings } = await browser.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const next = { ...(await loadSettings()), ...patch };
  await browser.storage.local.set({ settings: next });
  return next;
}

// ---- sync history: which files of a course were already saved ----

const syncKey = (origin, courseId) => `sync:${origin}:${courseId}`;

export async function loadSynced(origin, courseId) {
  const k = syncKey(origin, courseId);
  const got = await browser.storage.local.get(k);
  return got[k]?.files ?? {};
}

export async function recordSynced(origin, courseId, entries) {
  const k = syncKey(origin, courseId);
  const got = await browser.storage.local.get(k);
  const files = { ...(got[k]?.files ?? {}) };
  const at = Date.now();
  for (const e of entries) files[e.key] = { path: e.path, at };
  await browser.storage.local.set({ [k]: { files, lastRun: at } });
}

export async function forgetSynced(origin, courseId) {
  await browser.storage.local.remove(syncKey(origin, courseId));
}

// ---- recently opened courses ----

export async function rememberCourse(entry) {
  const { recent = [] } = await browser.storage.local.get('recent');
  const next = [{ ...entry, at: Date.now() },
    ...recent.filter((r) => !(r.site === entry.site && r.courseId === entry.courseId))].slice(0, 12);
  await browser.storage.local.set({ recent: next });
}

export async function recentCourses() {
  const { recent = [] } = await browser.storage.local.get('recent');
  return recent;
}
