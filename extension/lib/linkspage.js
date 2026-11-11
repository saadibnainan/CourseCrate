import { escapeHtml } from './util.js';

/** A small, self-contained page listing a section's links. Opens offline in any browser. */
export function renderLinksPage({ courseName, sectionTitle, links, savedAt = new Date() }) {
  const items = links.map((l) => {
    const host = (() => { try { return new URL(l.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    return `<li>
  <a href="${escapeHtml(l.url)}">${escapeHtml(l.name || l.url)}</a>
  <span class="host">${escapeHtml(host)}</span>
  ${l.description ? `<p>${escapeHtml(l.description)}</p>` : ''}
</li>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(sectionTitle)} · Links</title>
<style>
  :root { color-scheme: light dark; --ink:#1d1b16; --muted:#6b665c; --line:#e4dfd3; --accent:#b4501a; --bg:#faf8f4; }
  @media (prefers-color-scheme: dark) { :root { --ink:#ede8dd; --muted:#a39c8d; --line:#332f27; --accent:#f08a4b; --bg:#16140f; } }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:720px; margin:0 auto; padding:40px 20px 64px; }
  .kicker { color:var(--muted); font-size:13px; letter-spacing:.04em; text-transform:uppercase; margin:0 0 4px; }
  h1 { font-size:26px; line-height:1.2; margin:0 0 28px; }
  ul { list-style:none; margin:0; padding:0; }
  li { padding:14px 0; border-top:1px solid var(--line); }
  a { color:var(--accent); font-weight:600; text-decoration:none; overflow-wrap:anywhere; }
  a:hover { text-decoration:underline; }
  .host { color:var(--muted); font-size:13px; margin-left:8px; }
  p { margin:4px 0 0; color:var(--muted); font-size:14px; }
  footer { margin-top:32px; color:var(--muted); font-size:12px; }
</style>
</head>
<body>
<main>
  <p class="kicker">${escapeHtml(courseName)}</p>
  <h1>${escapeHtml(sectionTitle)}: links</h1>
  <ul>
${items}
  </ul>
  <footer>Saved by CourseCrate on ${escapeHtml(savedAt.toLocaleDateString())}.</footer>
</main>
</body>
</html>
`;
}
