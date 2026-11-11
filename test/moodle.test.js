import './setup.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalUrl } from '../extension/lib/moodle.js';

const O = 'https://moodle.example.edu';

test('external links: embeds become watch pages, Moodle links are ignored', () => {
  assert.equal(externalUrl('https://www.youtube.com/embed/aS_d0Ayjw4o?rel=0', O, O), 'https://www.youtube.com/watch?v=aS_d0Ayjw4o');
  assert.equal(externalUrl('https://www.youtube-nocookie.com/embed/abcdefg', O, O), 'https://www.youtube.com/watch?v=abcdefg');
  assert.equal(externalUrl('https://player.vimeo.com/video/12345?h=1', O, O), 'https://vimeo.com/12345');
  assert.equal(externalUrl('/mod/page/view.php?id=3', O, O), null);
  assert.equal(externalUrl('mailto:x@y.z', O, O), null);
  assert.equal(externalUrl('https://download.moodle.org/mobile', O, O), null);
  assert.equal(externalUrl('http://www.gutenberg.org/ebooks/search/', O, O), 'http://www.gutenberg.org/ebooks/search/');
});

import { htmlSections, mainRegion } from '../extension/lib/moodle.js';
import { collectFiles } from '../extension/lib/pluginfile.js';

test('Moodle 3.x course page fallback reads sections and activities', () => {
  const html = `<!doctype html><html><body class="course-9"><div id="region-main"><ul class="topics">
    <li id="section-0" class="section main" aria-label="General"><div class="content"><ul class="section img-text">
      <li class="activity forum modtype_forum" id="module-1"><div class="activityinstance"><a href="https://m.x/mod/forum/view.php?id=1"><span class="instancename">News forum<span class="accesshide "> Forum</span></span></a></div></li>
    </ul></div></li>
    <li id="section-1" class="section main" aria-label="Week 1"><div class="content"><h3 class="sectionname">Week 1</h3><ul class="section img-text">
      <li class="activity resource modtype_resource" id="module-2"><div class="activityinstance"><a href="https://m.x/mod/resource/view.php?id=2"><span class="instancename">Slides<span class="accesshide "> File</span></span></a></div></li>
      <li class="activity label modtype_label" id="module-3"><div class="contentwithoutlink">Read this</div></li>
      <li class="activity quiz modtype_quiz" id="module-4"><div class="activityinstance"><span class="instancename">Locked quiz</span></div></li>
    </ul></div></li>
  </ul></div></body></html>`;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const s = htmlSections(doc, 'https://m.x/course/view.php?id=9');
  assert.deepEqual(s.map((x) => x.title), ['General', 'Week 1']);
  const cms = s[1].entries.map((e) => [e.cm.module, e.cm.name, e.cm.available]);
  assert.deepEqual(cms, [['resource', 'Slides', true], ['label', 'label 3', true], ['quiz', 'Locked quiz', false]]);
  assert.equal(s[0].entries[0].cm.name, 'News forum');
});

test('forum discussion: attachments and linked files, not inline images or avatars', () => {
  const html = `<!doctype html><html><body><div id="region-main"><article>
    <img src="https://m.x/pluginfile.php/7/user/icon/boost/f1" class="userpicture">
    <div class="post-content-container">See notes <img src="https://m.x/pluginfile.php/55/mod_forum/post/12/diagram.png">
      <a href="https://m.x/pluginfile.php/55/mod_forum/post/12/extra%20reading.pdf">reading</a></div>
    <div class="attachments"><a href="https://m.x/pluginfile.php/55/mod_forum/attachment/12/notes.pdf?forcedownload=1">notes.pdf</a>
      <a href="https://m.x/pluginfile.php/55/mod_forum/attachment/12/notes.pdf">again</a></div>
  </article></div><footer><a href="https://m.x/pluginfile.php/1/core_admin/logo/0x150/1/logo.png">logo</a></footer></body></html>`;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const files = collectFiles(mainRegion(doc), 'https://m.x/mod/forum/discuss.php?d=12', { accept: (f) => f.component === 'mod_forum' });
  assert.deepEqual(files.map((f) => f.filename), ['extra reading.pdf', 'notes.pdf']);
});

import { stateStructure } from '../extension/lib/moodle.js';

// Shape of core_courseformat_get_state on Moodle 5.x (school.moodledemo.net, course 75):
// a delegated section's itemid is the subsection *instance* id, not the activity id.
function fakeState({ withDelegateId = true } = {}) {
  const cm = (id, module, name, sectionid, extra = {}) => ({ id: String(id), module, modname: module, name, sectionid: String(sectionid), uservisible: true, url: `https://m.x/mod/${module}/view.php?id=${id}`, ...extra });
  return JSON.stringify({
    course: { id: '75', sectionlist: ['597', '600', '598', '599'] },
    section: [
      { id: '597', number: 0, title: 'Topic 1', cmlist: ['10', '1214', '1300'], component: null, itemid: null },
      { id: '600', number: 1, title: 'Topic 2', cmlist: ['20'], component: null, itemid: null },
      { id: '598', number: 8, title: 'Lecture', cmlist: ['1215', '1216'], component: 'mod_subsection', itemid: 1, parentsectionid: '597' },
      { id: '599', number: 9, title: 'Exercise', cmlist: ['1217'], component: 'mod_subsection', itemid: 2, parentsectionid: '597' },
    ],
    cm: [
      cm(10, 'resource', 'Intro slides', 597),
      cm(1214, 'subsection', 'Lecture', 597, { hasdelegatedsection: true, ...(withDelegateId ? { delegatesectionid: '598' } : {}) }),
      cm(1300, 'subsection', 'Exercise', 597, { hasdelegatedsection: true, ...(withDelegateId ? { delegatesectionid: '599' } : {}) }),
      cm(1215, 'resource', 'Lecture 1', 598),
      cm(1216, 'folder', 'Lecture extras', 598),
      cm(1217, 'resource', 'Exercise 1', 599),
      cm(20, 'resource', 'Week 2', 600),
    ],
  });
}

const flatten = (sections) => sections.map((s) => [s.title, s.entries.map((e) => (e.type === 'subsection'
  ? [e.title, e.entries.map((x) => x.cm.name)] : e.cm.name))]);

const EXPECTED = [
  ['Topic 1', ['Intro slides', ['Lecture', ['Lecture 1', 'Lecture extras']], ['Exercise', ['Exercise 1']]]],
  ['Topic 2', ['Week 2']],
];

test('subsections: activity is paired with its section via delegatesectionid, not itemid', async () => {
  const client = { ajax: async () => fakeState() };
  assert.deepEqual(flatten(await stateStructure(client, 75, null)), EXPECTED);
});

test('subsections without delegatesectionid: paired via the course page, else by parent + name', async () => {
  const client = { ajax: async () => fakeState({ withDelegateId: false }) };
  assert.deepEqual(flatten(await stateStructure(client, 75, null)), EXPECTED);
  const page = new DOMParser().parseFromString(`<!doctype html><html><body><ul>
    <li data-for="section" data-id="597"><ul>
      <li data-for="cmitem" data-id="1214"><li data-for="section" data-id="598"></li></li>
      <li data-for="cmitem" data-id="1300"><li data-for="section" data-id="599"></li></li>
    </ul></li></ul></body></html>`, 'text/html');
  assert.deepEqual(flatten(await stateStructure(client, 75, page)), EXPECTED);
});

test('HTML fallback walks into subsections (Moodle 4.5+ markup)', () => {
  const html = `<!doctype html><html><body><div id="region-main"><ul>
    <li id="section-1" class="section" data-for="section" data-id="11" data-number="1" data-sectionname="Topic 1"><ul>
      <li class="activity subsection modtype_subsection" data-for="cmitem" data-id="5" id="module-5"><div>
        <li id="section-13" class="section delegated-section" data-for="section" data-id="31" data-number="13" data-sectionname="Lecture"><ul>
          <li class="activity resource modtype_resource" data-for="cmitem" data-id="6" id="module-6"><a href="https://m.x/mod/resource/view.php?id=6"><span class="instancename">Slides 1</span></a></li>
        </ul></li></div></li>
      <li class="activity resource modtype_resource" data-for="cmitem" data-id="7" id="module-7"><a href="https://m.x/mod/resource/view.php?id=7"><span class="instancename">Reading</span></a></li>
    </ul></li></ul></div>
    <div class="courseindex"><div data-for="section" data-id="11"></div><div data-for="section" data-id="31"></div></div>
  </body></html>`;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  assert.deepEqual(flatten(htmlSections(doc, 'https://m.x/course/view.php?id=9')), [['Topic 1', [['Lecture', ['Slides 1']], 'Reading']]]);
});
