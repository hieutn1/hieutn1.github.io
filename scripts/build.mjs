// Copies the files that make up the site into _site/, which is what gets deployed.
import { cp, mkdir, rm, access } from 'node:fs/promises';

const FILES = ['index.html', '404.html', 'robots.txt', 'sitemap.xml', 'CNAME', 'assets', 'notes'];
await rm('_site', { recursive: true, force: true });
await mkdir('_site');
for (const f of FILES) {
  try { await access(f); } catch { continue; }
  await cp(f, `_site/${f}`, { recursive: true });
}
console.log('Built _site/');
