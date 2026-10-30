// A tiny static file server for local preview and the browser tests. Usage: npm start [-- port]
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.json': 'application/json', '.woff': 'font/woff', '.jpg': 'image/jpeg',
  '.py': 'text/plain; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm'
};

export function serve(dir = resolve(fileURLToPath(import.meta.url), '../..'), port = 0) {
  const server = http.createServer(async (req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(dir, path));
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'Content-Type': TYPES['.html'] });
      res.end(await readFile(join(dir, '404.html')).catch(() => 'Not found'));
    }
  });
  return new Promise(ok => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve(undefined, Number(process.argv[2]) || 8080);
  console.log(`Serving on http://127.0.0.1:${server.address().port}`);
}
