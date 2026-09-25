// Minimal static server for the built app with an SPA fallback: a missing path without an extension gets
// index.html, a missing file gets 404 (the browser logs it, so pixel-diff reports it).
// pixel-diff uses it instead of a dev server, whose tooling injects extra DOM.
//
//   node serve-dist.mjs [root]   serves root (default dist) on PORT (default 4799)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const isFile = (file) => existsSync(file) && statSync(file).isFile();

export function serveDist({ root = 'dist', port = 4799 } = {}) {
  const base = resolve(root);
  if (!existsSync(base)) throw new Error(`Nothing to serve: ${base} does not exist. Build the app first.`);
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    let file = normalize(join(base, decodeURIComponent(pathname)));
    if (file !== base && !file.startsWith(base + sep)) file = null;
    else if (!isFile(file) && isFile(join(file, 'index.html'))) file = join(file, 'index.html');
    else if (!isFile(file)) file = extname(pathname) ? null : join(base, 'index.html');
    if (!file || !isFile(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file)
      .on('error', () => res.destroy())
      .pipe(res);
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4799);
  const root = process.argv[2] ?? 'dist';
  await serveDist({ root, port });
  console.log(`Serving ${root}/ on http://127.0.0.1:${port}`);
}
