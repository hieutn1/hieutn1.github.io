// Creates the page for a new note from scripts/note-template.html.
// Usage: node scripts/new-note.mjs <folder-name> "<Title>" "<Subject>" "<Status>" "<One-paragraph description>"
// Example: node scripts/new-note.mjs quantum-field-theory "Quantum Field Theory" Physics "In progress" "Notes on QFT."
// Then add a matching <li class="entry"> to the Notes list in index.html (its title must match).
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';

const [slug, title, subject, status, description] = process.argv.slice(2);
if (!slug || !title || !subject || !status || !description || !/^[a-z0-9-]+$/.test(slug)) {
  console.error('Usage: node scripts/new-note.mjs <folder-name> "<Title>" "<Subject>" "<Status>" "<Description>"\n(folder-name: lowercase letters, digits and hyphens)');
  process.exit(1);
}
const dir = `notes/${slug}`;
if (await access(`${dir}/index.html`).then(() => true, () => false)) { console.error(`${dir}/index.html already exists`); process.exit(1); }
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
let page = await readFile('scripts/note-template.html', 'utf8');
for (const [k, v] of Object.entries({ SLUG: slug, TITLE: esc(title), SUBJECT: esc(subject), STATUS: esc(status), DESCRIPTION: esc(description) })) page = page.replaceAll(`{{${k}}}`, v);
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/index.html`, page);
console.log(`Created ${dir}/index.html. Now add this to the Notes list in index.html:

        <li class="entry" data-subject="${subject}">
          <h2><a href="notes/${slug}/">${esc(title)}</a></h2>
          <p class="meta"><span>${esc(subject)}</span><span>${esc(status)}</span></p>
          <p>${esc(description)}</p>
        </li>`);
