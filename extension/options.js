import { loadSettings, saveSettings } from './lib/settings.js';
import { sanitizeSegment } from './lib/util.js';

const $ = (s) => document.querySelector(s);
let hideTimer;

function flashSaved() {
  $('#saved').hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { $('#saved').hidden = true; }, 1200);
}

async function save(patch) {
  await saveSettings(patch);
  flashSaved();
}

async function init() {
  const s = await loadSettings();
  for (const r of document.querySelectorAll('input[name=mode]')) {
    r.checked = r.value === s.mode;
    r.addEventListener('change', () => save({ mode: r.value }));
  }
  for (const r of document.querySelectorAll('input[name=nameBy]')) {
    r.checked = r.value === s.nameBy;
    r.addEventListener('change', () => save({ nameBy: r.value }));
  }
  for (const c of document.querySelectorAll('input[data-setting]')) {
    c.checked = !!s[c.dataset.setting];
    c.addEventListener('change', () => save({ [c.dataset.setting]: c.checked }));
  }
  const root = $('#rootFolder');
  root.value = s.rootFolder;
  root.addEventListener('change', () => {
    const v = root.value.trim() ? sanitizeSegment(root.value) : '';
    root.value = v;
    save({ rootFolder: v });
  });
  const conc = $('#concurrency');
  conc.value = String(s.concurrency);
  conc.addEventListener('change', () => save({ concurrency: Number(conc.value) }));

  $('#forget-all').addEventListener('click', async () => {
    if (!confirm('Forget which files CourseCrate already saved, for every course? Files on your disk are not touched.')) return;
    const all = await browser.storage.local.get(null);
    await browser.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('sync:')));
    flashSaved();
  });
}

init();
