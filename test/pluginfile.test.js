import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePluginfile, isCourseMaterial, subPathFor } from '../extension/lib/pluginfile.js';

const B = 'https://moodle.example.edu/sub';

test('parses normal pluginfile URLs and keys them without ?forcedownload', () => {
  const f = parsePluginfile(`${B}/pluginfile.php/1120/mod_folder/content/0/Week%201/Notes%20(final).pdf?forcedownload=1`);
  assert.equal(f.component, 'mod_folder');
  assert.equal(f.filename, 'Notes (final).pdf');
  assert.deepEqual(subPathFor(f), ['Week 1']);
  assert.equal(f.key, `${B}/pluginfile.php/1120/mod_folder/content/0/Week%201/Notes%20(final).pdf`);
  assert.equal(parsePluginfile(`${B}/pluginfile.php/1120/mod_folder/content/0/Week%201/Notes%20(final).pdf`).key, f.key);
});

test('handles tokenpluginfile and slash arguments off', () => {
  const t = parsePluginfile(`${B}/tokenpluginfile.php/abc123/55/mod_resource/content/3/a.pdf`);
  assert.equal(t.ctx, '55');
  assert.equal(t.filename, 'a.pdf');
  const q = parsePluginfile(`${B}/pluginfile.php?file=%2F55%2Fmod_resource%2Fcontent%2F3%2Fb.pdf`);
  assert.equal(q.component, 'mod_resource');
  assert.equal(q.filename, 'b.pdf');
});

test('only course material counts', () => {
  const yes = ['course/section/471/a.mp3', 'mod_label/intro/x.pdf', 'assignsubmission_file/submission_files/40/p.pptx', 'assignfeedback_editpdf/download/1/f.pdf'];
  const no = ['user/icon/boost/f1', 'group/icon/41/f1', 'core_admin/logo/0x200/1/logo.png', 'theme_boost/x/y.png', 'question/questiontext/1/2/3/q.png'];
  for (const p of yes) assert.ok(isCourseMaterial(parsePluginfile(`${B}/pluginfile.php/9/${p}`)), p);
  for (const p of no) assert.ok(!isCourseMaterial(parsePluginfile(`${B}/pluginfile.php/9/${p}`)), p);
  assert.equal(parsePluginfile('https://example.com/file.pdf'), null);
  assert.equal(parsePluginfile('javascript:alert(1)'), null);
});

test('assignment files are split into submission and feedback', () => {
  assert.deepEqual(subPathFor(parsePluginfile(`${B}/pluginfile.php/9/assignsubmission_file/submission_files/40/p.pptx`)), ['My submission']);
  assert.deepEqual(subPathFor(parsePluginfile(`${B}/pluginfile.php/9/assignfeedback_file/feedback_files/40/f.pdf`)), ['Feedback']);
  assert.deepEqual(subPathFor(parsePluginfile(`${B}/pluginfile.php/9/mod_assign/introattachment/0/brief.pdf`)), []);
});
