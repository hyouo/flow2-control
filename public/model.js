import { tr } from './locale.js';
import { FLOW2 } from './via.js';

export const cloneKeymaps = (keymaps) => keymaps.map((layer) => [...layer]);

export function buildLayout(definition) {
  return definition.layouts.keymap.map((line, rowIndex) => {
    let width = 1;
    const keys = [];
    for (const item of line) {
      if (typeof item === 'object') {
        width = item.w ?? width;
      } else {
        const [row, col] = item.split(',').map(Number);
        keys.push({ row, col, width, position: item, rowIndex, index: row * FLOW2.cols + col });
        width = 1;
      }
    }
    return keys;
  });
}

export function diffKeymaps(before, after) {
  const changes = [];
  after.forEach((layer, layerIndex) => {
    layer.forEach((value, index) => {
      if (value !== before[layerIndex][index]) {
        changes.push({ layer: layerIndex, row: Math.floor(index / FLOW2.cols), col: index % FLOW2.cols, index, before: before[layerIndex][index], after: value });
      }
    });
  });
  return changes;
}

export function makeBackup(keymaps, { lighting = null, macros = null, macroCount = 0, macroNames = [] } = {}) {
  return {
    format: 'flow2-keymap', version: 2, model: 'FLOW 2 84 / OE927',
    vendorId: FLOW2.vendorId, productId: FLOW2.productId,
    rows: FLOW2.rows, cols: FLOW2.cols, protocol: 12,
    savedAt: new Date().toISOString(), keymaps: cloneKeymaps(keymaps),
    ...(lighting ? { lighting: { ...lighting } } : {}),
    ...(macros ? { macros: { count: macroCount, bytes: [...macros] } } : {}),
    ...(macroNames.length ? { macroNames: [...macroNames] } : {}),
  };
}

export function readBackup(text, expectedLayers, capabilities = {}) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(tr('文件不是有效的 JSON 键位备份。')); }
  if (data?.format !== 'flow2-keymap' || ![1, 2].includes(data.version)) throw new Error(tr('请选择本工具导出的配置备份。'));
  if (data.vendorId !== FLOW2.vendorId || data.productId !== FLOW2.productId || data.rows !== FLOW2.rows || data.cols !== FLOW2.cols || data.protocol !== 12) {
    throw new Error(tr('这份备份不属于当前 FLOW 2 84 键型号。'));
  }
  if (!Array.isArray(data.keymaps) || data.keymaps.length !== expectedLayers) throw new Error(tr('备份的配置层数与键盘不一致。'));
  if (data.keymaps.some((layer) => !Array.isArray(layer) || layer.length !== FLOW2.rows * FLOW2.cols || layer.some((value) => !Number.isInteger(value) || value < 0 || value > 0xffff))) {
    throw new Error(tr('备份中存在不完整的键位或无效键码。'));
  }
  if (data.lighting) {
    if (!capabilities.lighting) throw new Error(tr('当前键盘未开放背光配置，无法导入这份完整方案。'));
    if (!Number.isInteger(data.lighting.brightness) || data.lighting.brightness < 0 || data.lighting.brightness > 255 || ![0, 1].includes(data.lighting.effect)) throw new Error(tr('备份中的背光设置无效。'));
  }
  if (data.macros) {
    if (!capabilities.macros || data.macros.count !== capabilities.macros.count || !Array.isArray(data.macros.bytes) || data.macros.bytes.length !== capabilities.macros.size || data.macros.bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error(tr('备份中的宏容量与键盘不一致。'));
    if (data.macros.bytes.at(-1) !== 0) throw new Error(tr('这份备份中的宏写入未完成，请选择写入前的备份。'));
  }
  if (data.macroNames && (!Array.isArray(data.macroNames) || data.macroNames.length !== capabilities.macros?.count || data.macroNames.some((name) => typeof name !== 'string' || name.length > 48))) throw new Error(tr('备份中的宏名称无效。'));
  return {
    keymaps: cloneKeymaps(data.keymaps),
    lighting: data.lighting ? { ...data.lighting } : null,
    macros: data.macros ? [...data.macros.bytes] : null,
    ...(data.macroNames ? { macroNames: [...data.macroNames] } : {}),
  };
}

export function parseKeycode(text) {
  const value = text.trim();
  if (!/^(?:0x[0-9a-f]{1,4}|\d{1,5})$/i.test(value)) throw new Error(tr('请输入 0x0000–0xFFFF 的十六进制键码，或 0–65535 的整数。'));
  const code = Number(value);
  if (code > 0xffff) throw new Error(tr('键码不能超过 0xFFFF。'));
  return code;
}
