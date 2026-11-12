import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromeManifest, MIN_CHROME } from '../scripts/build-chrome.mjs';

const firefox = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

test('Chrome manifest swaps the background page for a service worker', () => {
  const m = chromeManifest(firefox);
  assert.deepEqual(m.background, { service_worker: 'background.js' });
  assert.equal(m.browser_specific_settings, undefined);
  assert.equal(m.author, undefined);
  assert.equal(m.minimum_chrome_version, MIN_CHROME);
  assert.equal(m.version, firefox.version);
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions, firefox.permissions);
  assert.deepEqual(m.optional_host_permissions, firefox.optional_host_permissions);
  assert.ok(m.description.length <= 132, 'Chrome caps the description at 132 characters');
  // The Firefox manifest itself is untouched.
  assert.deepEqual(firefox.background, { scripts: ['background.js'] });
});
