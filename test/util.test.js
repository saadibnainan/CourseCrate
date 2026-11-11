import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSegment, decodeEntities, splitExt } from '../extension/lib/util.js';

test('sanitizeSegment makes names safe on every OS', () => {
  assert.equal(sanitizeSegment('Osborne:Transference/Counter transference'), 'Osborne - Transference-Counter transference');
  assert.equal(sanitizeSegment('Download "Daffodils"'), "Download 'Daffodils'");
  assert.equal(sanitizeSegment('What? <draft> | v2*'), 'What_ _draft_ _ v2_');
  assert.equal(sanitizeSegment('  ...hidden.  '), 'hidden');
  assert.equal(sanitizeSegment('CON'), '_CON');
  assert.equal(sanitizeSegment('aux.txt'), '_aux.txt');
  assert.equal(sanitizeSegment(''), 'untitled');
  assert.equal(sanitizeSegment('a‎  b'), 'a b');
  const long = sanitizeSegment(`${'x'.repeat(300)}.pdf`);
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('.pdf'));
});

test('decodeEntities and splitExt', () => {
  assert.equal(decodeEntities('Cinema: Class &#38; Conflict'), 'Cinema: Class & Conflict');
  assert.equal(decodeEntities('plain'), 'plain');
  assert.deepEqual(splitExt('slides.v2.pptx'), ['slides.v2', '.pptx']);
  assert.deepEqual(splitExt('README'), ['README', '']);
  assert.deepEqual(splitExt('.bashrc'), ['.bashrc', '']);
});
