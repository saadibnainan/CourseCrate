import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, ZipWriter } from '../extension/lib/zip.js';

test('crc32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  // incremental == one shot
  const a = new TextEncoder().encode('12345');
  const b = new TextEncoder().encode('6789');
  assert.equal(crc32(b, crc32(a)), 0xcbf43926);
});

test('ZipWriter output passes unzip -t and round-trips UTF-8 names', async () => {
  const z = new ZipWriter();
  z.addText('Course/00 - General/Links.html', '<p>hi</p>');
  const bin = new Uint8Array(70000).map((_, i) => (i * 31) & 0xff);
  z.add('Course/01 - Semaine 1/Présentation 1.pdf', [bin.subarray(0, 1000), bin.subarray(1000)], bin.length, crc32(bin));
  z.addText('Course/01 - Semaine 1/Présentation 1.pdf', 'duplicate is ignored');
  assert.equal(z.count, 2);
  const blob = z.finish();
  const dir = mkdtempSync(join(tmpdir(), 'cc-zip-'));
  const file = join(dir, 'out.zip');
  writeFileSync(file, Buffer.from(await blob.arrayBuffer()));
  const out = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
  assert.match(out, /No errors detected/);
  execFileSync('unzip', ['-q', file, '-d', dir]);
  assert.deepEqual(new Uint8Array(readFileSync(join(dir, 'Course/01 - Semaine 1/Présentation 1.pdf'))), bin);
  assert.equal(readFileSync(join(dir, 'Course/00 - General/Links.html'), 'utf8'), '<p>hi</p>');
});
