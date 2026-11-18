import { readRelease, layoutPath } from './release.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };

export function startServer({ port = Number(process.env.PORT || 8842), graceMs = 4000, startupMs = 60000 } = {}) {
  let release = readRelease();
  const sessions = new Set();
  let shutdownTimer;
  const scheduleShutdown = (delay) => {
    clearTimeout(shutdownTimer);
    shutdownTimer = setTimeout(() => server.close(), delay);
  };
  const server = http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405).end();
      return;
    }
    if (pathname === '/api/session' && request.method === 'GET') {
      clearTimeout(shutdownTimer);
      sessions.add(response);
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
      response.write(': connected\n\n');
      const keepalive = setInterval(() => response.write(': active\n\n'), 20000);
      response.on('close', () => {
        clearInterval(keepalive);
        sessions.delete(response);
        if (!sessions.size) scheduleShutdown(graceMs);
      });
      return;
    }
    try {
      const name = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (name === 'index.html' || name === 'release.js' || name === 'api/health') release = readRelease();
      if (name === 'api/health') {
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ app: 'flow2-control', version: release.version }));
        return;
      }
      if (name === 'release.js') {
        response.writeHead(200, { 'Content-Type': types['.js'], 'Cache-Control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : release.releaseModule);
        return;
      }
      if (name !== 'flow2-84.official.json' && !release.publicFiles.includes(name)) {
        response.writeHead(404).end('Not found');
        return;
      }
      const entry = name === 'flow2-84.official.json' ? layoutPath : path.join(root, 'public', name);
      let data = await readFile(entry);
      if (path.extname(entry) === '.html') data = data.toString('utf8').replace('<html ', '<html data-runtime="desktop" ');
      response.writeHead(200, { 'Content-Type': types[path.extname(entry)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      console.error(error.message);
      response.writeHead(500).end('Unable to read application file');
    }
  });

  server.on('close', () => clearTimeout(shutdownTimer));
  server.on('error', (error) => {
    console.error(error.code === 'EADDRINUSE'
      ? `端口 ${port} 已被占用。已有窗口可直接访问 http://127.0.0.1:${port}`
      : error.message);
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    scheduleShutdown(startupMs);
    console.log(`FLOW2 Control: http://127.0.0.1:${server.address().port}`);
  });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) startServer();
