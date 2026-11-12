# Chrome Web Store listing: CourseCrate

Copy these fields into the Chrome Web Store Developer Dashboard
(https://chrome.google.com/webstore/devconsole). Build the package with
`npm run build:chrome` and upload `dist/coursecrate-chrome-<version>.zip`.

One-time: a developer account costs a single US$5 registration fee, and the
account needs a verified contact email before you can publish.

---

## Package tab

Upload `dist/coursecrate-chrome-1.1.0.zip`. The name, summary (manifest
`description`, 132 characters max) and icon come from the package.

## Store listing tab

### Description

> Plain text: the store does not render Markdown. Paste as is.

```text
Your whole Moodle course, saved in one click, sorted the way the course is.

Open a course, click CourseCrate, press Download. You get a folder per section, with every file numbered in course order:

CourseCrate / Psychology in Cinema / 01 - Background information / 02 - Lecture slides.pdf

WHAT IT SAVES
• File and Folder activities (PDFs, slides, documents, audio, video), with their sub-folders
• Files and media placed in section text and text & media areas
• Files linked inside Pages and Books
• Assignment briefs, your own submitted files and teacher feedback
• Forum attachments, in a folder per discussion
• A Links.html page in each section with every web link, URL activity and embedded YouTube/Vimeo video

BUILT FOR THE WHOLE SEMESTER
• Sync: run it again any time and only new or changed files download. Files you already have are marked "Have it".
• Folders or ZIP: stream files straight into your Downloads folder (any size), or pack the course into a single ZIP.
• Pick and choose: tick or untick whole sections, activities or single files before downloading.
• Readable names: name files after the activity ("Lecture 3 slides.pdf") or keep their original names.
• Course picker: click the button anywhere on your Moodle site to choose from your courses.

PRIVATE BY DESIGN
CourseCrate uses the Moodle login you already have in Chrome, so there's no password, token or site setup. It only talks to the Moodle sites you allow (Chrome asks once per site). No analytics, no servers, nothing is sent anywhere: everything stays on your computer.

WORKS WITH
Moodle 4.x and 5.x, including "one section per page" courses and subsections, with a fallback for Moodle 3.x. Any university or school Moodle you can log in to.

GOOD TO KNOW
• Online-only activities such as quizzes, lessons, H5P and wikis have nothing to download and are skipped.
• Moodle logs CourseCrate's page visits like your own clicks, so "view" completion may be marked.
• New extension buttons sit in Chrome's puzzle-piece menu. Pin CourseCrate for one-click access.
• Please respect your institution's rules on course material.

Open source (MIT): https://github.com/saadibnainan/CourseCrate

Moodle™ is a registered trademark of Moodle Pty Ltd. CourseCrate is an independent project and is not affiliated with or endorsed by Moodle.
```

### Category

**Education** (under Productivity). Fallback: **Tools**.

### Language

English

### Graphic assets

| Field | File |
| --- | --- |
| Store icon (128×128, required) | `extension/icons/icon-128.png` |
| Screenshots (1280×800, 1 to 5) | in this order: `screenshots/1-course.png`, `screenshots/3-done.png`, `screenshots/4-courses.png`, `screenshots/2-permission.png`, `screenshots/6-settings.png` |
| Small promo tile (440×280, optional; listings without it rank lower) | `chrome/small-promo-440x280.png` |
| Marquee promo tile (1400×560, optional; needed to be featured) | `chrome/marquee-1400x560.png` |

All screenshots and tiles are 24-bit PNG with no alpha channel, taken from the
Chrome build in Chromium. The tiles are rendered from `chrome/promo.html`.
The store allows 5 screenshots, so `5-start.png` is left out here.

### Additional fields

- Homepage URL: https://github.com/saadibnainan/CourseCrate
- Support URL: https://github.com/saadibnainan/CourseCrate/issues
- Official URL: leave empty (needs a domain verified in Search Console)
- Mature content: No

## Privacy tab

### Single purpose

```text
CourseCrate downloads the files of a Moodle course the user is logged in to and saves them to the user's computer, sorted into one folder per course section.
```

### Permission justifications

**activeTab**
```text
When the user clicks the CourseCrate toolbar button, CourseCrate needs temporary access to that one tab to check whether it is a Moodle page and read which Moodle site and course it shows. Nothing runs on any tab the user has not clicked the button on.
```

**scripting**
```text
Used together with activeTab, only on a toolbar click: CourseCrate runs one small function (detectMoodle in background.js) in the clicked tab that reads the Moodle site address and course id from the page. It does not change the page, and no other script is ever injected.
```

**downloads**
```text
Core feature: saves the course files to the user's Downloads folder (one file at a time, in a folder per section), or saves one ZIP of the course. Also used to show the saved files in the file manager and, if the user wants, to clear finished course files from Chrome's download list.
```

**storage**
```text
Stores, on the user's computer only: CourseCrate's settings, the list of files already saved from each course (so later runs only fetch new files), and the last 12 courses opened (shown on the start page). Nothing is synced or sent anywhere.
```

**Host permissions** (`optional_host_permissions`: `https://*/*`, `http://*/*`)
```text
Optional and requested at runtime, one Moodle site at a time, with a button the user must click ("Allow on this site"). Moodle is self-hosted by every university and school on its own domain, so the extension can't list the domains in advance. Once the user allows a site, CourseCrate reads that site's course pages and downloads its files with the user's existing login, just like the user clicking through the course. It never requests access to any site the user didn't approve. http is included because some school Moodle sites run on internal http addresses.
```

### Remote code

**No, I am not using remote code.** All JavaScript is in the package. No eval, no remotely loaded scripts, no third-party libraries.

### Data usage

Chrome counts data that an extension handles only on the device as data you must
declare. Tick:

- [x] **Website content**: the extension reads the Moodle course pages and files the user asks it to download, to list and save them.

Leave every other category unticked (no personal info, health, financial,
authentication, communications, location, web history or user activity data).

Certify all three:

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

### Privacy policy URL

https://github.com/saadibnainan/CourseCrate/blob/main/PRIVACY.md

## Distribution tab

- Payments: Free
- Visibility: Public
- Regions: All regions

## Test instructions tab (for the reviewer)

Username: `student`  Password: `moodle26`

```text
CourseCrate downloads the content of a Moodle course the user is logged in to.

How to test (public Moodle demo, resets every hour):
1. Go to https://school.moodledemo.net/login/index.php and log in as
   username "student", password "moodle26" (the login page always shows the
   current demo password if it has changed).
2. Open https://school.moodledemo.net/course/view.php?id=62
   ("Psychology in Cinema").
3. Click the CourseCrate toolbar button (in the puzzle-piece Extensions menu
   if not pinned). A CourseCrate tab opens; click "Allow on this site" and
   accept Chrome's prompt for school.moodledemo.net.
4. Press "Download 7 files". Files appear under Downloads/CourseCrate/.
   Switch "Save as" to "ZIP file" to test the ZIP path.

Host permissions are optional and only requested for the Moodle site the
user approves. No data leaves the computer except requests to that site.
The package is the source as written: no bundler, no minification.
```

## Version notes (1.1.0)

First Chrome release. Same features as the Firefox version: whole-course download in folders or ZIP, links index, assignment and forum files, sync mode, course picker.
