// Two ways to save a course:
//  - folders: hand each file to the browser's download manager, straight into
//    Downloads/<root>/<course>/<section>/... (streams to disk, any size)
//  - zip: fetch every file, pack one <course>.zip in memory, save that.

import { crc32, ZipWriter } from './zip.js';
import { pool, isAbort } from './util.js';

const HTML_EXT = /^(html?|xhtml)$/i;

// Chrome parks some file types (and Safe Browsing hits) until the user clicks
// Keep in its download list. Those never finish on their own, so stop waiting.
const HELD = new Set(['file', 'url', 'content', 'uncommon', 'host', 'unwanted', 'accountCompromise']);
const HELD_MESSAGE = 'The browser held this file back as risky. Keep it from the download list if you trust it.';

function blobUrlFor(text, type) {
  return URL.createObjectURL(new Blob([text], { type }));
}

/** Waits for browser download ids to finish. One listener for the whole run. */
class DownloadWatcher {
  #waiting = new Map();
  #early = new Map();
  #listener = (delta) => {
    const state = delta.state?.current;
    let result;
    if (state === 'complete' || state === 'interrupted') result = { state, error: delta.error?.current };
    else if (HELD.has(delta.danger?.current)) result = { state: 'held' };
    else return;
    const w = this.#waiting.get(delta.id);
    if (w) { this.#waiting.delete(delta.id); w(result); } else this.#early.set(delta.id, result);
  };

  constructor() { browser.downloads.onChanged.addListener(this.#listener); }
  stop() { browser.downloads.onChanged.removeListener(this.#listener); }

  async wait(id) {
    if (this.#early.has(id)) { const r = this.#early.get(id); this.#early.delete(id); return r; }
    const p = new Promise((resolve) => this.#waiting.set(id, resolve));
    // It may have finished between download() resolving and us listening.
    const [item] = await browser.downloads.search({ id });
    if (item && this.#waiting.has(id)) {
      if (item.state === 'complete' || item.state === 'interrupted') {
        this.#waiting.delete(id);
        return { state: item.state, error: item.error };
      }
      if (HELD.has(item.danger)) {
        this.#waiting.delete(id);
        return { state: 'held' };
      }
    }
    return p;
  }
}

/**
 * @param jobs  [{id, path: string[], url?, text?, mime?, ext}]
 * @param opts  {signal, concurrency, cleanList, onStatus(id, status, info), onBytes(total)}
 * @returns     {done: job[], failed: [{job, error}], firstDownloadId}
 */
export async function saveToFolders(jobs, opts) {
  const { signal, concurrency = 3, cleanList = true, onStatus = () => {}, onBytes = () => {} } = opts;
  const watcher = new DownloadWatcher();
  const active = new Set();
  const done = [];
  const failed = [];
  let firstDownloadId = null;
  let finishedBytes = 0;

  const ticker = setInterval(async () => {
    if (!active.size) return;
    let inflight = 0;
    for (const id of active) {
      const [item] = await browser.downloads.search({ id });
      if (item) inflight += item.bytesReceived || 0;
    }
    onBytes(finishedBytes + inflight);
  }, 700);

  const onAbort = () => { for (const id of active) browser.downloads.cancel(id).catch(() => {}); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await pool(jobs, concurrency, async (job) => {
      onStatus(job.id, 'active');
      let attempt = 0;
      for (;;) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const blobUrl = job.text != null ? blobUrlFor(job.text, job.mime || 'text/html') : null;
        let dlId;
        try {
          dlId = await browser.downloads.download({
            url: blobUrl ?? job.url,
            filename: job.path.join('/'),
            conflictAction: 'overwrite',
            saveAs: false,
          });
        } catch (err) {
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          failed.push({ job, error: err.message || String(err) });
          onStatus(job.id, 'error', { error: err.message || String(err) });
          return;
        }
        active.add(dlId);
        firstDownloadId ??= dlId;
        const result = await watcher.wait(dlId);
        active.delete(dlId);
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        const [item] = await browser.downloads.search({ id: dlId });

        if (result.state === 'complete') {
          finishedBytes += item?.fileSize || item?.bytesReceived || 0;
          onBytes(finishedBytes);
          let warning = null;
          if (job.url && item?.mime?.startsWith('text/html') && !HTML_EXT.test(job.ext || '')) {
            warning = 'Moodle sent a web page instead of the file. Your session may have ended.';
          }
          if (cleanList && dlId !== firstDownloadId) browser.downloads.erase({ id: dlId }).catch(() => {});
          done.push(job);
          onStatus(job.id, warning ? 'warn' : 'done', { warning, bytes: item?.fileSize });
          return;
        }
        if (result.state === 'held') { // left in the download list for the user to decide
          failed.push({ job, error: HELD_MESSAGE });
          onStatus(job.id, 'error', { error: HELD_MESSAGE });
          return;
        }
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const error = result.error || 'interrupted';
        if (/^NETWORK_|^SERVER_FAILED/.test(error) && attempt++ < 2) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        browser.downloads.erase({ id: dlId }).catch(() => {});
        failed.push({ job, error });
        onStatus(job.id, 'error', { error: describeDownloadError(error) });
        return;
      }
    }, signal);
  } catch (err) {
    if (!isAbort(err)) throw err;
    return { done, failed, firstDownloadId, aborted: true };
  } finally {
    clearInterval(ticker);
    signal?.removeEventListener('abort', onAbort);
    watcher.stop();
  }
  return { done, failed, firstDownloadId };
}

function describeDownloadError(code) {
  return ({
    SERVER_FORBIDDEN: 'Moodle refused this file (no permission).',
    SERVER_BAD_CONTENT: 'Moodle could not find this file.',
    SERVER_UNAUTHORIZED: 'Moodle asked for a login. Your session may have ended.',
    NETWORK_FAILED: 'The network dropped while downloading.',
    NETWORK_TIMEOUT: 'The download timed out.',
    FILE_ACCESS_DENIED: 'The browser could not write to your Downloads folder.',
    FILE_NO_SPACE: 'Your disk is full.',
    FILE_NAME_TOO_LONG: 'The file path is too long for your system.',
    FILE_FAILED: 'The browser could not save the file.',
    FILE_BLOCKED: 'The browser blocked this file.',
    FILE_VIRUS_INFECTED: 'Your virus scanner blocked this file.',
    FILE_SECURITY_CHECK_FAILED: 'The browser blocked this file after a security check.',
  })[code] ?? `Download failed (${code}).`;
}

/**
 * @param jobs  as saveToFolders; path[0] may be the root folder
 * @param opts  {signal, concurrency, zipName: string[], innerStart: number, isLoginUrl, onStatus, onBytes}
 */
export async function saveAsZip(jobs, opts) {
  const { signal, concurrency = 3, zipName, innerStart = 0, isLoginUrl = () => false,
    onStatus = () => {}, onBytes = () => {} } = opts;
  const zip = new ZipWriter();
  const done = [];
  const failed = [];
  let bytes = 0;

  await pool(jobs, concurrency, async (job) => {
    onStatus(job.id, 'active');
    const inner = job.path.slice(innerStart).join('/');
    if (job.text != null) {
      zip.addText(inner, job.text);
      done.push(job);
      onStatus(job.id, 'done');
      return;
    }
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(job.url, { credentials: 'include', signal });
        if (isLoginUrl(res.url)) throw Object.assign(new Error('Moodle asked for a login. Your session may have ended.'), { fatal: true });
        if (!res.ok) throw new Error(res.status === 404 ? 'Moodle could not find this file.' : `Moodle answered ${res.status}.`);
        const type = res.headers.get('content-type') || '';
        if (type.startsWith('text/html') && !HTML_EXT.test(job.ext || '')) {
          res.body?.cancel();
          throw new Error('Moodle sent a web page instead of the file.');
        }
        const reader = res.body.getReader();
        const chunks = [];
        let crc = 0;
        let size = 0;
        for (;;) {
          const { done: end, value } = await reader.read();
          if (end) break;
          crc = crc32(value, crc);
          size += value.length;
          bytes += value.length;
          chunks.push(value);
          onBytes(bytes);
        }
        const lm = Date.parse(res.headers.get('last-modified') || '');
        zip.add(inner, chunks, size, crc, Number.isFinite(lm) ? new Date(lm) : new Date());
        done.push(job);
        onStatus(job.id, 'done', { bytes: size });
        return;
      } catch (err) {
        if (isAbort(err) || err.name === 'ZipTooLargeError' || err.fatal) throw err;
        if (attempt++ < 2 && err instanceof TypeError) { // network hiccup
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        failed.push({ job, error: err.message });
        onStatus(job.id, 'error', { error: err.message });
        return;
      }
    }
  }, signal);

  if (!zip.count) return { done, failed, firstDownloadId: null };
  onStatus('__zip__', 'active');
  const blob = zip.finish();
  const url = URL.createObjectURL(blob);
  const watcher = new DownloadWatcher();
  try {
    const id = await browser.downloads.download({
      url, filename: zipName.join('/'), conflictAction: 'uniquify', saveAs: false,
    });
    const result = await watcher.wait(id);
    if (result.state === 'held') throw new Error(HELD_MESSAGE);
    if (result.state !== 'complete') throw new Error(describeDownloadError(result.error || 'FILE_FAILED'));
    return { done, failed, firstDownloadId: id, zipBytes: blob.size };
  } finally {
    watcher.stop();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
