import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Локальная раздача miniapp (в MAX нужен публичный https-URL на index.html). */
export function startMiniAppServer(port: number, rootDir: string): void {
  const root = path.resolve(rootDir);
  const server = createServer(async (req, res) => {
    try {
      const pathname = (req.url ?? '/').split('?')[0] || '/';
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
      const normalized = path.normalize(rel);
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const filePath = path.join(root, normalized);
      if (!filePath.startsWith(root)) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const data = await readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  server.listen(port, () => {
    console.log(`Mini-app static server: http://127.0.0.1:${port}/`);
    console.log('Укажите публичный https-URL этого index.html в настройках бота MAX (кнопка «Старт»).');
  });
}
