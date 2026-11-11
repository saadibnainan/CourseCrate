// Toolbar button: look at the current tab, then open (or focus) the
// CourseCrate page for that Moodle course.

// Runs inside the page. Must be self-contained.
function detectMoodle() {
  const out = { isMoodle: false, wwwroot: null, courseId: null };
  try {
    const M = window.wrappedJSObject && window.wrappedJSObject.M;
    if (M && M.cfg && M.cfg.wwwroot) out.wwwroot = String(M.cfg.wwwroot);
  } catch (e) { /* page scripts not reachable */ }
  if (!out.wwwroot) {
    for (const s of document.querySelectorAll('script:not([src])')) {
      const m = /M\.cfg\s*=\s*\{[^]*?"wwwroot"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(s.textContent);
      if (m) { try { out.wwwroot = JSON.parse(`"${m[1]}"`); } catch (e) { /* ignore */ } break; }
    }
  }
  out.isMoodle = !!out.wwwroot;
  const body = document.body;
  const fromBody = body && /(?:^|\s)course-(\d+)(?:\s|$)/.exec(body.className);
  if (fromBody && fromBody[1] !== '1' && !body.classList.contains('pagelayout-frontpage')) out.courseId = fromBody[1];
  if (!out.courseId && /\/course\/view\.php$/.test(location.pathname)) {
    const id = new URLSearchParams(location.search).get('id');
    if (id && id !== '1') out.courseId = id;
  }
  return out;
}

browser.action.onClicked.addListener(async (tab) => {
  let info = null;
  try {
    const [res] = await browser.scripting.executeScript({ target: { tabId: tab.id }, func: detectMoodle });
    info = res && res.result;
  } catch (e) {
    // about:, addons.mozilla.org, PDFs, etc. can't be scripted. Fall through to the start page.
  }

  const params = new URLSearchParams();
  if (info && info.isMoodle) {
    params.set('site', info.wwwroot);
    if (info.courseId) params.set('course', info.courseId);
  }
  const key = `tab:${params.toString()}`;
  const page = `${browser.runtime.getURL('crate.html')}${params.size ? `?${params}` : ''}`;

  // One CourseCrate tab per course: focus it if it's still open.
  if (params.has('course')) {
    const stored = (await browser.storage.session.get(key))[key];
    if (stored != null) {
      try {
        const t = await browser.tabs.get(stored);
        await browser.tabs.update(t.id, { active: true });
        await browser.windows.update(t.windowId, { focused: true });
        return;
      } catch (e) { /* tab is gone */ }
    }
  }
  const created = await browser.tabs.create({ url: page, index: tab.index + 1, openerTabId: tab.id });
  if (params.has('course')) await browser.storage.session.set({ [key]: created.id });
});

browser.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') browser.tabs.create({ url: browser.runtime.getURL('crate.html?welcome=1') });
});
