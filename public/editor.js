import { brightnessLevel, sameLighting } from './via.js';
import { changedMacros, mergeMacroChanges, equalBytes } from './macros.js';

export function copyConfiguration(value) {
  return {
    keymaps: value.keymaps.map((layer) => [...layer]),
    macros: value.macros ? [...value.macros] : null,
    lighting: value.lighting ? { ...value.lighting } : null,
    macroNames: [...(value.macroNames || [])],
  };
}

export function sameConfiguration(a, b) {
  if (!a || !b) return false;
  const sameArray = (left, right) => left?.length === right?.length && (left || []).every((value, index) => value === right[index]);
  return a.keymaps.length === b.keymaps.length && a.keymaps.every((layer, index) => sameArray(layer, b.keymaps[index]))
    && sameArray(a.macros, b.macros) && sameArray(a.macroNames || [], b.macroNames || [])
    && a.lighting?.brightness === b.lighting?.brightness && a.lighting?.effect === b.lighting?.effect;
}

export class EditHistory {
  constructor(limit = 50) { this.limit = limit; this.items = []; this.index = -1; }
  reset(configuration) { this.items = [copyConfiguration(configuration)]; this.index = 0; }
  record(configuration) {
    if (sameConfiguration(this.items[this.index], configuration)) return false;
    this.items.splice(this.index + 1);
    this.items.push(copyConfiguration(configuration));
    if (this.items.length > this.limit) this.items.shift();
    this.index = this.items.length - 1;
    return true;
  }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index >= 0 && this.index < this.items.length - 1; }
  undo() { return this.canUndo ? copyConfiguration(this.items[--this.index]) : null; }
  redo() { return this.canRedo ? copyConfiguration(this.items[++this.index]) : null; }
}

export function rebaseConfiguration(before, draft, actual, macroCount) {
  const result = copyConfiguration(actual);
  draft.keymaps.forEach((layer, layerIndex) => layer.forEach((value, index) => {
    if (value !== before.keymaps[layerIndex][index]) result.keymaps[layerIndex][index] = value;
  }));
  if (before.macros && draft.macros && actual.macros && !equalBytes(before.macros, draft.macros)) {
    result.macros = actual.macros.at(-1) !== 0 ? [...draft.macros] : mergeMacroChanges(before.macros, draft.macros, actual.macros, macroCount);
  }
  if (before.lighting && draft.lighting && result.lighting) {
    if (brightnessLevel(before.lighting.brightness) !== brightnessLevel(draft.lighting.brightness)) result.lighting.brightness = draft.lighting.brightness;
    if (before.lighting.effect !== draft.lighting.effect) result.lighting.effect = draft.lighting.effect;
  }
  (draft.macroNames || []).forEach((name, slot) => {
    if (name !== before.macroNames?.[slot]) result.macroNames[slot] = name;
  });
  return result;
}

export function macroBindings(keymaps, slot) {
  const result = [];
  keymaps.forEach((layer, layerIndex) => layer.forEach((code, index) => {
    if (code === 0x7700 + slot) result.push({ layer: layerIndex, index });
  }));
  return result;
}

export function configurationSummary(before, after, macroCount) {
  const keys = after.keymaps.reduce((sum, layer, layerIndex) => sum + layer.filter((value, index) => value !== before.keymaps[layerIndex][index]).length, 0);
  const macros = before.macros && after.macros ? changedMacros(before.macros, after.macros, macroCount).length : 0;
  const lighting = Boolean(before.lighting && after.lighting && !sameLighting(before.lighting, after.lighting));
  return { keys, macros, lighting };
}
