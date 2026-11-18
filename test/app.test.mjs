import * as locale from '../public/locale.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as via from '../public/via.js';
import * as model from '../public/model.js';
import * as keys from '../public/keycodes.js';
import * as macros from '../public/macros.js';
import * as editor from '../public/editor.js';

const source = (await readFile(new URL('../public/app.js', import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/initialize\(\);\s*$/, '');

class Element {
  constructor(tag = 'div') {
    this.tag = tag; this.children = []; this.events = new Map(); this.disabled = false; this.value = ''; this.checked = false; this.dataset = {};
    this.style = { setProperty() {} }; this.classList = { toggle() {} };
  }
  addEventListener(type, handler) { this.events.set(type, handler); }
  setAttribute() {}
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll(tag) { return this.children.flatMap((child) => child instanceof Element ? [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)] : []); }
  focus() {}
  showModal() {}
  close() {}
}

function fixture() {
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const modifiers = [1, 2, 4, 8].map((value) => Object.assign(new Element('input'), { value: String(value) }));
  const document = {
    getElementById: get, createElement: (tag) => new Element(tag), createTextNode: (value) => value, body: new Element('body'), addEventListener() {},
    querySelectorAll(selector) {
      if (selector === 'input[name="modifier"]') return modifiers;
      if (selector === '.macro-slot') return get('macro-slots').querySelectorAll('button');
      if (selector.startsWith('.macro-timeline button,')) return [...['button', 'input', 'select'].flatMap((tag) => get('macro-timeline').querySelectorAll(tag)), get('macro-name'), get('macro-copy-target'), get('copy-macro')];
      if (selector === '.layer-tab') return get('layers').children;
      if (selector === '.catalog-key') return get('catalog').children;
      return [];
    },
  };
  const storage = new Map();
  const context = vm.createContext({ ...locale, VERSION: "0.5.0", ...via, ...model, ...keys, ...macros, ...editor, document, navigator: { hid: {} }, window: { addEventListener() {} }, EventSource: class { close() {} }, localStorage: { getItem: (name) => storage.get(name), setItem: (name, value) => storage.set(name, value), removeItem: (name) => storage.delete(name) }, performance, console, setTimeout });
  vm.runInContext(source + '\nthis.api = { state, history, render, renderControls, renderCatalog, syncEditor, save, startRecording, captureMacro, stopRecording, dirtyCount, assign, importBackup, restoreDraft, travelHistory, captureTest, saveTestRun, startTesting, stopTesting, currentBackup, previewChanges, configurationLines, showView };', context);
  const api = context.api;
  const map = Array.from({ length: 6 }, () => Array(90).fill(4));
  Object.assign(api.state, { connected: true, layer: 2, selected: { physical: 'A', index: 0, position: '0,0' }, baseline: map, draft: model.cloneKeymaps(map), capabilities: { macros: { count: 16, size: 2976 }, lighting: { brightness: 255, effect: 0 } }, macroBase: Array(2976).fill(0), macroDraft: Array(2976).fill(0), macroBaseNames: Array(16).fill(''), macroNames: Array(16).fill(''), lightBase: { brightness: 255, effect: 0 }, lightDraft: { brightness: 255, effect: 0 } });
  api.history.reset({ keymaps: map, macros: api.state.macroBase, lighting: api.state.lightBase, macroNames: api.state.macroNames });
  return { api, get, modifiers, storage };
}

test('saving disables existing macro inputs and ignores their edit handlers', async () => {
  const { api, get } = fixture();
  api.state.macroDraft = macros.replaceMacro(api.state.macroDraft, 16, 0, [{ type: 'text', value: 'first' }]);
  let release, written;
  api.state.client = { applyMacros: async (_before, after) => { written = [...after]; await new Promise((resolve) => { release = resolve; }); }, applyChanges: async () => {} };
  api.state.view = 'macros'; api.state.macroStep = 0;
  api.render(); const field = get('macro-timeline').querySelectorAll('input')[0];
  const saving = api.save();
  assert.equal(field.disabled, true); field.value = 'second'; field.events.get('change')();
  release(); await saving;
  assert.equal(macros.decodeMacros(written, 16)[0][0].value, 'first');
  assert.equal(macros.decodeMacros(api.state.macroBase, 16)[0][0].value, 'first');
  assert.equal(api.dirtyCount(), 0);
});

test('save baseline comes from the submitted snapshot, leaving later data dirty', async () => {
  const { api } = fixture();
  api.state.macroDraft = macros.replaceMacro(api.state.macroDraft, 16, 0, [{ type: 'text', value: 'first' }]);
  let release;
  api.state.client = { applyMacros: async () => new Promise((resolve) => { release = resolve; }), applyChanges: async () => {} };
  const saving = api.save();
  api.state.macroDraft = macros.replaceMacro(api.state.macroDraft, 16, 0, [{ type: 'text', value: 'second' }]);
  release(); await saving;
  assert.equal(macros.decodeMacros(api.state.macroBase, 16)[0][0].value, 'first');
  assert.equal(api.dirtyCount(), 1);
});

test('saved lighting uses the actual hardware level without an empty undo entry', async () => {
  const { api } = fixture();
  api.state.lightDraft = { brightness: 128, effect: 1 };
  api.state.client = { applyChanges: async () => {}, applyLighting: async () => ({ brightness: 127, effect: 1 }) };
  await api.save();
  assert.equal(api.state.lightDraft.brightness, 127);
  assert.equal(api.dirtyCount(), 0);
  assert.equal(api.history.canUndo, false);
});

test('choosing another basic key retains right Ctrl from the editor', () => {
  const { api, get, modifiers } = fixture();
  api.state.baseline[2][0] = api.state.draft[2][0] = 0x1104;
  api.state.kind = 'chord'; api.syncEditor(); assert.equal(modifiers[0].checked, true); assert.equal(get('modifier-side').value, 'right');
  get('search').value = 'B'; get('category').value = '全部'; api.renderCatalog();
  get('catalog').children.find((button) => button.textContent === 'RCtrl+B').events.get('click')();
  assert.equal(api.state.draft[2][0], 0x1105);
});

test('full recording automatically stops and retains actions for editing', () => {
  const { api, get } = fixture(); api.render(); get('record-delay-mode').value = 'none'; api.startRecording();
  const event = (type) => ({ type, code: 'KeyA', repeat: false, preventDefault() {}, stopPropagation() {} });
  for (let index = 0; index < 500; index++) { api.captureMacro(event('keydown')); api.captureMacro(event('keyup')); }
  assert.equal(api.state.recording, null);
  assert.ok(macros.decodeMacros(api.state.macroDraft, 16)[0].length > 900);
  assert.match(get('notice-text').textContent, /已保留/);
});

test('scheme import can be undone and autosaved draft can recover after reopening', () => {
  const { api, storage } = fixture();
  api.assign(5);
  const backup = model.makeBackup(api.state.baseline, { macros: api.state.macroBase, macroCount: 16, lighting: { brightness: 128, effect: 1 } });
  api.importBackup(JSON.stringify(backup), '方案');
  assert.equal(api.state.draft[2][0], 4); assert.equal(api.state.lightDraft.effect, 1);
  api.travelHistory('undo'); assert.equal(api.state.draft[2][0], 5); assert.equal(api.state.lightDraft.effect, 0);
  const reopened = fixture(); reopened.api.state.baseline[2][1] = reopened.api.state.draft[2][1] = 8;
  reopened.api.state.recovery = JSON.parse(storage.get('flow2-control.draft')); reopened.api.restoreDraft();
  assert.equal(reopened.api.state.draft[2][0], 5); assert.equal(reopened.api.state.draft[2][1], 8);
  assert.equal(reopened.api.dirtyCount(), 1);
});

test('pending recovery is preserved until the user restores or discards it', () => {
  const { api, get } = fixture();
  api.state.recovery = { savedAt: new Date().toISOString() };
  api.renderControls(); api.assign(5);
  assert.equal(api.state.draft[2][0], 4);
  assert.equal(get('restore-draft').disabled, false);
  assert.equal(get('profile-select').disabled, true);
  get('ignore-draft').events.get('click')(); api.assign(5);
  assert.equal(api.state.draft[2][0], 5);
});

test('physical test preserves ordered macro events and ignores repeated keydowns in counts', () => {
  const { api, get, storage } = fixture(); get('test-mode').value = '蓝牙'; api.startTesting();
  const event = (type, code, key, repeat = false) => ({ type, code, key, repeat, preventDefault() {}, stopPropagation() {} });
  api.captureTest(event('keydown', 'KeyF', 'f'));
  api.captureTest(event('keydown', 'KeyF', 'f', true));
  api.captureTest(event('keyup', 'KeyF', 'f'));
  api.captureTest(event('keydown', 'F13', 'F13'));
  api.captureTest(event('keyup', 'F13', 'F13'));
  assert.equal(api.state.testSequence, 'f[F13]');
  assert.equal(api.state.testTotal, 2); assert.equal(api.state.heldKeys.size, 0);
  assert.equal(api.state.testEvents.length, 5);
  get('test-mode').value = '蓝牙'; api.saveTestRun();
  const run = JSON.parse(storage.get('flow2-control.test-runs'))[0];
  assert.equal(run.mode, '蓝牙'); assert.equal(run.sequence, 'f[F13]');
  assert.equal(run.events[1].repeat, true);
});

test('physical test stops at its event limit without losing the captured sequence', () => {
  const { api } = fixture(); api.state.testing = true;
  for (let i = 0; i < 502; i++) api.captureTest({ type: i % 2 ? 'keyup' : 'keydown', code: 'KeyA', key: 'a', repeat: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(api.state.testing, false); assert.equal(api.state.testEvents.length, 500);
  assert.equal(api.state.testSequence.length, 250);
});

test('a retried two-key write keeps the original snapshot across a reopened page', async () => {
  const first = fixture();
  first.api.state.draft[2][0] = 5; first.api.state.draft[2][1] = 6;
  first.api.state.client = {
    async applyChanges(list, applied) { applied(list[0], 1, 2); throw Error('USB unplugged'); },
    async close() {},
  };
  await first.api.save();
  const pending = JSON.parse(first.storage.get('flow2-control.draft'));
  assert.equal(pending.writing, true);
  const snapshot = first.storage.get('flow2-control.previous-keymap');
  const second = fixture();
  second.api.state.previous = snapshot;
  second.storage.set('flow2-control.previous-keymap', snapshot);
  second.api.state.baseline[2][0] = second.api.state.draft[2][0] = 5;
  second.api.state.recovery = pending; second.api.restoreDraft();
  second.api.state.client = { async applyChanges(list, applied) { assert.equal(list.length, 1); applied(list[0], 1, 1); } };
  await second.api.save();
  assert.equal(second.storage.get('flow2-control.previous-keymap'), snapshot);
  assert.deepEqual(JSON.parse(snapshot).keymaps[2].slice(0, 2), [4, 4]);
  assert.deepEqual(second.api.state.baseline[2].slice(0, 2), [5, 6]);
  assert.equal(second.storage.has('flow2-control.draft'), false);
});

test('imported macro names stay with the draft until saved locally', async () => {
  const { api, storage, get } = fixture();
  const before = api.currentBackup();
  const named = { ...before, macroNames: ['复制', ...before.macroNames.slice(1)] };
  api.importBackup(JSON.stringify(named), 'profile');
  assert.equal(api.currentBackup().macroNames[0], '');
  assert.equal(api.dirtyCount(), 1);
  assert.equal(storage.has('flow2-control.macro-names'), false);
  api.state.client = {};
  await api.save();
  assert.equal(get('notice-text').textContent, '已保存到此浏览器。');
  assert.equal(JSON.parse(storage.get('flow2-control.macro-names'))[0], '复制');
  assert.equal(storage.has('flow2-control.previous-keymap'), false);
  assert.equal(api.currentBackup().macroNames[0], '复制');
});

test('names can be saved in the browser after disconnect while device edits remain drafts', async () => {
  const { api, storage, get } = fixture();
  api.state.connected = false;
  api.state.macroNames[0] = 'Navigation';
  api.state.draft[2][0] = 5;
  await api.save();
  assert.equal(api.dirtyCount(), 2);
  assert.equal(storage.has('flow2-control.macro-names'), false);
  api.state.draft[2][0] = api.state.baseline[2][0];
  api.renderControls();
  assert.equal(get('save').textContent, '保存到此浏览器');
  assert.equal(get('save').disabled, false);
  await api.save();
  assert.equal(api.dirtyCount(), 0);
  assert.equal(JSON.parse(storage.get('flow2-control.macro-names'))[0], 'Navigation');
});

test('restoring a write snapshot reunites the confirmed macro bytes with their original names', async () => {
  const { api, storage } = fixture();
  const first = api.currentBackup();
  first.macroNames[0] = 'Opening';
  first.macros.bytes = macros.replaceMacro(first.macros.bytes, 16, 0, [{ type: 'text', value: 'hello' }]);
  api.state.client = { async applyMacros() {}, async applyChanges() {} };
  api.importBackup(JSON.stringify(first), 'first'); await api.save();

  const second = api.currentBackup();
  second.macroNames[0] = 'Closing';
  second.macros.bytes = macros.replaceMacro(second.macros.bytes, 16, 0, [{ type: 'text', value: 'bye' }]);
  api.importBackup(JSON.stringify(second), 'second'); await api.save();
  api.importBackup(storage.get('flow2-control.previous-keymap'), 'snapshot');
  assert.equal(api.currentBackup().macroNames[0], 'Closing');
  await api.save();
  const restored = api.currentBackup();
  assert.equal(restored.macroNames[0], 'Opening');
  assert.deepEqual(Array.from(restored.macros.bytes), first.macros.bytes);
  assert.equal(JSON.parse(storage.get('flow2-control.macro-names'))[0], 'Opening');
});

test('review uses the changed layer and treats 127 and 128 as the same backlight level', () => {
  const { api, get } = fixture();
  api.state.draft[0][0] = 0x0806;
  api.state.lightBase.brightness = 127; api.state.lightDraft.brightness = 128;
  api.previewChanges();
  const lines = get('changes').children.map(row => row.children[0].textContent);
  assert.deepEqual(lines, ['macOS · 0,0  A → ⌘C']);
  assert.equal(get('other-changes').children.length, 0);
});

test('test mode locks at start and a finished run can be stored once', () => {
  const { api, get, storage } = fixture();
  get('test-mode').value = 'USB'; api.startTesting();
  api.captureTest({ type: 'keydown', code: 'Home', key: 'Home', preventDefault() {}, stopPropagation() {} });
  get('test-area').events.get('blur')({ relatedTarget: get('test-toggle') });
  get('test-toggle').events.get('click')();
  assert.equal(api.state.testing, false);
  get('test-mode').value = '蓝牙'; api.saveTestRun(); api.saveTestRun();
  const runs = JSON.parse(storage.get('flow2-control.test-runs'));
  assert.equal(runs.length, 1); assert.equal(runs[0].mode, 'USB');
});

test('editing a key leaves a hidden eighty-action macro timeline untouched', () => {
  const { api, get } = fixture();
  api.state.macroBase = api.state.macroDraft = macros.replaceMacro(api.state.macroDraft, 16, 0, Array.from({ length: 80 }, () => ({ type: 'tap', value: 4 })));
  api.assign(5);
  assert.equal(get('macro-timeline').children.length, 0);
  api.state.macroStep = 5; api.showView('macros');
  assert.equal(get('macro-timeline').children.length, 80);
  assert.equal(get('macro-timeline').querySelectorAll('select').length, 1);
});
