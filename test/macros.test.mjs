import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMacros, encodeActions, replaceMacro, changedMacros, macroUsage, chordActions, eventKeycode } from '../public/macros.js';
import { makeBackup, readBackup } from '../public/model.js';

const empty = () => Array(2976).fill(0);
const caps = { macros: { count: 16, size: 2976 }, lighting: { brightness: 255, effect: 0 } };

test('encodes VIA 12 text, key actions and ASCII decimal delays', () => {
  const actions = [{ type: 'text', value: 'Hi' }, ...chordActions(6, 1), { type: 'delay', value: 250 }, { type: 'tap', value: 40 }];
  assert.deepEqual(encodeActions(actions), [72, 105, 1, 2, 224, 1, 1, 6, 1, 3, 224, 1, 4, 50, 53, 48, 124, 1, 1, 40]);
  const data = replaceMacro(empty(), 16, 3, actions);
  assert.deepEqual(decodeMacros(data, 16)[3], actions);
  assert.deepEqual(changedMacros(empty(), data, 16), [3]);
  assert.equal(macroUsage(data, 16), 36);
});

test('editing one macro preserves all other macro contents', () => {
  let data = replaceMacro(empty(), 16, 0, [{ type: 'text', value: 'first' }]);
  data = replaceMacro(data, 16, 15, [{ type: 'text', value: 'last' }]);
  const updated = replaceMacro(data, 16, 7, [{ type: 'tap', value: 4 }]);
  assert.deepEqual(changedMacros(data, updated, 16), [7]);
  assert.equal(decodeMacros(updated, 16)[0][0].value, 'first');
  assert.equal(decodeMacros(updated, 16)[15][0].value, 'last');
  assert.equal(updated.length, 2976);
  assert.equal(updated.at(-1), 0);
});

test('rejects overflowing memory, unsupported text and stuck modifiers', () => {
  assert.throws(() => replaceMacro(empty(), 16, 0, [{ type: 'text', value: 'A'.repeat(2976) }]), /空间不足/);
  assert.throws(() => encodeActions([{ type: 'text', value: '中文' }]), /文本宏支持/);
  assert.throws(() => encodeActions([{ type: 'down', value: 224 }]), /松开所有/);
  assert.throws(() => encodeActions([{ type: 'delay', value: 10000 }]), /9999/);
  assert.throws(() => decodeMacros(Array(32).fill(1), 16), /不完整/);
});

test('full backup retains macros and lighting and imports version-one keymaps', () => {
  const keymaps = Array.from({ length: 6 }, () => Array(90).fill(1));
  const macros = replaceMacro(empty(), 16, 0, [{ type: 'text', value: 'test' }]);
  const backup = makeBackup(keymaps, { macros, macroCount: 16, lighting: caps.lighting });
  const restored = readBackup(JSON.stringify(backup), 6, caps);
  assert.deepEqual(restored, { keymaps, macros, lighting: caps.lighting });
  const old = { ...makeBackup(keymaps), version: 1 };
  assert.deepEqual(readBackup(JSON.stringify(old), 6), { keymaps, macros: null, lighting: null });
  assert.throws(() => readBackup(JSON.stringify(backup), 6, { ...caps, macros: { count: 16, size: 1024 } }), /容量/);
  backup.macros.bytes[2975] = 255;
  assert.throws(() => readBackup(JSON.stringify(backup), 6, caps), /未完成/);
});

test('recorder maps physical keys independently of Shift and input method', () => {
  assert.equal(eventKeycode('KeyA'), 4);
  assert.equal(eventKeycode('Digit0'), 39);
  assert.equal(eventKeycode('F12'), 69);
  assert.equal(eventKeycode('F13'), 104);
  assert.equal(eventKeycode('F24'), 115);
  assert.equal(eventKeycode('ControlRight'), 228);
  assert.equal(eventKeycode('Fn'), undefined);
});
