import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildLayout, diffKeymaps, cloneKeymaps, makeBackup, readBackup, parseKeycode } from '../public/model.js';

const definition = JSON.parse(await readFile(new URL('../flow2-84.official.json', import.meta.url), 'utf8'));
const sample = () => Array.from({ length: 6 }, () => Array(90).fill(0));

test('uses all 84 vendor matrix positions, including the top-row Print key', () => {
  const layout = buildLayout(definition);
  assert.equal(layout.flat().length, 84);
  assert.equal(new Set(layout.flat().map((key) => key.position)).size, 84);
  assert.equal(layout[0][13].position, '3,12');
  assert.ok(layout.every((row) => row.reduce((sum, key) => sum + key.width, 0) === 16));
});

test('draft edits remain separate from the device snapshot', () => {
  const original = sample();
  const draft = cloneKeymaps(original);
  draft[2][46] = 0x7e07;
  assert.equal(original[2][46], 0);
  assert.deepEqual(diffKeymaps(original, draft), [{ layer: 2, row: 3, col: 1, index: 46, before: 0, after: 0x7e07 }]);
});

test('backup round-trip preserves custom and layer keycodes exactly', () => {
  const keymaps = sample();
  keymaps[0][0] = 0x7e07;
  keymaps[1][1] = 0x5221;
  keymaps[5][89] = 0xffff;
  assert.deepEqual(readBackup(JSON.stringify(makeBackup(keymaps)), 6).keymaps, keymaps);
});

test('rejects backups for another model, wrong layer counts, and invalid keycodes', () => {
  const backup = makeBackup(sample());
  assert.throws(() => readBackup(JSON.stringify({ ...backup, productId: 1 }), 6), /型号/);
  assert.throws(() => readBackup(JSON.stringify(backup), 4), /层数/);
  backup.keymaps[0][0] = -1;
  assert.throws(() => readBackup(JSON.stringify(backup), 6), /无效键码/);
});

test('accepts 16-bit raw keycodes without silently truncating invalid input', () => {
  assert.equal(parseKeycode('0x7E07'), 0x7e07);
  assert.equal(parseKeycode('65535'), 65535);
  assert.throws(() => parseKeycode('65536'));
  assert.throws(() => parseKeycode('0x29garbage'));
  assert.throws(() => parseKeycode('-1'));
});
