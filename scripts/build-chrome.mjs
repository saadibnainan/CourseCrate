// Builds the Chrome Web Store package from the shared source in extension/.
//
// The code is the same for both browsers; only the manifest differs:
//   - Chrome runs the background script as a service worker, Firefox as an
//     event page (`background.scripts`).
//   - Gecko-only keys are dropped: Chrome warns about keys it doesn't know,
//     and its `author` key only takes {"email": ...}.
//
//   node scripts/build-chrome.mjs   ->  build/chrome/  +  dist/coursecrate-chrome-<version>.zip

import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MIN_CHROME = '120';

export function chromeManifest(firefox) {
  const m = {};
  for (const [k, v] of Object.entries(firefox)) {
    if (k === 'browser_specific_settings' || k === 'author') continue;
    m[k] = k === 'background' ? { service_worker: 'background.js' } : structuredClone(v);
    if (k === 'version') m.minimum_chrome_version = MIN_CHROME;
  }
  return m;
}

function main() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = join(root, 'extension');
  const out = join(root, 'build', 'chrome');
  const firefox = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(src, out, { recursive: true });
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(chromeManifest(firefox), null, 2)}\n`);

  const zip = `coursecrate-chrome-${firefox.version}.zip`;
  execFileSync('npx', ['--no-install', 'web-ext', 'build', '--source-dir', out, '--artifacts-dir', join(root, 'dist'),
    '--filename', zip, '--overwrite-dest'], { stdio: 'inherit', cwd: root });
  console.log(`\nUnpacked: build/chrome   Upload: dist/${zip}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
