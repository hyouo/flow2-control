import { tr } from './locale.js';
import { KEYCODES } from './keycodes.js';

export const macroKeys = KEYCODES.filter((key) => (key.code >= 4 && key.code <= 0x73) || (key.code >= 0xe0 && key.code <= 0xe7));
export const equalBytes = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => value === b[index]));

function segments(bytes, count) {
  const result = [];
  let start = 0;
  for (let i = 0; i < bytes.length - 1 && result.length < count; i++) {
    if (bytes[i] === 0) { result.push(bytes.slice(start, i)); start = i + 1; }
  }
  if (result.length !== count) throw new Error(tr('宏数据不完整，请导入之前的完整备份恢复。'));
  return result;
}

export function decodeMacros(bytes, count) {
  return segments(bytes, count).map((data) => {
    const actions = [];
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 1) {
        let value = '';
        while (i < data.length && data[i] !== 1) value += String.fromCharCode(data[i++]);
        i--;
        actions.push({ type: 'text', value });
      } else {
        const action = data[++i];
        if (action >= 1 && action <= 3) {
          const code = data[++i];
          if (!Number.isInteger(code) || code < 4) throw new Error(tr('存在无法编辑的宏按键，请保留备份。'));
          actions.push({ type: ['tap', 'down', 'up'][action - 1], value: code });
        } else if (action === 4) {
          let value = '';
          while (++i < data.length && data[i] !== 124) value += String.fromCharCode(data[i]);
          if (i === data.length || !/^\d{1,5}$/.test(value)) throw new Error(tr('宏延迟数据不完整。'));
          actions.push({ type: 'delay', value: Number(value) });
        } else throw new Error(tr('当前宏含有尚未适配的动作，请保留备份。'));
      }
    }
    return actions;
  });
}

export function encodeActions(actions) {
  const bytes = [];
  const held = new Set();
  for (const action of actions) {
    if (action.type === 'text') {
      if (/[^\x20-\x7e]/.test(action.value)) throw new Error(tr('文本宏支持英文、数字和英文标点；换行请添加 Enter 按键。'));
      bytes.push(...Array.from(action.value, (char) => char.charCodeAt(0)));
    } else if (action.type === 'delay') {
      if (!Number.isInteger(action.value) || action.value < 1 || action.value > 9999) throw new Error(tr('延迟范围为 1–9999 毫秒。'));
      bytes.push(1, 4, ...Array.from(String(action.value), (char) => char.charCodeAt(0)), 124);
    } else {
      if (!['tap', 'down', 'up'].includes(action.type) || !Number.isInteger(action.value) || action.value < 4 || action.value > 255) throw new Error(tr('宏按键无效。'));
      if (action.type === 'down') {
        if (held.has(action.value)) throw new Error(tr('同一个按键不能重复按下，请先添加松开动作。'));
        held.add(action.value);
      }
      if (action.type === 'up' && !held.delete(action.value)) throw new Error(tr('松开动作前需要对应的按下动作。'));
      bytes.push(1, { tap: 1, down: 2, up: 3 }[action.type], action.value);
    }
  }
  if (held.size) throw new Error(tr('宏结束前需要松开所有按键。'));
  return bytes;
}

export function replaceMacro(bytes, count, slot, actions) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= count) throw new Error(tr('宏槽不存在。'));
  const parts = segments(bytes, count);
  parts[slot] = encodeActions(actions);
  const result = parts.flatMap((part) => [...part, 0]);
  if (result.length >= bytes.length) throw new Error(tr('宏空间不足，请缩短文本或减少动作。'));
  return [...result, ...Array(bytes.length - result.length).fill(0)];
}

export function changedMacros(before, after, count) {
  if (!before || !after) return [];
  let a, b;
  try { a = segments(before, count); b = segments(after, count); }
  catch { return Array.from({ length: count }, (_, i) => i); }
  return b.flatMap((part, index) => equalBytes(a[index], part) ? [] : [index]);
}

export function macroUsage(bytes, count) {
  return segments(bytes, count).reduce((size, part) => size + part.length + 1, 0);
}

export function mergeMacroChanges(before, draft, actual, count) {
  const oldParts = segments(before, count);
  const draftParts = segments(draft, count);
  const parts = segments(actual, count);
  for (let slot = 0; slot < count; slot++) if (!equalBytes(oldParts[slot], draftParts[slot])) parts[slot] = draftParts[slot];
  const result = parts.flatMap((part) => [...part, 0]);
  if (result.length >= actual.length) throw new Error(tr('恢复草稿后宏空间不足，请先导出草稿，再选择完整方案恢复。'));
  return [...result, ...Array(actual.length - result.length).fill(0)];
}

export function pairedActionIndex(actions, index) {
  const action = actions[index];
  if (action?.type === 'down') return actions.findIndex((item, at) => at > index && item.type === 'up' && item.value === action.value);
  if (action?.type === 'up') return actions.findLastIndex((item, at) => at < index && item.type === 'down' && item.value === action.value);
  return -1;
}

export function replaceActionKey(actions, index, value) {
  const next = actions.map((action) => ({ ...action }));
  const paired = pairedActionIndex(next, index);
  next[index].value = value;
  if (paired >= 0) next[paired].value = value;
  encodeActions(next);
  return next;
}

export class MacroRecorder {
  constructor(bytes, count, slot, { delayMode = 'record', fixedDelay = 100 } = {}) {
    this.bytes = bytes;
    this.count = count;
    this.slot = slot;
    this.initial = decodeMacros(bytes, count)[slot];
    this.actions = [];
    this.held = new Set();
    this.last = null;
    this.delayMode = delayMode;
    this.fixedDelay = fixedDelay;
    this.used = macroUsage(bytes, count);
  }

  record(key, down, now) {
    if (down ? this.held.has(key) : !this.held.has(key)) return true;
    const next = [...this.actions];
    if (this.last !== null) {
      let delay = this.delayMode === 'fixed' ? this.fixedDelay : this.delayMode === 'record' ? Math.max(0, Math.round(now - this.last)) : 0;
      while (delay > 0) { const value = Math.min(9999, delay); next.push({ type: 'delay', value }); delay -= value; }
    }
    next.push({ type: down ? 'down' : 'up', value: key });
    const held = new Set(this.held);
    if (down) held.add(key); else held.delete(key);
    const complete = [...this.initial, ...next, ...[...held].reverse().map((value) => ({ type: 'up', value }))];
    let candidate;
    try { candidate = replaceMacro(this.bytes, this.count, this.slot, complete); }
    catch (error) { if (error.message.includes(tr('空间不足'))) return false; throw error; }
    this.actions = next;
    this.held = held;
    this.last = now;
    this.used = macroUsage(candidate, this.count);
    return true;
  }

  finish() {
    return [...this.initial, ...this.actions, ...[...this.held].reverse().map((value) => ({ type: 'up', value }))];
  }
}

export function chordActions(code, modifiers) {
  const keys = [0xe0, 0xe1, 0xe2, 0xe3].filter((_, bit) => modifiers & (1 << bit));
  return [...keys.map((value) => ({ type: 'down', value })), { type: 'tap', value: code }, ...keys.reverse().map((value) => ({ type: 'up', value }))];
}

export function eventKeycode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.charCodeAt(3) - 61;
  if (/^Digit[0-9]$/.test(code)) return 0x1e + (Number(code[5]) + 9) % 10;
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) {
    const number = Number(code.slice(1));
    return number <= 12 ? 0x39 + number : 0x68 + number - 13;
  }
  return {
    Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c,
    Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31,
    Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38,
    CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48, Insert: 0x49,
    Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
    ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52,
    ControlLeft: 0xe0, ShiftLeft: 0xe1, AltLeft: 0xe2, MetaLeft: 0xe3,
    ControlRight: 0xe4, ShiftRight: 0xe5, AltRight: 0xe6, MetaRight: 0xe7,
  }[code];
}
