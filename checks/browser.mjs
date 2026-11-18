import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { readBackup } from '../public/model.js';
import { replaceMacro } from '../public/macros.js';
import { project } from '../release.mjs';

const root = new URL('dist/', project);
const maps = readBackup(await readFile(new URL('examples/navigation.json', root), 'utf8'), 6).keymaps;
maps[0][13] = maps[2][13] = 0x49;
maps[2][14] = 0x7700;
maps[3].splice(1, 12, 0xbe, 0xbd, 0x7e07, 0xb4, 0x7803, 0x7804, 0xac, 0xae, 0xab, 0xa8, 0xaa, 0xa9);
maps[3].splice(16, 4, 0x7793, 0x7794, 0x7795, 0x7785);
maps[3][30] = 0x7e00;
maps[3][81] = 0x7e0d;
maps[3][13] = 0x7e0c;
maps[3][28] = 0x5225;
maps[3][68] = 0x5200;

const macros = replaceMacro(Array(2976).fill(0), 16, 0, Array.from({ length: 80 }, () => ({ type: 'tap', value: 4 })));

function installSample({ maps, macros }) {
  class SampleKeyboard extends EventTarget {
    vendorId = 0x388d;
    productId = 2;
    collections = [{ usagePage: 0xff60, usage: 0x61 }];
    async open() { this.opened = true; }
    async close() { this.opened = false; }
    async sendReport(_id, packet) {
      const r = new Uint8Array(packet);
      const address = (r[1] << 8) | r[2];
      switch (r[0]) {
        case 1: r[2] = 12; break;
        case 17: r[1] = 6; break;
        case 12: r[1] = 16; break;
        case 13: r[1] = 11; r[2] = 160; break;
        case 14: r.set(macros.slice(address, address + r[3]), 4); break;
        case 18: {
          const words = maps.flat();
          for (let i = 0; i < r[3]; i += 2) { const code = words[(address + i) / 2]; r[i + 4] = code >> 8; r[i + 5] = code & 255; }
          break;
        }
        case 4:
        case 5: {
          const pos = r[2] * 15 + r[3];
          if (r[0] === 5) maps[r[1]][pos] = (r[4] << 8) | r[5];
          const value = maps[r[1]][pos];
          r[4] = value >> 8; r[5] = value & 255; break;
        }
        case 8: r[3] = r[2] === 1 ? 127 : 0; break;
        default: r[0] = 255;
      }
      this.dispatchEvent(Object.assign(new Event('inputreport'), { reportId: 0, data: new DataView(r.buffer) }));
    }
  }
  localStorage.setItem('flow2-control.macro-names', JSON.stringify(['Copy selection to clipboard and return to editor', ...Array(15).fill('')]));
  const device = new SampleKeyboard();
  const hid = Object.assign(new EventTarget(), { getDevices: async () => [], requestDevice: async () => [device] });
  Object.defineProperty(navigator, 'hid', { value: hid, configurable: true });
}

const prefix = '/flow2-control/';
const mime = { js:'text/javascript', css:'text/css', html:'text/html', woff2:'font/woff2', json:'application/json', png:'image/png', webp:'image/webp' };
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url,'http://localhost').pathname;
  if (!path.startsWith(prefix)) { res.writeHead(404).end(); return; }
  const name = path.slice(prefix.length) || 'index.html';
  try {
    const bytes = await readFile(new URL(name, root));
    res.writeHead(200, { 'Content-Type': mime[name.split('.').at(-1)] || 'text/plain' }).end(bytes);
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server,'listening');
const browser = await chromium.launch({
  channel: process.env.FLOW2_BROWSER || 'chrome', headless: true, ignoreDefaultArgs: ['--hide-scrollbars'],
});
const base = 'http://127.0.0.1:' + server.address().port + prefix;
const errors = [];
async function capture(page, name) {
  if (!process.env.FLOW2_SCREENSHOTS) return;
  await mkdir(process.env.FLOW2_SCREENSHOTS,{recursive:true});
  await page.screenshot({path:process.env.FLOW2_SCREENSHOTS+'/'+name+'.png'});
}
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport:{width:1440,height:900}, reducedMotion:'reduce' });
  await context.addInitScript(installSample, { maps, macros });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  page.on('pageerror', e => errors.push(e.message));
  const remote = [];
  context.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('blob:')) remote.push(r.url()); });
  const q = s => page.locator(s);
  await page.goto(base); await q('#keyboard .key').first().waitFor();
  assert.equal(await q('#keyboard .key').count(),84);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange',r,{once:true})); await document.fonts.ready; });
  await context.setOffline(true);
  await page.close();
  const offline = await context.newPage(); await offline.goto(base);
  await offline.locator('#keyboard .key').first().waitFor();
  assert.equal(await offline.locator('#keyboard .key').count(),84);
  assert.equal(await offline.locator('#layer-controls').isVisible(),false);
  assert.ok(await offline.locator('#offline-guide').isVisible());
  await offline.locator('[data-view="lighting"]').click();
  assert.equal(await offline.locator('#brightness [aria-pressed="true"]').count(),0);
  assert.equal(await offline.locator('#light-effect').inputValue(),'');
  await offline.locator('[data-view="keymap"]').click();
  assert.ok(await offline.evaluate(() => document.fonts.check('14px Inter')));
  await offline.evaluate(async () => {
    const material = new Image(); material.src = './materials/top-clay.webp'; await material.decode();
  });
  await capture(offline,'disconnected');
  await offline.locator('#case-touch').click();
  await offline.locator('.side-caps i').first().evaluate(async (cap) => {
    const material = new Image();
    material.src = getComputedStyle(cap).backgroundImage.match(/^url\("(.+)"\)$/)[1];
    await material.decode();
  });
  await context.setOffline(false); await offline.close();

  const ui = await context.newPage();
  ui.on('pageerror', e => errors.push(e.message));
  ui.setDefaultTimeout(6000);
  const el = s => ui.locator(s);
  const go = async name => {
    const button = el('[data-view="' + name + '"]');
    if (!await button.isVisible()) await el('#workbench').click();
    await button.click();
  };
  await ui.goto(base); await el('#connect').click();
  await el('#connection-dot.online').waitFor();
  for (const [width,height] of [[1366,768],[820,856],[390,844]]) {
    await ui.setViewportSize({width,height});
    await el('#keyboard [data-position="0,13"]').click();
    const modes = el('.editor-tabs');
    const anchor = await modes.boundingBox();
    const searchBox = await el('#search').boundingBox();
    await el('#category').selectOption('符号');
    await el('#search').fill('Home');
    await el('[data-kind="key"]').click();
    assert.equal(await el('#search').inputValue(),'Home', 'active mode cleared the search');
    assert.ok(await el('#catalog button').filter({hasText:/^Home/}).count(), 'search outside the selected category');
    assert.deepEqual(await modes.boundingBox(),anchor);
    for (const kind of ['chord','macro','key']) {
      await el('[data-kind="'+kind+'"]').click();
      assert.deepEqual(await modes.boundingBox(),anchor,'assignment type moved at '+width);
      assert.deepEqual(await el('#search').boundingBox(),searchBox,'search field moved at '+width);
    }
    await el('#category').selectOption('常用');
    await el('#catalog button').filter({hasText:/^Home$/}).click();
    assert.deepEqual(await modes.boundingBox(),anchor,'first pending change displaced the assignment types');
    if (width===390) await capture(ui,'picker-390');
    if (width===1366) await capture(el('#key-editor'),'picker-desktop');
    await el('#undo-key').click();
    if (width<768) await el('#close-inspector').click();
  }
  await ui.setViewportSize({width:1440,height:900});
  assert.equal(await el('#macro-timeline li').count(),0);
  await el('#keyboard [data-position="0,0"]').focus();
  await ui.keyboard.press('ArrowRight'); await ui.keyboard.press('Enter');
  assert.ok(await el('#search').evaluate(e => e === document.activeElement));
  await ui.keyboard.press('Escape');
  assert.ok(await el('#keyboard [data-position="0,1"]').evaluate(e => e === document.activeElement));
  await ui.setViewportSize({width:1366,height:768});
  const headerBox = await el('.topbar').boundingBox();
  const stageBox = await el('#device-stage').boundingBox();
  const boardBox = await el('#keyboard').boundingBox();
  for (const view of ['lighting','touch','macros','backup','test','device']) {
    await go(view);
    const board = view === 'lighting' ? '#light-keyboard' : view === 'touch' ? '#keyboard' : null;
    if (board) assert.deepEqual(await el(board).boundingBox(), boardBox, 'keyboard moved in '+view);
    const panel = await el(board ? '#device-stage' : '#view-'+view).boundingBox();
    assert.deepEqual([panel.x,panel.y,panel.width], [stageBox.x,stageBox.y,stageBox.width], 'content moved in '+view);
    assert.deepEqual(await el('.topbar').boundingBox(), headerBox, 'header moved in '+view);
  }
  const scroller = el('#view-scroll');
  const bottom = await scroller.evaluate(e => { e.scrollTop = e.scrollHeight; return e.scrollTop; });
  assert.ok(bottom > 0, 'device view should have scrollable content');
  await go('device');
  assert.equal(await scroller.evaluate(e => e.scrollTop), bottom, 'active view lost its reading position');
  assert.deepEqual(await el('.topbar').boundingBox(), headerBox, 'scroll displaced the header');
  await go('backup');
  assert.equal(await scroller.evaluate(e => e.scrollTop), 0, 'new view opened partway down the page');
  await ui.setViewportSize({width:1440,height:900});
  await go('macros');
  await el('.macro-slot').first().click();
  assert.ok(await el('.binding-chip').count() > 0);
  const assignPosition = await el('#assign-macro').boundingBox();
  await el('.macro-slot').nth(2).click();
  assert.equal(await el('.binding-chip').count(), 0);
  assert.deepEqual(await el('#assign-macro').boundingBox(), assignPosition, 'macro bindings moved the assign button');
  await el('#assign-macro').click();
  assert.match(await el('#assignment-prompt').textContent(), /宏 3/);
  await go('test');
  assert.equal(await el('#module-tabs').isVisible(), false);
  await el('#workbench').click();
  const ins = el('#keyboard [data-position="0,13"]');
  await ins.click();
  assert.ok(await el('#catalog button').filter({hasText: /^Home$/}).isVisible());
  assert.ok(await el('#catalog button').filter({hasText: /^复制/}).isVisible());
  assert.equal(await el('#cancel-assignment').isVisible(), false);
  assert.equal(await el('#savebar').isVisible(), false, 'leaving macro assignment must cancel the pending target');
  await el('[data-kind="macro"]').click();
  await el('#search').fill('Home');
  assert.equal(await el('#catalog button').count(), 0);
  await el('#search').fill('M1');
  assert.match(await el('#catalog button').first().textContent(), /Copy selection/);
  await go('macros'); await el('#assign-macro').click(); await ins.click();
  assert.equal(await ins.locator('.key-face').textContent(), 'M3');
  await el('#undo-key').click();
  await el('[data-kind="chord"]').click();
  await el('input[name="modifier"][value="1"]').check();
  await el('input[name="modifier"][value="2"]').check();
  await el('#modifier-side').selectOption('right');
  await el('#search').fill('Home');
  const chord = el('#catalog button').first();
  assert.equal(await chord.getAttribute('data-code'), String(0x134a));
  assert.match(await chord.textContent(), /^RCtrl\+RShift\+Home/);
  await chord.click();
  assert.equal(await chord.getAttribute('aria-pressed'), 'true');
  assert.equal(await el('#draft-mapping').textContent(), 'RCtrl+RShift+Home');
  assert.equal(await ins.locator('.key-face small').count(), 1);
  assert.ok(await ins.locator('.key-face').evaluate(e => e.scrollWidth <= e.clientWidth));
  await el('#undo-key').click();
  await el('#system-layer').selectOption('mac');
  for (const [position, legend] of [['5,1','⌥'], ['5,2','⌘'], ['5,9','R⌘'], ['5,11','R⌥']]) {
    const key = el('#keyboard [data-position="' + position + '"]');
    assert.equal(await key.locator('.key-face').textContent(), legend);
    assert.equal(await key.locator('.key-physical').count(), 0);
  }
  await el('#keyboard [data-position="0,13"]').click();
  await el('#search').fill('复制'); await el('#catalog button').first().click();
  assert.equal(await el('#draft-mapping').textContent(),'⌘C');
  await el('[data-layer="1"]').click();
  assert.equal(await el('#keyboard [data-position="0,13"] .key-face').textContent(),'⌘C');
  assert.equal(await el('#original-mapping').textContent(),'沿用基础层 · Insert');
  assert.equal(await el('#draft-mapping').textContent(),'沿用基础层 · ⌘C');
  assert.equal(await el('#raw-code').inputValue(),'0x0001');
  assert.equal(await el('#keyboard .is-changed').count(),0);
  await el('[data-layer="0"]').click();
  await el('#review').click(); assert.match(await el('#review-list').textContent(),/⌘C/);
  await el('#close-review').click(); await el('#undo-key').click();
  await el('#system-layer').selectOption('windows');
  await el('[data-layer="3"]').click();
  const fn = el('#keyboard [data-position="5,10"]');
  await fn.click();
  assert.equal(await fn.locator('.key-face').textContent(),'Fn');
  assert.match(await el('#original-mapping').textContent(),/沿用基础层.*Windows · Fn/);
  assert.equal(await el('#raw-code').inputValue(),'0x0001');
  assert.equal(await el('#pending-mapping').isVisible(),false);
  assert.equal(await el('#keyboard [data-position="1,1"] .key-face').textContent(),'BT 1');
  assert.equal(await el('#keyboard [data-position="1,13"] .key-face').textContent(),'服务层 5');
  assert.equal(await el('#keyboard [data-position="4,8"] .key-face').textContent(),'macOS');
  assert.match(await el('#keyboard [data-position="2,0"]').getAttribute('title'),/0x7E00/);
  await el('#keyboard [data-position="0,14"]').click(); await el('#open-bound-macro').click();
  assert.equal(await el('#macro-name').inputValue(),'Copy selection to clipboard and return to editor');
  await go('keymap');
  await el('#keyboard [data-position="0,2"]').click();
  assert.equal(await el('#original-mapping').textContent(),'屏幕亮度 +');
  assert.equal(await el('#category').inputValue(),'媒体灯光');
  await capture(ui,'fn-layer');
  await el('#advanced-layers summary').click();
  await el('#advanced-layer').selectOption('4');
  assert.equal(await el('#system-layer').inputValue(),'service');
  assert.equal(await el('#original-mapping').textContent(),'沿用下层');
  assert.equal(await el('#keyboard .is-inherited').count(),0);
  await el('#system-layer').selectOption('windows');
  await fn.click();
  await el('.advanced summary').click();
  await el('#raw-code').fill('0x5221'); await el('#raw-apply').click();
  assert.equal(await fn.locator('.key-face').textContent(),'L1');
  await el('#review').click(); await el('#changes .change-item button').click();
  assert.equal(await el('#review-dialog').isVisible(),false);
  assert.equal(await fn.locator('.key-face').textContent(),'Fn');
  await el('.advanced summary').click();
  await el('#keyboard [data-position="0,13"]').click(); await el('#search').fill('Home');
  await el('#search').press('ArrowDown');
  assert.ok(await el('#catalog button').first().evaluate(e => e === document.activeElement));
  await ui.keyboard.press('Enter');
  assert.equal(await el('#draft-mapping').textContent(),'Home');
  assert.equal(await el('#keyboard [data-position="0,14"] .key-face').textContent(),'M1');
  assert.match(await el('#keyboard [data-position="0,14"]').getAttribute('title'), /Copy selection to clipboard/);
  await capture(ui,'keymap-1440');
  for (const [width,height] of [[1440,900],[1366,768],[390,844]]) {
    await ui.setViewportSize({width,height});
    if (width<768) {
      if (await el('#close-inspector').isVisible()) await el('#close-inspector').click();
      await el('#keyboard [data-position="0,13"]').click();
      assert.ok(await el('#inspector.is-open').isVisible());
      assert.ok(await el('#keyboard [data-position="0,13"] .key-face').evaluate(e=>e.scrollWidth<=e.clientWidth),'truncated Home');
      await el('#review').click();
      assert.ok(await el('#review-dialog[open]').isVisible());
      assert.ok(await el('#discard-all').isVisible());
      await el('#close-review').click();
      assert.ok(await el('#inspector.is-open').isVisible());
      await el('#save').click({trial: true});
      await capture(ui,'keymap-390');
      await el('#close-inspector').click();
      assert.equal(await el('#keyboard [data-position="0,13"]').evaluate(e=>e===document.activeElement),true);
    }
    const geometry=await ui.evaluate(()=>{
      const box=s=>document.querySelector(s).getBoundingClientRect();
      const right=box('#keyboard [data-position="2,14"]'), strip=box('#case-touch');
      const body=box('.keyboard-body'), save=box('.savebar');
      const scroller=document.querySelector('#view-scroll');
      return {overflow:document.documentElement.scrollWidth>innerWidth || scroller.scrollWidth>scroller.clientWidth,
        right:right.right,strip:strip.left,body:body.bottom,save:save.top,ratio:body.width/body.height};
    });
    assert.equal(geometry.overflow,false,'page overflow at '+width);
    assert.ok(geometry.right<=geometry.strip,'overlapping strip');
    assert.ok(Math.abs(geometry.ratio-341.2/126)<.012,'keyboard aspect');
    if (width>=1200) assert.ok(geometry.body<geometry.save,'keyboard hidden by footer');
    if (width===1366) await capture(ui,'keymap-1366');
    await el('#case-touch').click();
    if (width<768) {
      const board = await el('#keyboard').boundingBox();
      const pan = await el('#key-surface').evaluate(e => e.scrollLeft);
      assert.ok(pan > 0, 'right edge should be in view');
      await go('lighting');
      assert.deepEqual(await el('#light-keyboard').boundingBox(), board, 'backlight preview lost its place');
      await go('touch');
      assert.equal(await el('#key-surface').evaluate(e => e.scrollLeft), pan, 'touch view lost its place');
    }
    const detail = await el('#touch-detail').boundingBox();
    for (const part of ['.side-case', '.side-caps']) {
      const box = await el(part).boundingBox();
      assert.ok(box.x >= detail.x && box.x + box.width <= detail.x + detail.width &&
        box.y >= detail.y && box.y + box.height <= detail.y + detail.height, 'cropped '+part+' at '+width);
    }
    await el('[data-gesture="toggle"]').click();
    assert.ok(await el('.gesture-hold').isVisible());
    assert.equal(await el('#keyboard .is-gesture').count(),2);
    if (width===1440) {
      await capture(ui,'touch');
      await capture(el('#touch-inspector'),'touch-inspector');
    }
    if (width<768) await capture(ui,'touch-390');
    if (width<768) {
      await el('#close-inspector').click();
      await el('#key-surface').evaluate(e => { e.scrollLeft = 0; });
      await go('touch');
      await ui.keyboard.press('Escape');
      assert.ok(await el('[data-view="touch"]').evaluate(e => e === document.activeElement));
      assert.equal(await el('#key-surface').evaluate(e => e.scrollLeft), 0, 'closing the touch sheet panned the keyboard');
    } else await go('keymap');
  }
  await ui.setViewportSize({width:1440,height:900});
  await el('#language').selectOption('en');
  assert.equal(await el('#language').inputValue(),'en'); assert.match(await el('#save').textContent(),/Save/);
  await ui.setViewportSize({width:820,height:856});
  await el('#advanced-layers summary').click();
  assert.ok(await el('#mode-tip').isVisible());
  assert.ok(await el('#mode-tip').evaluate(e=>e.getBoundingClientRect().height < 30), 'hardware shortcuts wrap vertically in English');
  await el('#advanced-layers summary').click();
  await ui.setViewportSize({width:390,height:844});
  await ins.click(); await el('#save').click();
  assert.ok(await el('#inspector.is-open').isVisible());
  await el('#test-saved-key').click();
  await ui.setViewportSize({width:1440,height:900});
  assert.equal(await el('#savebar').isVisible(),false);
  assert.equal(await el('#test-status').textContent(),'Listening for keys');
  assert.match(await el('#test-prompt').textContent(),/Press physical Ins/);
  await el('#test-area').press('Home');
  assert.equal(await el('#last-key').textContent(),'Home');
  await el('#test-toggle').click(); assert.equal(await el('#test-area').getAttribute('class'),'test-area');
  await el('#test-save-run').click(); assert.ok(await el('#test-save-run').isDisabled());
  assert.equal(await el('#test-status').textContent(),'Run saved');
  assert.equal(await el('#test-prompt').textContent(),'Windows · Physical key Ins');
  await capture(ui,'tester');
  await go('macros'); assert.equal(await el('#macro-timeline li').count(),80);
  await go('test'); assert.equal(await el('#test-prompt').isVisible(),false);
  await el('#workbench').click();
  assert.ok(await el('#view-macros').isVisible(), 'return to the last workspace module');
  await el('.step-number').nth(12).click(); assert.equal(await el('#macro-timeline select').count(),1);
  const stepEditor = await el('#macro-timeline select').elementHandle();
  await capture(ui,'macros');
  await go('lighting'); await capture(ui,'backlight');
  assert.ok(await el('[data-level="2"]').getAttribute('aria-pressed')==='true');
  await go('keymap'); await el('#keyboard [data-position="0,13"]').click();
  await el('#search').fill('End'); await el('#catalog button').filter({hasText:/^End/}).first().click();
  assert.ok(await stepEditor.evaluate(e=>e === document.querySelector('#macro-timeline select')), 'hidden macro step editor was rebuilt');
  await el('#undo-key').click(); await stepEditor.dispose();
  await el('#keyboard [data-position="0,14"]').click(); await el('#open-bound-macro').click();
  assert.equal(await el('#macro-name').inputValue(),'Copy selection to clipboard and return to editor');
  await el('.binding-chip').first().click();
  assert.ok(await el('#view-keymap').isVisible());
  await el('[data-layer="3"]').click();
  await el('#keyboard [data-position="0,13"]').click();
  await el('#search').fill('Home'); await el('#catalog button').first().click();
  await el('#save').click(); await el('#test-saved-key').click();
  assert.match(await el('#test-prompt').textContent(),/Windows · Fn · Hold Fn, then press physical Ins/);
  await el('#test-toggle').click(); await go('keymap');
  await el('[data-layer="2"]').click(); await ins.click();
  await el('#search').fill('End'); await el('#catalog button').first().click();
  await el('#connect').click();
  assert.equal(await el('#base-label').textContent(), 'Last read');
  assert.equal(await el('.action-picker').isVisible(), false);
  assert.equal(await el('#save').textContent(), 'Reconnect keyboard');
  await go('macros'); await el('.macro-slot').nth(1).click();
  assert.match(await el('#macro-status').textContent(), /0 actions · Last read/);
  await el('.macro-slot').first().click();
  assert.equal(await el('#macro-timeline li').count(), 80);
  assert.equal(await el('#macro-timeline button, #macro-timeline input, #macro-timeline select').count(), 0);
  await go('keymap');
  await ui.setViewportSize({width:390,height:844}); await ins.click();
  assert.ok(await el('#inspector.is-open').isVisible());
  await el('#review').click(); await el('#review-save').click();
  await el('#restore-draft:focus').waitFor();
  assert.equal(await el('#inspector.is-open').count(),0);
  await el('#restore-draft').click(); await el('#action-confirm').click();
  await go('keymap'); await ins.click();
  assert.equal(await el('#original-mapping').textContent(),'Home');
  assert.equal(await el('#draft-mapping').textContent(),'End');
  await el('#undo-key').click(); await el('#close-inspector').click();
  const reader = await browser.newContext({locale:'en'});
  await reader.addInitScript(() => { Object.defineProperty(navigator, 'hid', {value:undefined, configurable:true}); });
  const library = await reader.newPage();
  library.on('pageerror', e => errors.push(e.message));
  await library.goto(base); await library.locator('#keyboard .key').first().waitFor();
  assert.equal(await library.locator('#guide-title').textContent(),'Keyboard layout preview');
  await library.locator('#profile-select').selectOption('library');
  assert.ok(await library.locator('#view-backup').isVisible());
  await library.locator('#sample-profile').click();
  await library.locator('#action-dialog[open]').waitFor();
  assert.equal(await library.locator('#action-diff details').count(),6);
  await library.locator('#action-cancel').click();
  const profilePath = new URL('examples/navigation.json',root);
  await library.locator('#import-file').setInputFiles({name:'Navigation sample.json',mimeType:'application/json',buffer:await readFile(profilePath)});
  await library.locator('#action-dialog[open]').waitFor();
  assert.equal(await library.locator('#action-title').textContent(),'Navigation sample');
  assert.ok(await library.locator('#connect').isDisabled());
  await ui.setViewportSize({width:390,height:844});
  for (const name of ['macros','lighting','backup','test','device']) {
    await go(name);
    assert.ok(await scroller.evaluate(e=>e.scrollWidth<=e.clientWidth && document.documentElement.scrollWidth<=innerWidth),'page overflow in '+name);
  }
  await reader.close();
  assert.deepEqual(remote,[]); assert.deepEqual(errors,[]);
  console.log('Passed · offline reopen, 1440/1366/820/390px layouts, mobile save and review, key and chord selection, macro targeting, readback tester, disconnect and draft recovery');
} finally { await browser.close(); server.closeAllConnections(); server.close(); }
