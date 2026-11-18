import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { startServer } from '../server.mjs';

const channel = process.argv[2] || 'chrome';
if (!['chrome', 'msedge'].includes(channel)) throw Error('Choose chrome or msedge.');
const run = new Date().toISOString().replaceAll(':', '-');
const directory = new URL('../.local/hardware/' + run + '-' + channel + '/', import.meta.url);
await mkdir(directory, { recursive: true });
const server = startServer({ port: 0, startupMs: 120000, graceMs: 60000 });
await once(server, 'listening');
const address = 'http://127.0.0.1:' + server.address().port + '/';
let browser, page, baseline, restoreNeeded = false;

async function snapshot(name) {
  await page.locator('[data-view="backup"]').click();
  const download = page.waitForEvent('download');
  await page.locator('#export').click();
  const bytes = await readFile(await (await download).path());
  await writeFile(new URL(name + '.json', directory), bytes);
  return JSON.parse(bytes);
}

async function connect() {
  await page.locator('#keyboard .key').first().waitFor();
  if (!await page.locator('#connection-dot.online').count()) {
    await page.locator('#connect').click();
    console.log('Choose Flow2@Lofree in ' + channel + ' at ' + address);
  }
  await page.locator('#connection-dot.online').waitFor({ timeout: 600000 });
}
async function waitForSave() {
  await page.waitForFunction(() => !document.body.classList.contains('busy') &&
    document.getElementById('connection-dot').classList.contains('online') &&
    document.getElementById('save').hidden, null, { timeout: 30000 });
}

try {
  browser = await chromium.launch({ channel, headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: null });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(address, { waitUntil: 'domcontentloaded' });
  await connect();
  baseline = await snapshot('before');
  assert.equal(baseline.keymaps.length, 6);
  assert.equal(baseline.macros?.bytes.length, 2976);
  assert.ok(baseline.lighting);
  await page.locator('#workbench').click();
  await page.locator('#system-layer').selectOption('windows');
  await page.locator('[data-layer="2"]').click();
  await page.locator('#keyboard [data-position="0,13"]').click();
  if (baseline.keymaps[2][13] !== 0x4a) {
    await page.locator('#search').fill('Home');
    await page.locator('#catalog button').filter({hasText:/^Home/}).first().click();
    assert.equal(await page.locator('#draft-mapping').textContent(), 'Home');
    restoreNeeded = true;
    await page.locator('#save').click(); await waitForSave();
    await page.locator('#test-saved-key').click();
  } else {
    await page.locator('[data-view="test"]').click();
    await page.locator('#test-toggle').click();
  }
  await page.bringToFront(); await page.locator('#test-area').focus();
  console.log('Press the physical Ins key once. Waiting for Home press and release in ' + channel + '.');
  await page.waitForFunction(() => {
    const lines = document.getElementById('test-events').textContent.split('\n');
    return ['按下','松开'].every(type => lines.some(line => line.includes(type) && line.includes('Home')));
  }, null, { timeout: 180000 });
  await page.locator('#test-save-run').click();
  const events = await page.evaluate(() => JSON.parse(localStorage.getItem('flow2-control.test-runs')).at(-1).events
    .filter(event => event.code === 'Home' && event.key === 'Home').map(({type,code,key,repeat}) => ({type,code,key,repeat})));
  assert.ok(events.some(e => e.type === 'keydown') && events.some(e => e.type === 'keyup'));
  await writeFile(new URL('home-events.json', directory), JSON.stringify(events,null,2));
  console.log('Physical Home press and release received.');
} finally {
  try {
    if (restoreNeeded) {
      if (!page || page.isClosed()) throw Error('Reconnect and import the saved before.json to restore this keyboard.');
      if (!await page.locator('#connection-dot.online').count()) await connect();
      const pending = page.locator('#recovery-banner');
      if (await pending.isVisible()) await page.locator('#ignore-draft').click();
      await page.locator('[data-view="backup"]').click();
      await page.locator('#import-file').setInputFiles({
        name:'before.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(baseline)),
      });
      await page.locator('#action-confirm').click();
      if (await page.locator('#save').isVisible()) { await page.locator('#save').click(); await waitForSave(); }
      await page.locator('[data-view="keymap"]').click();
      await page.locator('#refresh').click(); await waitForSave();
      const actual = await snapshot('restored');
      for (const key of ['keymaps','macros','lighting','macroNames']) assert.deepEqual(actual[key], baseline[key], key);
      console.log('Restored and read back all 540 positions, macro bytes, lighting and local names.');
    }
  } finally {
    await browser?.close(); server.closeAllConnections(); server.close();
    console.log('Local acceptance records: ' + directory.pathname);
  }
}
