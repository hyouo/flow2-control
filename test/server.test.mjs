import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startServer } from '../server.mjs';

async function openSession(port) {
  const request = http.get(`http://127.0.0.1:${port}/api/session`);
  const [response] = await once(request, 'response');
  await once(response, 'data');
  return request;
}

test('serves the app and stays alive until the last window closes', async () => {
  const server = startServer({ port: 0, graceMs: 30, startupMs: 2000 });
  await once(server, 'listening');
  const port = server.address().port;
  const first = await openSession(port);
  const second = await openSession(port);
  const health = await fetch(`http://127.0.0.1:${port}/api/health`);
  assert.equal((await health.json()).app, 'flow2-control');
  const page = await fetch(`http://127.0.0.1:${port}/`);
  assert.match(await page.text(), /FLOW2 Control/);
  assert.equal((await fetch('http://127.0.0.1:' + port + '/macros.js')).status, 200);
  first.destroy();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(server.listening, true);
  const closed = once(server, 'close');
  second.destroy();
  await closed;
  assert.equal(server.listening, false);
});

test('exits when no browser window opens', async () => {
  const server = startServer({ port: 0, startupMs: 30 });
  await once(server, 'close');
  assert.equal(server.listening, false);
});

test('reloading an open desktop server picks up new artwork and release metadata', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'flow2-reload-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const file of ['server.mjs', 'release.mjs', 'package.json', 'flow2-84.official.json']) {
    await copyFile(new URL('../' + file, import.meta.url), path.join(dir, file));
  }
  const assets = path.join(dir, 'public');
  await mkdir(assets);
  await writeFile(path.join(assets, 'index.html'), '<html lang="en"></html>');
  const { startServer } = await import(pathToFileURL(path.join(dir, 'server.mjs')));
  const server = startServer({ port: 0 });
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = 'http://127.0.0.1:' + server.address().port;
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ version: '1.1.0' }));
  await mkdir(path.join(assets, 'materials'));
  await writeFile(path.join(assets, 'materials', 'new.webp'), 'updated asset');
  await (await fetch(url + '/')).text();
  assert.equal(await (await fetch(url + '/materials/new.webp')).text(), 'updated asset');
  assert.match(await (await fetch(url + '/release.js')).text(), /"1\.1\.0"[\s\S]*"materials\/new\.webp"/);
  assert.equal((await (await fetch(url + '/api/health')).json()).version, '1.1.0');
});
