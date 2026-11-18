import test from 'node:test';
import assert from 'node:assert/strict';
import { copyConfiguration, EditHistory, rebaseConfiguration, macroBindings } from '../public/editor.js';
import { MacroRecorder, decodeMacros, replaceMacro, replaceActionKey, encodeActions } from '../public/macros.js';
import { keycodeModifiers, withModifiers, keyCatalog } from '../public/keycodes.js';
import { makeBackup, readBackup } from '../public/model.js';

const config = () => ({ keymaps: Array.from({ length: 6 }, () => Array(90).fill(4)), macros: Array(2976).fill(0), lighting: { brightness: 255, effect: 0 }, macroNames: Array(16).fill('') });

test('history restores complete edits and drops redo after a new branch', () => {
  const history = new EditHistory();
  const base = config(); history.reset(base);
  const first = copyConfiguration(base); first.keymaps[2][0] = 5; first.macroNames[0] = '复制'; history.record(first);
  const second = copyConfiguration(first); second.lighting.effect = 1; history.record(second);
  first.keymaps[2][0] = 9;
  assert.equal(history.undo().keymaps[2][0], 5);
  assert.equal(history.redo().lighting.effect, 1);
  history.undo(); history.record(base);
  assert.equal(history.canRedo, false);
  assert.equal(history.undo().macroNames[0], '复制');
});

test('restoring a draft changes only edited keys, macro slots and light properties', () => {
  const before = config(), draft = config(), actual = config();
  draft.keymaps[2][1] = 0x1105; actual.keymaps[2][2] = 9;
  draft.lighting.effect = 1; actual.lighting.brightness = 128;
  draft.macros = replaceMacro(draft.macros, 16, 0, [{ type: 'text', value: 'draft' }]);
  actual.macros = replaceMacro(actual.macros, 16, 1, [{ type: 'text', value: 'external' }]);
  draft.macroNames[0] = '输入';
  const result = rebaseConfiguration(before, draft, actual, 16);
  assert.equal(result.keymaps[2][1], 0x1105); assert.equal(result.keymaps[2][2], 9);
  assert.deepEqual(result.lighting, { brightness: 128, effect: 1 });
  assert.equal(decodeMacros(result.macros, 16)[0][0].value, 'draft');
  assert.equal(decodeMacros(result.macros, 16)[1][0].value, 'external');
  assert.equal(result.macroNames[0], '输入');
});

test('interrupted macro data is replaced by the complete retained draft', () => {
  const before = config(), draft = config(), actual = config();
  draft.macros = replaceMacro(draft.macros, 16, 2, [{ type: 'text', value: 'complete' }]);
  actual.macros.fill(1); actual.macros[2975] = 255;
  assert.deepEqual(rebaseConfiguration(before, draft, actual, 16).macros, draft.macros);
});

test('restoring only a key edit preserves every existing macro byte', () => {
  const before = config(), draft = config(), actual = config();
  draft.keymaps[2][0] = 5;
  actual.macros[40] = 65;
  assert.deepEqual(rebaseConfiguration(before, draft, actual, 16).macros, actual.macros);
});

test('recording stops at capacity and retains balanced keys, including held modifiers', () => {
  const recorder = new MacroRecorder(Array(80).fill(0), 16, 0, { delayMode: 'none' });
  assert.equal(recorder.record(224, true, 0), true);
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    if (!recorder.record(4, true, i * 2 + 1) || !recorder.record(4, false, i * 2 + 2)) { stopped = true; break; }
  }
  assert.equal(stopped, true);
  const actions = recorder.finish();
  assert.ok(actions.length > 2);
  assert.deepEqual(actions.at(-1), { type: 'up', value: 224 });
  const result = replaceMacro(Array(80).fill(0), 16, 0, actions);
  assert.ok(encodeActions(actions).length <= 63);
  assert.deepEqual(decodeMacros(result, 16)[0], actions);
});

test('recording uses fixed delays and ignores repeats and unmatched releases', () => {
  const recorder = new MacroRecorder(config().macros, 16, 0, { delayMode: 'fixed', fixedDelay: 80 });
  recorder.record(4, false, 0); recorder.record(4, true, 1); recorder.record(4, true, 4); recorder.record(4, false, 1000);
  assert.deepEqual(recorder.finish(), [{ type: 'down', value: 4 }, { type: 'delay', value: 80 }, { type: 'up', value: 4 }]);
});

test('changing a paired key updates its release and prevents conflicting holds', () => {
  const actions = [{ type: 'down', value: 224 }, { type: 'down', value: 4 }, { type: 'up', value: 4 }, { type: 'up', value: 224 }];
  const changed = replaceActionKey(actions, 2, 5);
  assert.equal(changed[1].value, 5); assert.equal(changed[2].value, 5);
  assert.throws(() => replaceActionKey(actions, 1, 224), /重复按下/);
});

test('right modifiers and macOS shortcut presets preserve their intended codes', () => {
  const { mask, side } = keycodeModifiers(0x1104);
  assert.equal(withModifiers(5, mask, side), 0x1105);
  assert.equal(keyCatalog(6, 16, 'mac').find((key) => key.label === '复制').code, 0x0806);
});

test('backups retain macro names and bindings include every configuration layer', () => {
  const value = config(); value.macroNames[0] = '常用文字'; value.keymaps[2][7] = 0x7700; value.keymaps[0][4] = 0x7700;
  const backup = makeBackup(value.keymaps, { ...value, macroCount: 16 });
  assert.deepEqual(readBackup(JSON.stringify(backup), 6, { macros: { count: 16, size: 2976 }, lighting: true }).macroNames, value.macroNames);
  assert.deepEqual(macroBindings(value.keymaps, 0), [{ layer: 0, index: 4 }, { layer: 2, index: 7 }]);
});
