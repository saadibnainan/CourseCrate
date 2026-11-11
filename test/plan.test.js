import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan } from '../extension/lib/plan.js';
import { DEFAULTS } from '../extension/lib/settings.js';
import { parsePluginfile, subPathFor } from '../extension/lib/pluginfile.js';

const B = 'https://m.example.edu';
const file = (p, extra = {}) => { const f = parsePluginfile(`${B}/pluginfile.php/${p}`); return { ...f, sub: subPathFor(f), ...extra }; };
const cm = (id, module, name, files = [], links = [], extra = {}) => ({
  type: 'cm', cm: { id: String(id), module, modname: module, name, available: true, ...extra }, files, links,
});

function course() {
  return {
    name: 'Intro: Psychology', id: '5', sections: [
      { id: '1', title: 'General', files: [file('7/course/section/1/welcome.mp3')], links: [], entries: [
        cm(10, 'forum', 'Announcements'),
        cm(11, 'quiz', 'Quiz 1'),
      ] },
      { id: '2', title: 'Week 1', files: [], links: [{ name: 'Khan', url: 'https://khanacademy.org' }], entries: [
        cm(20, 'resource', 'Lecture slides', [file('8/mod_resource/content/2/L1.pptx')]),
        cm(21, 'resource', 'Lecture slides', [file('9/mod_resource/content/1/L1b.pptx')]),
        cm(22, 'folder', 'Readings', [file('10/mod_folder/content/0/a.pdf'), file('10/mod_folder/content/0/extra/b.pdf')]),
        cm(23, 'url', 'Video', [], [{ name: 'Video', url: 'https://youtu.be/x' }]),
        cm(24, 'assign', 'Essay', [file('11/mod_assign/introattachment/0/brief.pdf'), file('11/assignsubmission_file/submission_files/9/mine.docx')]),
        cm(25, 'assign', 'Hidden essay', [], [], { available: false }),
      ] },
    ],
  };
}

test('paths are numbered in course order, deduped and sanitised', () => {
  const plan = buildPlan(course(), { ...DEFAULTS });
  const paths = [...plan.files.values()].map((f) => f.path.join('/'));
  assert.deepEqual(paths, [
    'CourseCrate/Intro - Psychology/00 - General/welcome.mp3',
    'CourseCrate/Intro - Psychology/01 - Week 1/01 - Lecture slides.pptx',
    'CourseCrate/Intro - Psychology/01 - Week 1/02 - Lecture slides.pptx',
    'CourseCrate/Intro - Psychology/01 - Week 1/03 - Readings/a.pdf',
    'CourseCrate/Intro - Psychology/01 - Week 1/03 - Readings/extra/b.pdf',
    'CourseCrate/Intro - Psychology/01 - Week 1/04 - Essay/brief.pdf',
    'CourseCrate/Intro - Psychology/01 - Week 1/04 - Essay/My submission/mine.docx',
    'CourseCrate/Intro - Psychology/01 - Week 1/Links.html',
  ]);
  const links = plan.files.get('links:2').generated.links.map((l) => l.url);
  assert.deepEqual(links, ['https://youtu.be/x', 'https://khanacademy.org']);
});

test('same names without numbering get (2) suffixes; original names option', () => {
  const plan = buildPlan(course(), { ...DEFAULTS, numberPrefixes: false, rootFolder: '' });
  const p = [...plan.files.values()].map((f) => f.path.join('/'));
  assert.ok(p.includes('Intro - Psychology/Week 1/Lecture slides.pptx'));
  assert.ok(p.includes('Intro - Psychology/Week 1/Lecture slides (2).pptx'));
  const orig = buildPlan(course(), { ...DEFAULTS, nameBy: 'filename' });
  assert.ok([...orig.files.values()].some((f) => f.path.at(-1) === '01 - L1.pptx'));
});

test('sync deselects files already downloaded; include toggles drop activities', () => {
  const first = buildPlan(course(), { ...DEFAULTS });
  const synced = Object.fromEntries([...first.files.values()].map((f) => [f.key, { at: 1 }]));
  const again = buildPlan(course(), { ...DEFAULTS }, synced);
  assert.equal([...again.files.values()].filter((f) => f.selected).length, 0);
  const noSync = buildPlan(course(), { ...DEFAULTS, sync: false }, synced);
  assert.equal([...noSync.files.values()].filter((f) => f.selected).length, noSync.files.size);

  const off = buildPlan(course(), { ...DEFAULTS, includeAssign: false, includeLinks: false });
  const p = [...off.files.values()].map((f) => f.path.at(-1));
  assert.ok(!p.includes('brief.pdf'));
  assert.ok(!p.includes('Links.html'));
});

test('.url shortcuts only in ZIP mode (Firefox refuses .url downloads)', () => {
  const folders = buildPlan(course(), { ...DEFAULTS, urlShortcuts: true, mode: 'folders' });
  assert.ok(![...folders.files.values()].some((f) => f.ext === 'url'));
  const zip = buildPlan(course(), { ...DEFAULTS, urlShortcuts: true, mode: 'zip' });
  const u = [...zip.files.values()].find((f) => f.ext === 'url');
  assert.equal(u.path.at(-1), '04 - Video.url');
  assert.match(u.generated, /URL=https:\/\/youtu\.be\/x/);
});
