# addons.mozilla.org listing: CourseCrate

Copy these fields into the AMO Developer Hub when submitting (`npm run build`, then upload `dist/coursecrate-1.0.0.zip`, or `npm run sign` with API keys).

---

## Name

CourseCrate

## Add-on URL slug

`coursecrate`

## Summary (250 characters max)

Download a whole Moodle course in one click: lecture files, folders, assignment briefs, forum attachments and links, sorted into one folder per section. Run it again later to grab only what's new.

## Description

> The AMO form supports some Markdown. Paste as is.

```markdown
**Your whole Moodle course, saved in one click, sorted the way the course is.**

Open a course, click CourseCrate, press Download. You get a folder per section, with every file numbered in course order:

`CourseCrate / Psychology in Cinema / 01 - Background information / 02 - Lecture slides.pdf`

**What it saves**

- File and Folder activities (PDFs, slides, documents, audio, video), with their sub-folders
- Files and media placed in section text and text & media areas
- Files linked inside Pages and Books
- Assignment briefs, your own submitted files and teacher feedback
- Forum attachments, in a folder per discussion
- A Links.html page in each section with every web link, URL activity and embedded YouTube/Vimeo video

**Built for the whole semester**

- **Sync:** run it again any time and only new or changed files download. Files you already have are marked "Have it".
- **Folders or ZIP:** stream files straight into your Downloads folder (any size), or pack the course into a single ZIP.
- **Pick and choose:** tick or untick whole sections, activities or single files before downloading.
- **Readable names:** name files after the activity ("Lecture 3 slides.pdf") or keep their original names.
- **Course picker:** click the button anywhere on your Moodle site to choose from your courses.

**Private by design**

CourseCrate uses the Moodle login you already have in Firefox, so there's no password, token or site setup. It only talks to the Moodle sites you allow (Firefox asks once per site), collects no data and has no servers. Everything stays on your computer.

**Works with**

Moodle 4.x and 5.x, including "one section per page" courses and subsections, with a fallback for Moodle 3.x. Any university or school Moodle you can log in to.

**Good to know**

- Online-only activities such as quizzes, lessons, H5P and wikis have nothing to download and are skipped.
- Moodle logs CourseCrate's page visits like your own clicks, so "view" completion may be marked.
- In current Firefox, new extension buttons sit in the puzzle-piece menu. Pin CourseCrate for one-click access.
- Please respect your institution's rules on course material.

Open source (MIT): https://github.com/saadibnainan/CourseCrate

Moodle™ is a registered trademark of Moodle Pty Ltd. CourseCrate is an independent project and is not affiliated with or endorsed by Moodle.
```

## Categories (Firefox)

- **Download Management** (only this one)

## Tags

Pick from AMO's list if available: `download manager`, `productivity`.

## Support

- Support website: https://github.com/saadibnainan/CourseCrate/issues
- Support email: (optional, e.g. a lecturex.app address)
- Homepage: https://github.com/saadibnainan/CourseCrate

## License

MIT License

## Privacy policy

Not required (the add-on collects no data and declares `data_collection_permissions: ["none"]`). Optional: paste the text of `PRIVACY.md`.

## Screenshots (1280×800, in `store/screenshots/`)

| File | Caption |
| --- | --- |
| `1-course.png` | Pick sections, activities or single files. Everything is numbered in course order. |
| `3-done.png` | Save as folders or one ZIP. Re-run later and only new files download. |
| `4-courses.png` | Click the button anywhere on your Moodle site to choose a course. |
| `2-permission.png` | CourseCrate asks once per Moodle site and uses your existing login. |
| `6-settings.png` | Choose what to include and how files are named. |
| `5-start.png` | Three steps: open a course, click CourseCrate, download. |

## Icon

`extension/icons/icon-128.png` (AMO wants 128×128 PNG; the SVG is `extension/icons/icon.svg`).

## Notes to reviewer

```
CourseCrate downloads the content of a Moodle course the user is logged in to.

How to test (public Moodle demo, resets every hour):
1. Go to https://school.moodledemo.net/login/index.php and log in as
   username "student", password "moodle26" (the login page always shows the
   current demo password if it has changed).
2. Open e.g. https://school.moodledemo.net/course/view.php?id=62
   ("Psychology in Cinema").
3. Click the CourseCrate toolbar button (in the Extensions menu if not
   pinned). A CourseCrate tab opens; click "Allow on this site".
4. Press "Download 7 files". Files appear under Downloads/CourseCrate/.
   Switch "Save as" to "ZIP file" to test the ZIP path.

Permissions:
- activeTab + scripting: on toolbar click, inject a tiny function
  (detectMoodle in background.js) into the current tab to read Moodle's
  site root and course id. Nothing is injected otherwise.
- optional_host_permissions (http/https *): requested per Moodle origin at
  runtime, so the extension page can fetch that site's pages/files with the
  user's session cookies. Moodle sites live on arbitrary domains, hence
  the wildcard, but only the user-approved origin is ever granted.
- downloads: save files (folders mode) and the ZIP (ZIP mode).
- storage: settings, sync history, recent courses (local only).

The custom CSP only drops MV3's default upgrade-insecure-requests so that
Moodle sites served over plain http (school intranets) keep working;
script-src stays 'self'.

No remote code, no eval, no third-party libraries, no build step: the
uploaded package is the source as written. No data is collected or sent
anywhere except requests to the Moodle site the user allowed.
```

## Version notes (1.0.0)

First release: whole-course download in folders or ZIP, links index, assignment and forum files, sync mode, course picker.
