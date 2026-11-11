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
