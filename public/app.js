import { tr, currentLanguage, setLanguage, prepareText } from './locale.js';
import { VERSION } from './release.js';
import { Flow2Keyboard, FLOW2, isFlow2, sameLighting } from './via.js';
import { buildLayout, cloneKeymaps, diffKeymaps, makeBackup, readBackup, parseKeycode } from './model.js';
import { PHYSICAL_LABELS, formatKeycode, hexCode, keyCatalog, keycodeModifiers, withModifiers } from './keycodes.js';
import { macroKeys, equalBytes, decodeMacros, replaceMacro, changedMacros, macroUsage, chordActions, eventKeycode, MacroRecorder, replaceActionKey, pairedActionIndex } from './macros.js';
import { copyConfiguration, EditHistory, rebaseConfiguration, macroBindings, configurationSummary } from './editor.js';

const $ = (id) => document.getElementById(id);
const SNAPSHOT_KEY = 'flow2-control.previous-keymap';
const DRAFT_KEY = 'flow2-control.draft';
const PROFILES_KEY = 'flow2-control.profiles';
const NAMES_KEY = 'flow2-control.macro-names';
const ORIGINAL_KEY = 'flow2-control.original';
const history = new EditHistory();
const state = {
  client: null, connected: false, busy: false, baseline: null, draft: null,
  layer: 2, selected: null, layout: [], keys: [], previous: null, logs: [],
  capabilities: {}, lightBase: null, lightDraft: null, macroBase: null, macroDraft: null,
  macroSlot: 0, macroError: '', recording: null, saveInterrupted: false,
  macroBaseNames: [], macroNames: [], kind: 'key', gesture: 'volume', savedKey: null, macroStep: -1, original: null, profiles: [], recovery: null,
  view: 'keymap', workbenchView: 'keymap', assigningMacro: null, lockRelease: null, shortcut: null,
  testing: false, tested: new Map(), heldKeys: new Set(), testPeak: 0, testTotal: 0,
  testEvents: [], testSequence: '', testStarted: null, testMode: null, testStored: false, testTarget: null, lastTestKey: '',
};
const buttons = new Map();
let touchOpener;
const modifierInputs = [...document.querySelectorAll('input[name="modifier"]')];
let session;
function openSession() {
  if (document.documentElement.dataset.runtime !== 'desktop') return;
  session = new EventSource('./api/session');
  session.onerror = () => notice(tr('本地服务连接中断，请从桌面重新打开。'), 'error');
}
window.addEventListener('pagehide', () => session?.close());
window.addEventListener('pageshow', (event) => { if (event.persisted) openSession(); });

function notice(message, tone = '') {
  $('notice').hidden = !message;
  $('notice-text').textContent = message;
  $('notice').className = `notice ${tone}`;
}

function log(message) {
  state.logs.unshift({ time: new Date().toLocaleTimeString(currentLanguage(), { hour12: false }), message });
  state.logs.length = Math.min(state.logs.length, 15);
  $('event-log').replaceChildren(...state.logs.map((entry) => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = entry.time;
    item.append(time, document.createTextNode(entry.message));
    return item;
  }));
}

function setBusy(value, message = '') {
  state.busy = value;
  document.body.classList.toggle('busy', value);
  $('connection-dot').className = `dot ${value ? 'busy' : state.connected ? 'online' : ''}`;
  $('connection-label').textContent = value ? message || tr('处理中') : state.connected ? tr('USB 已连接') : tr('USB 未连接');
  renderControls();
}

function changes() { return state.baseline && state.draft ? diffKeymaps(state.baseline, state.draft) : []; }
function lightChanged() { return Boolean(state.lightBase && state.lightDraft && !sameLighting(state.lightBase, state.lightDraft)); }
function macrosChanged() { return Boolean(state.macroBase && state.macroDraft && !equalBytes(state.macroBase, state.macroDraft)); }
function hardwareCount() { return changes().length + Number(lightChanged()) + (macrosChanged() ? Math.max(1, changedMacros(state.macroBase, state.macroDraft, state.capabilities.macros.count).length) : 0); }
function changedNames() { return state.macroNames.filter((name, i) => name !== (state.macroBaseNames[i] || '')).length; }
function dirtyCount() { return hardwareCount() + changedNames(); }
function baseConfiguration() { return { keymaps: state.baseline, lighting: state.lightBase, macros: state.macroBase, macroNames: state.macroBaseNames }; }
function draftConfiguration() { return { keymaps: state.draft, lighting: state.lightDraft, macros: state.macroDraft, macroNames: state.macroNames }; }
function backupOf(config) { return makeBackup(config.keymaps, { ...config, macroCount: state.capabilities.macros?.count || 0 }); }
function currentBackup() { return backupOf(baseConfiguration()); }
function setDraft(config) {
  const value = copyConfiguration(config);
  state.draft = value.keymaps; state.macroDraft = value.macros; state.lightDraft = value.lighting;
  state.macroNames = value.macroNames;
}
function readLocal(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeLocal(key, value) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch { notice(tr('浏览器无法保存本地记录，请导出方案文件保留修改。'), 'error'); return false; }
}
function persistDraft() {
  if (!state.baseline) return;
  const base = (state.saveInterrupted || state.macroBase?.at(-1)) && state.previous ? JSON.parse(state.previous) : currentBackup();
  if (dirtyCount() || state.saveInterrupted) writeLocal(DRAFT_KEY, { base, draft: backupOf(draftConfiguration()), writing: state.saveInterrupted, savedAt: new Date().toISOString() });
  else writeLocal(DRAFT_KEY, null);
}
function rememberEdit() {
  state.savedKey = null;
  history.record(draftConfiguration());
  state.recovery = null;
  $('recovery-banner').hidden = true;
  persistDraft();
}
function finishEdit() { rememberEdit(); render(); syncEditor(); }
function editable() { return state.connected && !state.busy && !state.recording && !state.recovery; }
function systemName(layer = state.layer) { return layer < 2 ? 'mac' : 'windows'; }
function describeCode(code, layer = state.layer, names = state.macroNames) {
  if (code >= 0x7700 && code < 0x7710) return names[code - 0x7700] || tr`宏 ${code - 0x7700 + 1}`;
  if (code >= 0x5220 && code < 0x5220 + (state.draft?.length || 6)) return tr`按住进入 ${layerName(code - 0x5220)}`;
  if ((code === 0x5200 || code === 0x5202) && (state.draft?.length || 6) === 6) return tr`切换到 ${layerName(code - 0x5200)} 基础层`;
  return formatKeycode(code, systemName(layer));
}
function mappingAt(maps, layer, index, names) {
  const code = maps[layer][index];
  const inherited = maps.length === 6 && (layer === 1 || layer === 3) && code === 1;
  const effective = inherited ? maps[layer - 1][index] : code;
  const name = describeCode(effective, layer, names);
  const description = inherited && effective !== 1 ? tr`沿用基础层 · ${name}` : name;
  return { code, effective, inherited, name, description };
}
function physicalLabel(key, layer = state.layer) {
  if (systemName(layer) === 'mac') return ({ LCtrl: '⌃', LWin: '⌥', LAlt: '⌘', RAlt: 'R⌘', RCtrl: 'R⌥' })[key.physical] || key.physical;
  return key.physical;
}
function macroName(slot) { return state.macroNames[slot] || tr`宏 ${slot + 1}`; }

function layerName(index) {
  const names = ['macOS', 'macOS · Fn', 'Windows', 'Windows · Fn', tr('服务层 4'), tr('服务层 5')];
  return (state.draft?.length || 6) === 6 ? tr(names[index]) : tr`层 ${index}`;
}

function showView(name, opener) {
  const changed = state.view !== name;
  if (state.recording && name !== 'macros') stopRecording();
  if (state.testing && name !== 'test') stopTesting();
  state.view = name;
  const keyView = name === 'touch' || name === 'keymap';
  const inWorkbench = keyView || name === 'macros' || name === 'lighting';
  if (inWorkbench) state.workbenchView = name;
  if (name !== 'keymap') state.assigningMacro = null;
  $('module-tabs').hidden = !inWorkbench;
  for (const title of document.querySelectorAll('[data-view-title]')) title.hidden = title.dataset.viewTitle !== name;
  $('workbench').setAttribute('aria-pressed', String(inWorkbench));
  $('device-stage').hidden = !keyView && name !== 'lighting';
  $('device-stage').classList.toggle('night', name === 'lighting');
  $('light-preview').hidden = name !== 'lighting';
  $('layout-preview').hidden = !keyView;
  document.querySelectorAll('.view').forEach((view) => { view.hidden = view.id !== 'view-' + (keyView ? 'keymap' : name); });
  document.body.classList.toggle('touch-mode', name === 'touch');
  $('key-inspector').hidden = name === 'touch';
  $('touch-inspector').hidden = name !== 'touch';
  $('inspector').classList.toggle('is-open', name === 'touch');
  if (name === 'test') renderTester();
  else state.testTarget = null;
  if (name === 'macros') { $('macro-key').replaceChildren(...macroKeyOptions()); renderMacros(); }
  if (name === 'lighting') renderLighting();
  if (keyView) { renderKeyboard(); renderInspector(); }
  renderControls();
  document.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === name)));
  if (changed) $('view-scroll').scrollTop = 0;
  if (name === 'touch' && opener) {
    touchOpener = opener;
    if (window.matchMedia('(max-width:767px)').matches) $('close-inspector').focus({ preventScroll: true });
  }
}
for (const button of document.querySelectorAll('#workbench, [data-view]')) {
  button.addEventListener('click', () => {
    const target = button.dataset.view || state.workbenchView;
    if (target !== state.view) showView(target, button);
  });
}

function renderControls() {
  const count = dirtyCount();
  const locked = state.busy || Boolean(state.recording) || Boolean(state.recovery);
  const editable = state.connected && !locked && state.selected !== null;
  $('connect').disabled = state.busy || Boolean(state.recording) || !navigator.hid;
  $('connect').classList.toggle('primary', !state.connected);
  $('connect').classList.toggle('secondary', state.connected);
  $('connect').textContent = tr(!navigator.hid ? 'USB 配置不可用' : state.connected ? '断开连接' : '通过 USB 配置');
  $('refresh').disabled = !state.connected || locked || count > 0;
  $('refresh').title = count ? tr('先保存或撤销待保存的修改') : tr('从键盘重新读取所有层');
  $('export').disabled = !state.baseline || state.busy;
  $('import').disabled = locked;
  $('restore-previous').disabled = !state.connected || locked || !state.previous;
  $('discard').disabled = !state.connected || locked || changes().length === 0;
  $('search').disabled = !editable;
  $('category').disabled = !editable;
  $('modifier-fieldset').disabled = !editable;
  $('raw-code').disabled = locked || !state.draft;
  $('raw-code').readOnly = !editable;
  $('raw-apply').disabled = !editable;
  $('undo-key').disabled = !editable || state.draft[state.layer][state.selected.index] === state.baseline[state.layer][state.selected.index];
  $('undo-key').hidden = !state.selected || !state.draft || state.draft[state.layer][state.selected.index] === state.baseline[state.layer][state.selected.index];
  const original = state.original?.keymaps[state.layer]?.[state.selected?.index];
  $('restore-key').hidden = original === undefined || original === state.draft?.[state.layer]?.[state.selected?.index] || original === state.baseline?.[state.layer]?.[state.selected?.index];
  $('restore-key').disabled = !editable;
  $('capture-shortcut').disabled = !editable;
  $('undo').disabled = locked || !state.connected || !history.canUndo;
  $('redo').disabled = locked || !state.connected || !history.canRedo;
  $('profile-select').disabled = locked;
  for (const id of ['profile-new', 'export-draft', 'restore-original']) $(id).disabled = !state.baseline || locked || (id === 'restore-original' && (!state.connected || !state.original));
  for (const button of document.querySelectorAll('.profile-card button')) button.disabled = locked;
  $('restore-draft').disabled = state.busy || Boolean(state.recording) || !state.connected;
  $('lighting-controls').disabled = !state.connected || locked || !state.lightDraft;
  $('macro-controls').disabled = !state.connected || locked || !state.macroDraft || Boolean(state.macroError);
  $('assign-macro').disabled = !state.connected || locked || !state.macroDraft;
  $('discard-all').disabled = locked || count === 0;
  $('review').disabled = locked || count === 0;
  $('undo-light').disabled = !lightChanged();
  for (const control of document.querySelectorAll('.macro-timeline button, .macro-timeline input, .macro-timeline select, .macro-meta input, .macro-meta select, .macro-meta button')) control.disabled = !state.connected || locked;
  for (const slot of document.querySelectorAll('.macro-slot')) slot.disabled = locked;
  for (const id of ['save', 'review', 'discard-all']) $(id).hidden = !count;
  const localOnly = count > 0 && !hardwareCount();
  const reconnect = count > 0 && !localOnly && !state.connected;
  const saveLabel = reconnect ? '重新连接键盘' : localOnly ? '保存到此浏览器' : '保存到键盘';
  $('save').textContent = $('review-save').textContent = tr(state.busy ? '处理中…' : saveLabel);
  $('save').disabled = $('review-save').disabled = locked || !count || (reconnect && !navigator.hid);
  $('review-note').textContent = tr(reconnect ? '重新连接后可恢复草稿并保存。' : localOnly ? '宏名称保存在此浏览器' : '保存前会保留快照。写入完成后逐项读取确认。');
  const showReadback = Boolean(state.savedKey) && state.view === 'keymap' && !count;
  $('test-saved-key').hidden = !showReadback;
  $('savebar').hidden = !count && !showReadback;
  $('save-title').textContent = count ? tr`${count} 项修改待保存` : tr('已从键盘读回');
  $('save-subtitle').textContent = count ? tr('草稿自动保留在本机 · 保存后写入键盘') : '';
  if (count === 1 && changes().length === 1) {
    const [change] = changes();
    const item = state.keys.find((key) => key.index === change.index);
    if (item) $('save-subtitle').textContent = layerName(change.layer) + ' · ' + physicalLabel(item, change.layer) + ' → ' + mappingAt(state.draft, change.layer, item.index, state.macroNames).description;
  }
  if (showReadback) {
    const { layer, index, physical } = state.savedKey;
    const saved = mappingAt(state.baseline, layer, index, state.macroBaseNames);
    $('save-subtitle').textContent = layerName(layer) + ' · ' + physical + ' → ' + saved.description;
  }
  else if (localOnly) $('save-subtitle').textContent = tr('宏名称保存在此浏览器');
  else if (reconnect) $('save-subtitle').textContent = tr('草稿已保留在本机');
  $('system-layer').disabled = locked;
  const editingLayer = state.view === 'keymap' && Boolean(state.draft);
  $('layer-controls').hidden = !editingLayer;
  $('history-actions').hidden = !editingLayer || !state.connected;
  $('stage-label').hidden = editingLayer;
  $('stage-label').textContent = tr(state.view === 'lighting' ? '白色背光' : state.view === 'touch' ? '机身右侧' : '实体布局');
  $('inherit-legend').hidden = !editingLayer || state.draft.length !== 6 || ![1, 3].includes(state.layer) || !state.keys.some(key => state.draft[state.layer][key.index] === 1);
  $('dirty-legend').hidden = !editingLayer || !changes().some(change => change.layer === state.layer);
  const selectedCode = state.draft?.[state.layer]?.[state.selected?.index];
  for (const button of document.querySelectorAll('.catalog-key')) {
    button.disabled = !editable;
    button.setAttribute('aria-pressed', String(selectedCode !== undefined && Number(button.dataset.code) === selectedCode));
  }
  for (const button of document.querySelectorAll('.layer-tab')) button.disabled = locked;
  $('advanced-layer').disabled = locked || !state.draft;
  $('touch-probe').disabled = locked || !state.connected;
  for (const button of document.querySelectorAll('.change-item button')) button.disabled = locked || !state.connected;
  for (const button of buttons.values()) button.disabled = locked;
  $('cancel-assignment').hidden = state.assigningMacro === null;
  $('inspector').hidden = state.assigningMacro !== null;
  $('assignment-prompt').hidden = state.assigningMacro === null;
  if (state.assigningMacro !== null) $('assignment-prompt').textContent = tr`为「${macroName(state.assigningMacro)}」选择实体键`;
}

function buildKeyboard() {
  for (const [rowIndex, line] of state.layout.entries()) {
    const row = document.createElement('div');
    const lightRow = document.createElement('div');
    row.className = lightRow.className = 'keyboard-row';
    for (const [index, key] of line.entries()) {
      key.physical = PHYSICAL_LABELS[rowIndex][index];
      const button = document.createElement('button');
      button.className = 'key';
      button.style.setProperty('--span', key.width * 4);
      button.dataset.position = key.position;
      button.addEventListener('click', (event) => {
        selectKey(key);
        if (event.detail === 0 && state.connected && !window.matchMedia('(max-width:767px)').matches) $('search').focus();
      });
      button.addEventListener('keydown', (event) => navigateKeys(event, key));
      buttons.set(key.position, button);
      row.append(button);
      const cap = document.createElement('span');
      cap.className = 'key';
      cap.style.setProperty('--span', key.width * 4);
      const legend = document.createElement('span');
      legend.className = 'key-face';
      legend.textContent = key.physical;
      cap.append(legend);
      lightRow.append(cap);
    }
    $('keyboard').append(row);
    $('light-keyboard').append(lightRow);
  }
  state.keys = state.layout.flat();
  state.selected = state.keys.find((key) => key.physical === 'A');
}
function navigateKeys(event, key) {
  const line = state.layout[key.rowIndex];
  const index = line.indexOf(key);
  let next;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = line[index + (event.key === 'ArrowLeft' ? -1 : 1)];
  else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const neighbor = state.layout[key.rowIndex + (event.key === 'ArrowUp' ? -1 : 1)];
    const center = line.slice(0, index).reduce((sum, item) => sum + item.width, key.width / 2);
    let edge = 0;
    next = neighbor?.find((item) => { edge += item.width; return edge > center; }) || neighbor?.at(-1);
  } else return;
  event.preventDefault();
  if (next) { buttons.get(key.position).tabIndex = -1; const target = buttons.get(next.position); target.tabIndex = 0; target.focus(); }
}
const shortFaces = { 'Caps Lock': 'Caps', Insert: 'Ins', Delete: 'Del', 'Page Up': 'PgUp', 'Page Down': 'PgDn', Ctrl: 'LCtrl', Shift: 'LShift', Alt: 'LAlt', Win: 'LWin' };
const printedLegends = { LCtrl: 'ctrl', RCtrl: 'ctrl', LShift: 'shift', RShift: 'shift', LAlt: 'alt', RAlt: 'alt', LWin: 'win', Space: 'space', Backspace: 'backspace', Enter: 'enter', Caps: 'caps', Tab: 'tab' };
const shiftedSymbols = { '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')', '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|', ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~' };
const faceIcons = new Map([
  [0xbe, ['light', '−']], [0xbd, ['light', '+']], [0x7e07, ['displays']], [0xb4, ['search']],
  [0x7803, ['glow', '−']], [0x7804, ['glow', '+']], [0xac, ['prev']], [0xae, ['play']], [0xab, ['next']],
  [0xa8, ['mute']], [0xaa, ['sound', '−']], [0xa9, ['sound', '+']], [0x7e0c, ['mic']], [0x7e08, ['lock']],
  [0x7e0d, ['touch']], [0x7e0a, ['glow', '‹']], [0x7e0e, ['glow', '›']],
]);
function keycapLabel(key, code, full) {
  if (code >= 0x7700 && code < 0x7710) return 'M' + (code - 0x7700 + 1);
  if (code >= 0x5220 && code <= 0x523f) {
    const target = code - 0x5220;
    if (state.draft?.length === 6) {
      if (key.physical === 'Fn' && state.layer < 4 && target === (state.layer < 2 ? 1 : 3)) return 'Fn';
      if ((target === 4 || target === 5) && key.width >= 1.75) return tr`服务层 ${target}`;
    }
    return 'L' + target;
  }
  if (code >= 0x7793 && code <= 0x7795) return 'BT ' + (code - 0x7792);
  if ((code === 0x5200 || code === 0x5202) && state.draft?.length === 6) return code === 0x5200 ? 'macOS' : 'Win';
  if (code === 0) return '—';
  if (code === 1) return '▽';
  if (code === 0xb2) return currentLanguage() === 'en' ? 'Calc' : tr('计算器');
  if (/^0x[0-9A-F]{4}$/.test(full)) return 'OEM';
  return shortFaces[full] || full;
}
function drawFace(face, code, label) {
  const { mask, side } = keycodeModifiers(code);
  face.classList.toggle('chord-face', Boolean(mask));
  if (mask) {
    const mac = systemName() === 'mac';
    const symbols = mac ? ['⌃', '⇧', '⌥', '⌘'] : ['⌃', '⇧', '⎇', '⊞'];
    const active = [0, 1, 2, 3].filter(i => mask & (1 << i));
    const names = !mac && active.length === 1 ? ['Ctrl', 'Shift', 'Alt', 'Win'] : symbols;
    const caption = document.createElement('small');
    caption.textContent = (side === 'right' ? 'R' : '') + active.map(i => names[i]).join('');
    const base = formatKeycode(code & 255, systemName());
    face.replaceChildren(caption, shortFaces[base] || ({ Backspace: 'Bksp', 'Scroll Lock': 'ScrLk' })[base] || base);
    return;
  }
  const icon = faceIcons.get(code);
  if (!icon || label === 'OEM') { face.textContent = label; return; }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', '#icon-' + icon[0]);
  svg.setAttribute('aria-hidden', 'true');
  svg.append(use);
  face.replaceChildren(svg, icon[1] || '');
}
function renderKeyboard() {
  const maps = state.view === 'touch' ? null : state.draft;
  for (const key of state.keys) {
    const button = buttons.get(key.position);
    const mapping = maps ? mappingAt(maps, state.layer, key.index, state.macroNames) : null;
    const physical = physicalLabel(key);
    const label = mapping ? keycapLabel(key, mapping.effective, mapping.name) : physical;
    const face = document.createElement('span');
    face.className = 'key-face';
    drawFace(face, mapping?.effective, label === physical ? (printedLegends[label] || label) : label);
    button.replaceChildren(face);
    if (label === physical && Object.hasOwn(shiftedSymbols, physical)) {
      const symbol = document.createElement('span'); symbol.className = 'key-shifted'; symbol.textContent = shiftedSymbols[physical];
      button.append(symbol);
    }
    if (label !== physical) {
      const tag = document.createElement('span'); tag.className = 'key-physical'; tag.textContent = physical;
      button.append(tag);
    }
    const selected = Boolean(mapping) && state.selected?.position === key.position;
    const changed = Boolean(mapping) && mapping.code !== state.baseline[state.layer][key.index];
    button.classList.toggle('has-assignment', label !== physical);
    button.classList.toggle('is-selected', selected);
    button.classList.toggle('is-changed', changed);
    button.classList.toggle('is-inherited', Boolean(mapping?.inherited));
    button.classList.toggle('is-gesture', state.view === 'touch' && ((state.gesture !== 'volume' && key.physical === 'Fn') || (state.gesture === 'toggle' && key.physical === 'Space')));
    button.setAttribute('aria-pressed', String(selected));
    button.tabIndex = key === (state.selected || state.keys[0]) ? 0 : -1;
    button.title = mapping ? physical + ' · ' + mapping.description + ' · ' + hexCode(mapping.code) : physical;
    button.setAttribute('aria-label', button.title + (changed ? ' · ' + tr('待写入') : ''));
  }
}
function switchLayer(layer) {
  state.layer = layer;
  $('advanced-layers').open = false;
  syncKind();
  render(); syncEditor(); renderCatalog();
}
function renderLayers() {
  const count = state.draft?.length || 6;
  const standard = count === 6;
  const service = standard && state.layer >= 4;
  $('system-layer').hidden = !standard;
  $('service-choice').hidden = !service;
  $('system-layer').value = service ? 'service' : systemName();
  $('layers').hidden = service;
  const start = systemName() === 'mac' ? 0 : 2;
  const layers = standard ? [start, start + 1] : Array.from({ length: count }, (_, i) => i);
  const existing = [...$('layers').children];
  if (!layers.every((id, i) => Number(existing[i]?.dataset.layer) === id) || existing.length !== layers.length) {
    $('layers').replaceChildren(...layers.map((index) => {
      const button = document.createElement('button'); button.className = 'layer-tab';
      button.dataset.layer = index;
      button.addEventListener('click', () => switchLayer(index));
      return button;
    }));
  }
  [...$('layers').children].forEach((button) => {
    const index = Number(button.dataset.layer);
    button.textContent = standard ? (index % 2 ? 'Fn' : tr('基础')) : layerName(index);
    button.setAttribute('aria-pressed', String(index === state.layer));
  });

  $('advanced-layers').hidden = !standard;
  $('advanced-layer').value = state.layer >= 4 ? String(state.layer) : '';
  $('more-layer-label').textContent = service ? layerName(state.layer) : '···';
}
function syncKind() {
  const code = state.draft?.[state.layer]?.[state.selected?.index];
  state.kind = keycodeModifiers(code).mask ? 'chord' : code >= 0x7700 && code < 0x7710 ? 'macro' : 'key';
  $('search').value = '';
  const group = keyCatalog(state.draft?.length || 6, 0, systemName()).find(key => key.code === code)?.group;
  $('category').value = group && !['编辑导航', '字母数字'].includes(group) ? group : '常用';
}
function selectKey(key) {
  state.selected = key;
  if (state.view === 'touch') showView('keymap');
  if (state.assigningMacro !== null) {
    const slot = state.assigningMacro; state.assigningMacro = null;
    assign(0x7700 + slot);
  }
  syncKind();
  const sheet = window.matchMedia?.('(max-width:767px)').matches === true;
  $('inspector').classList.toggle('is-open', sheet);
  render(); syncEditor(); renderCatalog();
  if (sheet) $('close-inspector').focus();
}
function syncEditor() {
  const code = state.selected && state.draft ? state.draft[state.layer][state.selected.index] : undefined;
  $('raw-code').value = code === undefined ? '' : hexCode(code);
  const mods = keycodeModifiers(code);
  const chordChanged = state.kind === 'chord' && ($('modifier-side').value !== mods.side || modifierInputs.some(input => input.checked !== Boolean(mods.mask & Number(input.value))));
  modifierInputs.forEach((input) => { input.checked = Boolean(mods.mask & Number(input.value)); });
  $('modifier-side').value = mods.side;
  if (chordChanged) renderCatalog();
  const mac = systemName() === 'mac';
  $('alt-label').textContent = mac ? '⌥' : 'Alt';
  $('meta-label').textContent = mac ? '⌘' : 'Win';
  const macroMods = document.querySelectorAll('.macro-modifiers label span');
  if (macroMods.length) { macroMods[0].textContent = mac ? '⌥' : 'Alt'; macroMods[1].textContent = mac ? '⌘' : 'Win'; }
}
function renderInspector() {
  const key = state.selected;
  const physical = key ? physicalLabel(key) : '—';
  $('selected-position').textContent = key ? physical : tr('按键设置');
  const ready = Boolean(key && state.baseline);
  $('key-editor').classList.toggle('read-only', ready && !state.connected);
  $('key-editor').hidden = !ready;
  $('offline-guide').hidden = ready;
  $('base-label').textContent = state.connected ? tr('键盘当前') : tr('上次读取');
  if (!ready) {
    $('guide-title').textContent = tr(navigator.hid ? '连接键盘以读取映射' : '当前浏览器可查看键盘布局');
    $('guide-description').textContent = tr(navigator.hid ? '将键盘切到有线档，用数据线连接电脑，再选择「通过 USB 配置」。' : 'USB 配置请使用桌面 Chrome 或 Edge。此处可查看方案、手册和测试按键。');
    return;
  }
  const base = mappingAt(state.baseline, state.layer, key.index, state.macroBaseNames);
  const draft = mappingAt(state.draft, state.layer, key.index, state.macroNames);
  const pending = draft.code !== base.code || draft.effective !== base.effective;
  $('original-mapping').textContent = base.description;
  $('pending-mapping').hidden = !pending;
  $('draft-mapping').textContent = pending ? draft.description : '';
  const sample = $('selected-key');
  drawFace(sample, draft.effective, keycapLabel(key, draft.effective, draft.name));
  const model = $('cap-model');
  model.classList.toggle('is-changed', pending);
  model.style.setProperty('--sample-width', Math.min(136, 92 + 20 * ((key?.width || 1) - 1)) + 'px');
  $('open-bound-macro').hidden = draft.effective < 0x7700 || draft.effective >= 0x7700 + (state.capabilities.macros?.count || 0);
}

function assign(code) {
  if (!editable() || !state.selected) return;
  state.draft[state.layer][state.selected.index] = code;
  finishEdit();
}

const commonActions = new Set(['Enter', 'Esc', 'Backspace', 'Tab', 'Space', 'Insert', 'Home', 'Page Up', 'Delete', 'End', 'Page Down', '复制', '粘贴']);

function renderCatalog() {
  const query = $('search').value.trim().toLowerCase();
  const group = $('category').value;
  const searching = query.length > 0;
  const chords = state.kind === 'chord';
  const macroSlots = state.kind === 'macro';
  const mask = chords ? modifierInputs.reduce((bits, input) => input.checked ? bits | Number(input.value) : bits, 0) : 0;
  const side = $('modifier-side').value;
  const selected = state.draft?.[state.layer]?.[state.selected?.index];
  $('catalog').classList.toggle('search-results', searching || macroSlots);
  $('modifier-fieldset').hidden = !chords;
  $('catalog-filter').hidden = state.kind !== 'key' || searching;
  $('catalog-filter').classList.toggle('is-filtered', group !== '常用' && group !== '全部');
  $('category').title = tr('键位分类') + ' · ' + tr(group === '常用' ? '常用动作' : group);
  document.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === state.kind)));
  const results = [];
  for (const key of keyCatalog(state.draft?.length || 6, state.capabilities.macros?.count || 0, systemName(), state.macroNames)) {
    if (macroSlots !== (key.group === '宏')) continue;
    const basic = key.code >= 4 && key.code <= 0x73;
    const preset = key.group === '快捷键';
    if (chords && !basic && !preset) continue;
    if (chords && preset && mask && withModifiers(key.code & 255, mask, side) !== key.code) continue;
    if (state.kind === 'key' && !searching && group !== '全部') {
      const inCategory = group === '常用' ? commonActions.has(key.label) || key.code === selected : key.group === group;
      if (!inCategory) continue;
    }
    const code = chords && basic ? withModifiers(key.code, mask, side) : key.code;
    const name = macroSlots ? key.label : tr(key.label);
    const mapped = describeCode(code);
    const slot = macroSlots ? 'M' + (code - 0x7700 + 1) : '';
    const hint = slot || (preset ? mapped : tr(key.hint));
    const terms = [name, key.label, key.hint, tr(key.hint), slot, mapped, hexCode(code)];
    if (searching && !terms.some(term => term.toLowerCase().includes(query))) continue;
    const button = document.createElement('button');
    button.className = 'catalog-key';
    button.dataset.code = String(code);
    button.textContent = (chords && basic) || (code >= 0xe0 && code <= 0xe7) ? mapped : name;
    button.title = button.textContent + ' · ' + hexCode(code);
    if (hint && hint !== button.textContent && (searching || macroSlots || preset || key.group === '层切换')) {
      const detail = document.createElement('small');
      detail.textContent = hint;
      button.append(detail);
    }
    button.addEventListener('click', () => assign(code));
    results.push(button);
  }
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'catalog-empty';
    empty.textContent = tr('没有匹配的键位');
    results.push(empty);
  }
  $('catalog').replaceChildren(...results);
  $('action-choices').scrollTop = 0;
  renderControls();
}

function renderLighting() {
  const light = state.lightDraft;
  document.querySelectorAll('#light-keyboard .key-face').forEach((face, index) => {
    const label = physicalLabel(state.keys[index]);
    face.textContent = printedLegends[label] || label;
  });
  let status = state.connected ? '当前连接未提供背光设置。' : '连接后读取当前设置。';
  if (light) status = lightChanged() ? '预览 · 有待写入的背光修改' : state.connected ? '已从键盘读取当前背光' : '上次读取';
  $('light-status').textContent = tr(status);
  const level = light ? Math.round(light.brightness * 4 / 255) : null;
  document.querySelectorAll('[data-level]').forEach((button) => button.setAttribute('aria-pressed', String(Number(button.dataset.level) === level)));
  $('light-effect').value = light?.effect ?? '';
  $('light-preview').style.setProperty('--light-opacity', String((level ?? 0) / 4));
  $('light-preview').classList.toggle('breathing', light?.effect === 1 && level > 0);
}

function macroActions() {
  return decodeMacros(state.macroDraft, state.capabilities.macros.count)[state.macroSlot];
}

function updateMacro(actions, selectedStep = state.macroStep) {
  if (!editable()) return false;
  try {
    state.macroDraft = replaceMacro(state.macroDraft, state.capabilities.macros.count, state.macroSlot, actions);
    state.macroStep = selectedStep;
    rememberEdit();
    notice(macroName(state.macroSlot) + tr('已更新，保存后生效。'));
    render();
    return true;
  } catch (error) { notice(error.message, 'error'); render(); return false; }
}

function insertMacro(actions) {
  const next = macroActions();
  const at = state.macroStep < 0 ? next.length : state.macroStep + 1;
  next.splice(at, 0, ...actions);
  updateMacro(next, at + actions.length - 1);
}

function macroKeyOptions(value) {
  const list = [...macroKeys];
  if (value !== undefined && !list.some((key) => key.code === value)) list.push({ code: value, label: formatKeycode(value) });
  return list.map((key) => {
    const option = document.createElement('option'); option.value = key.code; option.textContent = describeCode(key.code); return option;
  });
}

function renderMacros() {
  const count = state.capabilities.macros?.count || 0;
  $('view-macros').classList.toggle('empty-storage', !state.macroDraft);
  $('view-macros').classList.toggle('read-only', Boolean(state.macroDraft) && !state.connected);
  state.macroError = '';
  const bindings = new Map();
  state.draft?.forEach((map, layer) => map.forEach((code, index) => {
    if (code < 0x7700 || code >= 0x7700 + count) return;
    const slot = code - 0x7700;
    if (!bindings.has(slot)) bindings.set(slot, []);
    const key = state.keys.find((k) => k.index === index);
    if (key) bindings.get(slot).push(layerName(layer) + ' · ' + physicalLabel(key, layer));
  }));
  const changed = count ? changedMacros(state.macroBase, state.macroDraft, count) : [];
  $('macro-slots').replaceChildren(...Array.from({ length: count }, (_, index) => {
    const button = document.createElement('button');
    button.className = 'macro-slot';
    const slot = document.createElement('span'); slot.className = 'slot-id'; slot.textContent = 'M' + (index + 1);
    const name = document.createElement('span'); name.className = 'slot-name'; name.textContent = state.macroNames[index] || '';
    button.append(slot, name);
    button.classList.toggle('is-changed', changed.includes(index) || state.macroNames[index] !== state.macroBaseNames[index]);
    button.title = macroName(index);
    if (bindings.get(index)?.length) {
      const detail = document.createElement('small'); detail.textContent = bindings.get(index).join(' / ');
      button.append(detail); button.title += ' · ' + detail.textContent;
    }
    button.setAttribute('aria-pressed', String(index === state.macroSlot));
    button.addEventListener('click', () => {
      state.macroSlot = index; state.macroStep = -1; renderMacros(); renderControls();
      $('macro-slots').children[index].focus({ preventScroll: true });
    });
    return button;
  }));
  $('macro-timeline').replaceChildren();
  $('macro-title').textContent = count ? macroName(state.macroSlot) : tr('连接后读取宏');
  $('macro-title').title = $('macro-title').textContent;
  $('macro-name').value = state.macroNames[state.macroSlot] || '';
  $('macro-copy-target').replaceChildren(...Array.from({ length: count }, (_, index) => {
    const option = document.createElement('option'); option.value = index; option.textContent = `${index + 1} · ${macroName(index)}`; option.disabled = index === state.macroSlot; return option;
  }));
  $('macro-copy-target').value = String((state.macroSlot + 1) % Math.max(count, 1));
  $('macro-bindings').replaceChildren(...(state.draft ? macroBindings(state.draft, state.macroSlot) : []).map((binding) => {
    const key = state.keys.find((item) => item.index === binding.index);
    const button = document.createElement(key ? 'button' : 'span'); button.className = 'binding-chip';
    button.textContent = `${layerName(binding.layer)} · ${key ? physicalLabel(key, binding.layer) : tr`位置 ${binding.index}`}`;
    if (key) button.addEventListener('click', () => { state.layer = binding.layer; showView('keymap'); selectKey(key); });
    return button;
  }));
  $('macro-memory').textContent = '';
  if (!state.macroDraft) { $('macro-status').textContent = tr(state.connected ? '当前连接未提供宏存储。' : '通过 USB 配置后可查看和编辑宏。'); return; }
  let actions;
  try {
    if (state.macroDraft.at(-1) !== 0) throw new Error(tr('宏写入未完成，请载入写入前的快照恢复。'));
    actions = macroActions();
    const used = macroUsage(state.macroDraft, count);
    $('macro-memory').textContent = tr`${used} / ${state.macroDraft.length - 1} 字节`;
    $('macro-meter').max = state.macroDraft.length - 1;
    $('macro-meter').value = used;
  } catch (error) {
    state.macroError = error.message;
    $('macro-status').textContent = error.message;
    return;
  }
  if (state.macroStep >= actions.length) state.macroStep = -1;
  $('insert-position').textContent = state.macroStep < 0 ? tr('添加到末尾') : tr`插入到第 ${state.macroStep + 1} 步之后`;
  const status = changed.includes(state.macroSlot) ? '待保存' : state.connected ? '已同步' : '上次读取';
  $('macro-status').textContent = actions.length || !state.connected ? actions.length + tr(' 个动作 · ') + tr(status) : tr('此宏为空。添加动作或开始录制。');
  $('macro-timeline').replaceChildren(...actions.map((action, index) => {
    const row = document.createElement('li');
    const selected = state.connected && index === state.macroStep;
    row.classList.toggle('is-selected', selected);
    const number = document.createElement(state.connected ? 'button' : 'span');
    number.className = 'step-number';
    number.textContent = String(index + 1).padStart(2, '0');
    if (state.connected) {
      number.title = tr('选择插入位置');
      number.setAttribute('aria-label', tr`在第 ${index + 1} 步之后插入`);
      number.setAttribute('aria-pressed', String(selected));
      number.addEventListener('click', () => { state.macroStep = selected ? -1 : index; renderMacros(); renderControls(); });
    }
    const type = document.createElement('span');
    type.className = 'step-type';
    type.textContent = { text: tr('文本'), tap: tr('轻按'), down: tr('按下'), up: tr('松开'), delay: tr('等待') }[action.type];
    if (!selected) {
      const summary = document.createElement(state.connected ? 'button' : 'span');
      summary.className = 'step-summary';
      summary.textContent = action.type === 'text' ? action.value : action.type === 'delay' ? action.value + ' ms' : describeCode(action.value);
      if (state.connected) summary.addEventListener('click', () => { state.macroStep = index; renderMacros(); renderControls(); });
      row.append(number, type, summary); return row;
    }
    let value;
    if (['text', 'delay'].includes(action.type)) {
      value = document.createElement('input');
      value.type = action.type === 'delay' ? 'number' : 'text';
      if (action.type === 'delay') { value.min = 1; value.max = 9999; }
      value.value = action.value;
      value.setAttribute('aria-label', tr('第 ') + (index + 1) + tr(' 个动作的') + (action.type === 'delay' ? tr('延迟毫秒') : tr('文本')));
      value.disabled = state.busy || Boolean(state.recording) || !state.connected;
      value.addEventListener('change', () => {
        const next = actions.map((item) => ({ ...item }));
        next[index].value = action.type === 'delay' ? Number(value.value) : value.value;
        updateMacro(next);
      });
    } else {
      value = document.createElement('select');
      value.replaceChildren(...macroKeyOptions(action.value));
      value.value = action.value;
      value.setAttribute('aria-label', tr`第 ${index + 1} 个动作的按键`);
      value.addEventListener('change', () => {
        try { updateMacro(replaceActionKey(actions, index, Number(value.value))); }
        catch (error) { notice(error.message, 'error'); renderMacros(); renderControls(); }
      });
    }
    const actionsCell = document.createElement('div');
    actionsCell.className = 'step-actions';
    for (const [label, delta, text] of [[tr('上移'), -1, '↑'], [tr('下移'), 1, '↓'], [tr('删除'), 0, '×']]) {
      if (delta && (index + delta < 0 || index + delta >= actions.length)) continue;
      const button = document.createElement('button');
      button.textContent = text;
      button.setAttribute('aria-label', label + tr('第 ') + (index + 1) + tr(' 个动作'));
      button.addEventListener('click', () => {
        const next = actions.map((item) => ({ ...item }));
        if (delta) [next[index], next[index + delta]] = [next[index + delta], next[index]];
        else {
          if (action.type === 'down' || action.type === 'up') {
            const match = pairedActionIndex(next, index);
            if (match >= 0) { next.splice(Math.max(index, match), 1); next.splice(Math.min(index, match), 1); }
            else next.splice(index, 1);
          } else next.splice(index, 1);
        }
        updateMacro(next, delta ? index + delta : Math.min(index, next.length - 1));
      });
      actionsCell.append(button);
    }
    row.append(number, type, value, actionsCell);
    return row;
  }));
}

function startRecording() {
  if (!editable() || !state.macroDraft) return;
  const fixedDelay = Number($('fixed-delay').value);
  if ($('record-delay-mode').value === 'fixed' && (!Number.isInteger(fixedDelay) || fixedDelay < 1 || fixedDelay > 9999)) { notice(tr('固定间隔范围为 1–9999 毫秒。'), 'error'); return; }
  state.recording = new MacroRecorder(state.macroDraft, state.capabilities.macros.count, state.macroSlot, { delayMode: $('record-delay-mode').value, fixedDelay });
  $('record-area').hidden = false;
  $('record-count').textContent = tr('0 个动作');
  $('record-area').focus();
  renderControls();
}

function captureMacro(event) {
  const recording = state.recording;
  if (!recording) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.code === 'Escape') { if (event.type === 'keydown') stopRecording(); return; }
  const key = eventKeycode(event.code);
  if (!key || event.repeat) return;
  const down = event.type === 'keydown';
  if (!recording.record(key, down, performance.now())) {
    stopRecording();
    notice(tr('宏空间已满，已保留本次录制中可容纳的完整动作。可删除动作后继续录制。'));
    return;
  }
  $('record-count').textContent = tr`${recording.actions.length} 个动作 · 剩余 ${state.macroDraft.length - 1 - recording.used} 字节`;
}

function stopRecording() {
  const recording = state.recording;
  if (!recording) return;
  state.recording = null;
  $('record-area').hidden = true;
  updateMacro(recording.finish());
}

function renderReview() {
  const keys = changes();
  const lines = configurationLines(baseConfiguration(), draftConfiguration());
  $('changes-area').hidden = keys.length === 0;
  $('changes').replaceChildren(...keys.map((change, index) => {
    const row = document.createElement('div');
    row.className = 'change-item';
    const label = document.createElement('span');
    label.textContent = lines[index];
    const undo = document.createElement('button');
    undo.textContent = '×';
    undo.setAttribute('aria-label', tr('撤销') + ' · ' + lines[index]);
    undo.disabled = !editable();
    undo.addEventListener('click', () => {
      if (!editable()) return;
      state.draft[change.layer][change.index] = change.before;
      finishEdit();
    });
    row.append(label, undo);
    return row;
  }));
  $('other-changes').replaceChildren(...lines.slice(keys.length).map(line => {
    const p = document.createElement('p'); p.textContent = line; return p;
  }));
}
function previewChanges() {
  renderReview();
  $('review-dialog').showModal();
}

function render() {
  renderLayers();
  renderKeyboard();
  renderInspector();
  if ($('review-dialog').open) {
    if (dirtyCount()) renderReview();
    else $('review-dialog').close();
  }
  if (state.view === 'lighting') renderLighting();
  if (state.view === 'macros') renderMacros();
  renderControls();
}

async function connect(device) {
  if (state.busy) return;
  const pending = dirtyCount() ? {
    base: state.saveInterrupted && state.previous ? JSON.parse(state.previous) : currentBackup(),
    draft: backupOf(draftConfiguration()), writing: state.saveInterrupted, savedAt: new Date().toISOString(),
  } : state.recovery;
  setBusy(true, tr('连接中'));
  notice(tr('正在连接键盘…'));
  let client;
  try {
    if (!device) {
      const known = (await navigator.hid.getDevices()).filter(isFlow2);
      device = known.length === 1 ? known[0] : (await navigator.hid.requestDevice({ filters: [{ vendorId: FLOW2.vendorId, productId: FLOW2.productId, usagePage: 0xff60, usage: 0x61 }] }))[0];
    }
    if (!device) { notice(tr('没有选择键盘。准备好后可再次连接。')); return; }
    if (navigator.locks && !await acquireDeviceLock()) throw new Error(tr('另一个 FLOW2 Control 窗口正在使用键盘，请在那个窗口继续，或先断开它的连接。'));
    client = new Flow2Keyboard(device);
    state.client = client;
    const info = await client.connect();
    setBusy(true, tr('正在读取'));
    const maps = await client.readKeymaps((done, total) => notice(tr`正在读取配置层 ${done} / ${total}…`));
    const capabilities = await client.readCapabilities();
    const macros = capabilities.macros ? await client.readMacros() : null;
    const savedNames = readLocal(NAMES_KEY, []);
    const names = Array.from({ length: capabilities.macros?.count || 0 }, (_, index) => typeof savedNames[index] === 'string' ? savedNames[index].slice(0, 48) : '');
    const actual = { keymaps: maps, lighting: capabilities.lighting, macros, macroNames: names };
    state.saveInterrupted = false;
    state.client = client;
    state.connected = true;
    state.capabilities = capabilities;
    state.lightBase = capabilities.lighting;
    state.macroBase = macros;
    state.macroBaseNames = [...names];
    state.baseline = maps;
    setDraft(actual);
    state.savedKey = null;
    history.reset(actual);
    state.layer = Math.min(state.layer, maps.length - 1);
    if (!state.previous) {
      try { state.previous = localStorage.getItem(SNAPSHOT_KEY); } catch { /* The current window can still retain a snapshot. */ }
    }
    const original = readLocal(ORIGINAL_KEY);
    if (original) { try { state.original = readBackup(JSON.stringify(original), maps.length, capabilities); } catch { state.original = null; } }
    if (!state.original && (!macros || macros.at(-1) === 0)) { state.original = copyConfiguration(actual); writeLocal(ORIGINAL_KEY, currentBackup()); }
    state.recovery = pending || readLocal(DRAFT_KEY);
    $('recovery-banner').hidden = !state.recovery;
    if (state.recovery) {
      $('inspector').classList.toggle('is-open', false);
      $('recovery-time').textContent = tr`发现 ${new Date(state.recovery.savedAt).toLocaleString(currentLanguage())} 的未保存草稿`;
    }

    deviceDetails();

    notice('');
    log(tr`连接成功，已读取 ${info.layerCount} 层键位。`);
    renderCatalog();
    renderProfiles();
  } catch (error) {
    await client?.close().catch(() => {});
    state.client = null;
    state.connected = false;
    releaseDeviceLock();
    notice(error.message, 'error');
    log(error.message);
  } finally {
    setBusy(false);
    render();
    syncEditor();
    if (state.connected && state.recovery) $('restore-draft').focus();
  }
}

function deviceDetails() {
  const count = state.baseline.length;
  const caps = state.capabilities;
  $('device-summary').textContent = tr(state.connected ? 'USB 已连接' : 'USB 未连接 · 显示上次读取');
  $('protocol-info').textContent = `VIA 12 · ${count} × 90 · 388D:0002`;
  $('capability-info').textContent = caps.macros ? tr`${caps.macros.count} 个宏槽 · ${caps.macros.size} 字节` : tr('当前固件未开放');
  $('macro-capability').textContent = $('capability-info').textContent;
  $('lighting-info').textContent = caps.lighting ? tr('白色背光 · 5 档亮度 · 常亮 / 呼吸') : tr('当前固件未开放');
}
async function acquireDeviceLock() {
  return new Promise((resolve, reject) => {
    navigator.locks.request('flow2-control.device', { ifAvailable: true }, (lock) => {
      if (!lock) { resolve(false); return; }
      return new Promise((release) => { state.lockRelease = release; resolve(true); });
    }).catch(reject);
  });
}
function releaseDeviceLock() { state.lockRelease?.(); state.lockRelease = null; }

async function disconnect() {
  if (state.recording) stopRecording();
  const client = state.client;
  state.client = null;
  state.connected = false;
  state.assigningMacro = null;
  await client?.close().catch(() => {});
  releaseDeviceLock();
  $('device-summary').textContent = tr(state.baseline ? 'USB 未连接 · 显示上次读取' : 'USB 未连接');
  notice(tr('USB 配置连接已断开。草稿仍保留，无线输入可在测试页验证。'));
  log(tr('连接已断开。'));
  setBusy(state.busy);
  renderProfiles(); render();
}

async function refresh() {
  if (!state.client || state.busy || dirtyCount()) return;
  setBusy(true, tr('读取中'));
  try {
    const maps = await state.client.readKeymaps((done, total) => notice(tr`正在读取配置层 ${done} / ${total}…`));
    const lighting = state.capabilities.lighting ? await state.client.readLighting() : null;
    const macros = state.capabilities.macros ? await state.client.readMacros() : null;
    state.baseline = maps; state.lightBase = lighting; state.macroBase = macros;
    setDraft(baseConfiguration());
    state.savedKey = null;
    history.reset(draftConfiguration());
    notice(tr('已从键盘重新读取键位、宏和背光。'), 'success');
    log(tr('已重新读取完整配置。'));
  } catch (error) {
    await disconnect();
    notice(error.message, 'error');
    log(error.message);
  } finally {
    setBusy(false);
    render();
    syncEditor();
  }
}

async function save() {
  const list = changes();
  const total = dirtyCount();
  if (state.busy || state.recording || state.recovery || !total) return;
  const submitted = copyConfiguration(draftConfiguration());
  const writeMacros = macrosChanged();
  const writeLighting = lightChanged();
  const hardware = list.length > 0 || writeMacros || writeLighting;
  if (hardware && !state.client) return;
  if (!hardware) {
    if (writeLocal(NAMES_KEY, submitted.macroNames)) {
      state.macroBaseNames = [...submitted.macroNames];
      state.saveInterrupted = false;
      history.reset(baseConfiguration()); persistDraft();
      notice(tr('已保存到此浏览器。'), 'success'); render();
    }
    return;
  }
  if (!state.saveInterrupted && !state.macroBase?.at(-1)) {
    state.previous = JSON.stringify(currentBackup());
    try { localStorage.setItem(SNAPSHOT_KEY, state.previous); } catch { log(tr('写入前的快照保留在当前窗口。')); }
  }
  state.saveInterrupted = true;
  persistDraft();
  setBusy(true, tr('保存中'));
  try {
    if (writeMacros) {
      notice(tr('正在写入宏并校验完整内容…'));
      await state.client.applyMacros(state.macroBase, submitted.macros);
      state.macroBase = [...submitted.macros];
    }
    await state.client.applyChanges(list, (change, done, total) => {
      state.baseline[change.layer][change.index] = change.after;
      notice(tr`正在写入并读取确认 ${done} / ${total}…`);
    });
    if (writeLighting) {
      notice(tr('正在保存背光并读取确认…'));
      state.lightBase = await state.client.applyLighting(state.lightBase, submitted.lighting);
      if (sameLighting(state.lightDraft, submitted.lighting)) state.lightDraft = { ...state.lightBase };
    }
    const namesSaved = !changedNames() || writeLocal(NAMES_KEY, submitted.macroNames);
    if (namesSaved) state.macroBaseNames = [...submitted.macroNames];
    if (list.length === 1) {
      const item = state.keys.find((key) => key.index === list[0].index);
      if (item) state.savedKey = { layer: list[0].layer, index: item.index, physical: physicalLabel(item, list[0].layer) };
    }
    if (namesSaved) notice(state.savedKey ? '' : tr`设备修改已读回（${list.length + Number(writeLighting) + Number(writeMacros)}）。`, 'success');
    log(tr`已保存并确认 ${total} 项修改。`);
    state.saveInterrupted = false;
    history.reset(baseConfiguration());
    history.record(draftConfiguration());
  } catch (error) {
    await disconnect();
    state.saveInterrupted = true;
    notice(tr`保存中断。${error.message} 草稿已保留，重新连接后可继续保存或载入快照。`, 'error');
    log(tr`保存中断：${error.message}`);
  } finally {
    persistDraft();
    setBusy(false);
    render();
    syncEditor();
  }
}

function downloadJson(value, name) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}-${new Date().toISOString().replaceAll(':', '-').slice(0, 19)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function exportBackup() {
  downloadJson(currentBackup(), 'flow2-84-device');
  log(tr('已导出键位、宏和背光备份。'));
  notice(tr('已导出已读取的键盘配置；未保存草稿未包含在备份中。'), 'success');
}

function importBackup(text, source) {
  if (!editable()) return;
  try {
    const backup = readBackup(text, state.baseline.length, state.capabilities);
    state.draft = backup.keymaps;
    if (backup.lighting) state.lightDraft = backup.lighting;
    if (backup.macros) state.macroDraft = backup.macros;
    if (backup.macroNames) state.macroNames = backup.macroNames;
    rememberEdit();
    render();
    syncEditor();
    const count = dirtyCount();
    showView('keymap');
    renderCatalog();
    notice(count ? tr`${source}已载入，${count} 项修改等待保存。` : tr('这份方案与键盘当前配置一致。'), 'success');
    log(tr`${source}已载入，${count} 项待保存修改。`);
  } catch (error) { notice(error.message, 'error'); log(error.message); }
}

function editName(title, value, action) {
  $('name-title').textContent = title;
  $('name-input').value = value;
  state.nameAction = action;
  $('name-dialog').showModal();
  $('name-input').focus();
  $('name-input').select();
}
function previewAction(title, description, label, action, lines = []) {
  $('action-title').textContent = title;
  $('action-description').textContent = description;
  $('action-diff').replaceChildren(...lines.map((line) => { const p = document.createElement('p'); p.textContent = line; return p; }));
  $('action-confirm').textContent = label;
  state.pendingAction = action;
  $('action-dialog').showModal();
}
function storeProfiles() { const saved = writeLocal(PROFILES_KEY, state.profiles); renderProfiles(); renderControls(); return saved; }
function renderProfiles() {
  $('profile-select').replaceChildren();
  const initial = document.createElement('option'); initial.value = ''; initial.textContent = tr('本地方案'); initial.disabled = true; $('profile-select').append(initial);
  $('profiles-empty').hidden = state.profiles.length > 0;
  $('profile-list').replaceChildren(...state.profiles.map((profile) => {
    const option = document.createElement('option'); option.value = profile.id; option.textContent = profile.name; $('profile-select').append(option);
    const card = document.createElement('article'); card.className = 'profile-card';
    const heading = document.createElement('h3'); heading.textContent = profile.name;
    const detail = document.createElement('p'); detail.textContent = tr`${profile.backup.keymaps?.length || 0} 层键位 · ${profile.backup.macros?.count || 0} 个宏 · ${new Date(profile.createdAt).toLocaleDateString(currentLanguage())}`;
    const actions = document.createElement('div'); actions.className = 'profile-actions';
    for (const [label, action] of [
      [state.connected ? tr('载入') : tr('查看'), () => loadProfile(profile)],
      [tr('重命名'), () => editName(tr('重命名方案'), profile.name, (name) => { profile.name = name; storeProfiles(); })],
      [tr('复制'), () => editName(tr('复制方案'), tr`${profile.name} 副本`, (name) => { state.profiles.push({ ...profile, id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }); storeProfiles(); })],
      [tr('导出'), () => downloadJson({ ...profile.backup, name: profile.name }, 'flow2-84-profile')],
      [tr('删除'), () => previewAction(tr`删除「${profile.name}」`, tr('只删除本机方案库中的这一份方案。'), tr('删除方案'), () => { state.profiles = state.profiles.filter((item) => item.id !== profile.id); storeProfiles(); })],
    ]) { const button = document.createElement('button'); button.className = 'button quiet'; button.textContent = tr(label); button.addEventListener('click', action); actions.append(button); }
    card.append(heading, detail, actions); return card;
  }));
  const manage = document.createElement('option'); manage.value = 'library'; manage.textContent = tr('管理本地方案');
  $('profile-select').append(manage); $('profile-select').value = '';
}
function configurationLines(before, after) {
  const lines = diffKeymaps(before.keymaps, after.keymaps).map((change) => {
    const key = state.keys.find((item) => item.index === change.index);
    const position = key ? physicalLabel(key, change.layer) : change.row + ',' + change.col;
    return layerName(change.layer) + ' · ' + position + '  ' + mappingAt(before.keymaps, change.layer, change.index, before.macroNames).description
      + ' → ' + mappingAt(after.keymaps, change.layer, change.index, after.macroNames).description;
  });
  const count = state.capabilities.macros?.count || 0;
  if (before.macros && after.macros) {
    for (const slot of changedMacros(before.macros, after.macros, count)) {
      const actions = (bytes) => {
        try { return decodeMacros(bytes, count)[slot].map((a) => a.type === 'text' ? '“' + a.value + '”' : a.type === 'delay' ? a.value + ' ms' : tr(({tap:'按键',down:'按下',up:'松开'})[a.type]) + ' ' + describeCode(a.value)).join(' · ') || tr('空'); }
        catch { return tr('未完成的宏数据'); }
      };
      lines.push(tr`宏 ${slot + 1}` + '  ' + actions(before.macros) + ' → ' + actions(after.macros));
    }
  }
  after.macroNames?.forEach((name, i) => {
    if (name !== (before.macroNames?.[i] || '')) lines.push(tr`宏 ${i + 1}` + ' · ' + tr('名称') + '  ' + (before.macroNames?.[i] || '—') + ' → ' + (name || '—'));
  });
  if (before.lighting && after.lighting && !sameLighting(before.lighting, after.lighting)) {
    const light = (v) => Math.round(v.brightness * 4 / 255) * 25 + '% · ' + (v.effect ? tr('呼吸') : tr('常亮'));
    lines.push(tr('背光') + '  ' + light(before.lighting) + ' → ' + light(after.lighting));
  }
  return lines;
}
function previewImport(text, source) {
  if (!editable()) return;
  try {
    const parsed = readBackup(text, state.baseline.length, state.capabilities);
    const before = draftConfiguration();
    const target = { ...before, keymaps: parsed.keymaps, macros: parsed.macros || before.macros, lighting: parsed.lighting || before.lighting, macroNames: parsed.macroNames || before.macroNames };
    const lines = configurationLines(before, target);
    previewAction(source, lines.length ? tr('载入后成为草稿，保存后生效。') : tr('与当前草稿一致。'), tr('载入草稿'), () => importBackup(text, source), lines);
  } catch (error) { notice(error.message, 'error'); }
}
function loadProfile(profile) {
  if (!state.connected) { showView('backup'); inspectProfile(profile); return; }
  previewImport(JSON.stringify(profile.backup), profile.name);
}
function inspectProfile(profile) {
  const backup = profile.backup;
  const info = tr`${backup.keymaps.length} 层键位 · ${backup.macros?.count || 0} 个宏`;
  const light = backup.lighting ? [tr('背光') + ' · ' + Math.round(backup.lighting.brightness * 4 / 255) * 25 + '% · ' + (backup.lighting.effect ? tr('呼吸') : tr('常亮'))] : [];
  const lines = light.concat((backup.macroNames || []).flatMap((name, i) => name ? [tr`宏 ${i + 1}` + ' · ' + name] : []));
  previewAction(profile.name, info, tr('导出'), () => downloadJson({ ...backup, name: profile.name }, 'flow2-84-profile'), lines);
  for (const layer of backup.keymaps.keys()) {
    const details = document.createElement('details');
    const heading = document.createElement('summary'); heading.textContent = layerName(layer); details.append(heading);
    for (const row of state.layout) {
      const line = document.createElement('p');
      line.textContent = row.map((key) => physicalLabel(key, layer) + ' → ' + mappingAt(backup.keymaps, layer, key.index, backup.macroNames || []).description).join(' · ');
      details.append(line);
    }
    $('action-diff').append(details);
  }
}

function recoveredConfig() {
  const before = readBackup(JSON.stringify(state.recovery.base), state.baseline.length, state.capabilities);
  const draft = readBackup(JSON.stringify(state.recovery.draft), state.baseline.length, state.capabilities);
  return rebaseConfiguration(copyConfiguration(before), copyConfiguration(draft), baseConfiguration(), state.capabilities.macros?.count || 0);
}
function restoreDraft() {
  if (!state.connected || state.busy || state.recording || !state.recovery) return;
  try {
    const value = recoveredConfig();
    state.saveInterrupted = Boolean(state.recovery.writing && state.previous);
    setDraft(value);
    if (!dirtyCount()) state.saveInterrupted = false;
    finishEdit(); renderCatalog();
    notice(tr('已恢复未保存草稿。'), 'success');
  } catch (error) { notice(error.message, 'error'); }
}

function travelHistory(direction) {
  if (!editable()) return;
  const value = direction === 'undo' ? history.undo() : history.redo();
  if (!value) return;
  setDraft(value); persistDraft(); render(); renderCatalog(); syncEditor();
  notice(direction === 'undo' ? tr('已撤销上一步编辑。') : tr('已重做上一步编辑。'));
}
function openShortcut() {
  if (!editable() || !state.selected) return;
  state.shortcut = { held: new Set(), code: null };
  $('shortcut-value').textContent = tr('按下需要的组合键');
  $('shortcut-apply').disabled = true;
  $('shortcut-dialog').showModal(); $('shortcut-area').focus();
}
function captureShortcut(event) {
  if (!state.shortcut) return;
  event.preventDefault(); event.stopPropagation();
  if (event.code === 'Escape') { $('shortcut-dialog').close(); return; }
  const key = eventKeycode(event.code);
  if (!key || event.repeat) return;
  const held = state.shortcut.held;
  if (key >= 0xe0 && key <= 0xe7) {
    if (event.type === 'keydown') held.add(key); else held.delete(key);
    return;
  }
  if (event.type !== 'keydown') return;
  const mask = Number(event.ctrlKey) | (Number(event.shiftKey) << 1) | (Number(event.altKey) << 2) | (Number(event.metaKey) << 3);
  const active = [...held].filter((code) => mask & (1 << ((code - 0xe0) % 4)));
  if (active.some((code) => code >= 0xe4) && active.some((code) => code < 0xe4)) {
    state.shortcut.code = null; $('shortcut-value').textContent = tr('左右修饰键混用请在宏编辑器中添加'); $('shortcut-apply').disabled = true; return;
  }
  state.shortcut.code = withModifiers(key, mask, active.some((code) => code >= 0xe4) ? 'right' : 'left');
  $('shortcut-value').textContent = describeCode(state.shortcut.code);
  $('shortcut-apply').disabled = false;
}
function physicalTestPrompt({ layer, index, physical }) {
  if (state.baseline?.length === 6 && (layer === 1 || layer === 3)) {
    const trigger = state.keys.find(key => key.index !== index && state.baseline[layer - 1][key.index] === 0x5220 + layer);
    if (trigger) return tr`${layerName(layer)} · 按住 ${physicalLabel(trigger, layer - 1)}，再按实体 ${physical}`;
  }
  const prompt = tr`请按实体 ${physical}`;
  return layer === 0 || layer === 2 ? prompt : layerName(layer) + ' · ' + prompt;
}
function renderTester() {
  $('test-total').textContent = state.testTotal;
  $('test-unique').textContent = state.tested.size;
  $('test-held').textContent = state.heldKeys.size;
  $('test-peak').textContent = state.testPeak;
  $('test-sequence').textContent = state.testSequence || tr('尚未收到按键');
  $('test-events').textContent = state.testEvents.slice(-50).map((entry) => `${entry.time}  ${entry.type === 'keydown' ? tr('按下') : tr('松开')}  ${entry.code}  ${entry.key}${entry.repeat ? tr('（重复）') : ''}`).join('\n');
  $('test-mode').disabled = Boolean(state.testStarted && !state.testStored);
  $('test-save-run').disabled = state.testStored || !state.testEvents.length;
  $('test-prompt').hidden = !state.testTarget;
  if (state.testTarget) {
    const { layer, physical } = state.testTarget;
    $('test-prompt').textContent = state.testing ? physicalTestPrompt(state.testTarget) : layerName(layer) + ' · ' + tr('实体键') + ' ' + physical;
  }
  const paused = Boolean(state.testStarted) && !state.testing && !state.testStored;
  const full = !state.testStored && state.testEvents.length >= 500;
  $('test-status').textContent = tr(state.testing ? '正在接收按键' : state.testStored ? '本轮已保存' : paused ? '测试已停止' : '等待开始');
  $('last-key').textContent = state.lastTestKey === ' ' ? tr('空格') : state.lastTestKey || '—';
  $('test-help').hidden = state.testStored;
  $('test-help').textContent = tr(state.testing ? '按 Esc 或离开测试区域即可结束。' : full ? '保存本轮记录或清空记录后可开始下一轮。' : paused ? '选择「继续测试」可接着记录本轮按键。' : '选择「开始测试」，再按实体键盘。');
  $('test-toggle').textContent = tr(state.testing ? '结束测试' : paused && !full ? '继续测试' : '开始测试');
  $('test-toggle').disabled = !state.testing && full;
  $('test-area').classList.toggle('is-active', state.testing);
  $('test-area').setAttribute('aria-label', state.testing ? tr('按键测试区域，按 Esc 结束') : tr('按键测试区域'));
  $('test-keys').replaceChildren(...[...state.tested].map(([code, count]) => {
    const key = document.createElement('span'); key.className = 'tested-key';
    key.classList.toggle('is-held', state.heldKeys.has(code));
    const mapped = eventKeycode(code); key.textContent = `${mapped ? formatKeycode(mapped, /Mac/.test(navigator.platform || '') ? 'mac' : 'windows') : code} · ${count}`; key.title = code; return key;
  }));
}
function clearRun() {
  state.testing = false; state.tested.clear(); state.heldKeys.clear();
  state.testPeak = state.testTotal = 0; state.testEvents = []; state.testSequence = '';
  state.testStarted = state.testMode = null; state.testStored = false; state.lastTestKey = '';
  $('test-run-status').textContent = '';
}
function startTesting() {
  if (state.testStored) { clearRun(); state.testTarget = null; }
  if (!state.testStarted) {
    state.testMode = $('test-mode').value;
    state.testStarted = new Date().toISOString();
  }
  state.testing = true; renderTester(); $('test-area').focus();
}
function stopTesting() { state.testing = false; state.heldKeys.clear(); renderTester(); }
function captureTest(event) {
  if (!state.testing) return;
  event.preventDefault(); event.stopPropagation();
  if (event.code === 'Escape' && event.type === 'keydown') { stopTesting(); return; }
  const code = event.code || event.key;
  if (state.testEvents.length >= 500) { stopTesting(); $('test-run-status').textContent = tr('本轮已记录 500 个事件，请保存记录后清空，再开始下一轮。'); return; }
  state.testEvents.push({ time: new Date().toISOString(), type: event.type, code, key: event.key || '', repeat: Boolean(event.repeat) });
  if (event.type === 'keydown' && !event.repeat && !state.heldKeys.has(code)) {
    state.lastTestKey = event.key || code;
    state.heldKeys.add(code); state.testTotal++;
    state.tested.set(code, (state.tested.get(code) || 0) + 1);
    state.testSequence += event.key?.length === 1 ? event.key : `[${event.key || code}]`;
    state.testPeak = Math.max(state.testPeak, state.heldKeys.size);
  } else if (event.type === 'keyup') state.heldKeys.delete(code);
  renderTester();
}

function saveTestRun() {
  if (state.testStored) return;
  stopTesting();
  if (!state.testEvents.length) { $('test-run-status').textContent = tr('本轮尚未收到按键。'); return; }
  const records = readLocal('flow2-control.test-runs', []);
  records.push({ mode: state.testMode, startedAt: state.testStarted, endedAt: new Date().toISOString(), sequence: state.testSequence, total: state.testTotal, peak: state.testPeak, events: state.testEvents });
  if (writeLocal('flow2-control.test-runs', records.slice(-20))) {
    state.testStored = true;
    $('test-run-status').textContent = tr`已保存「${tr(state.testMode)}」本轮 ${state.testTotal} 次按下。`;
    renderTester();
  }
}

async function probeTouch() {
  if (!editable()) return;
  setBusy(true, tr('检测触控接口'));
  try {
    const result = await state.client.readTouchSupport();
    $('touch-support').textContent = result.supported ? tr`检测到 Studio ${result.version} 触控扩展，设备型号 ${result.model}。` : tr('当前固件未提供触控条自定义接口。原厂音量、屏幕亮度及 Fn＋空格开关可直接使用。');
    log(result.supported ? tr`触控扩展：Studio ${result.version}` : tr('触控扩展查询：当前固件不支持。'));
  } catch (error) { $('touch-support').textContent = tr`检测未完成：${error.message}`; }
  finally { setBusy(false); }
}

$('connect').addEventListener('click', () => state.connected ? disconnect() : connect());
$('refresh').addEventListener('click', refresh);
function submitChanges() {
  if (!state.connected && hardwareCount()) return connect();
  return save();
}
$('save').addEventListener('click', submitChanges);
$('discard').addEventListener('click', () => { if (!editable()) return; state.draft = cloneKeymaps(state.baseline); finishEdit(); notice(tr('已撤销未保存的键位修改。')); });
$('search').addEventListener('input', renderCatalog);
$('search').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' || event.isComposing) return;
  const first = $('catalog').querySelector('button:enabled');
  if (first) { event.preventDefault(); first.focus(); }
});
$('catalog').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  if (!$('catalog').classList.contains('search-results')) return;
  const next = event.key === 'ArrowDown' ? event.target.nextElementSibling : event.target.previousElementSibling;
  event.preventDefault();
  if (next) next.focus();
  else if (event.key === 'ArrowUp') $('search').focus();
});
$('category').addEventListener('change', renderCatalog);
$('modifier-side').addEventListener('change', renderCatalog);
modifierInputs.forEach(input => input.addEventListener('change', renderCatalog));
$('raw-form').addEventListener('submit', (event) => { event.preventDefault(); try { assign(parseKeycode($('raw-code').value)); } catch (error) { notice(error.message, 'error'); } });
$('export').addEventListener('click', exportBackup);
$('import').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    try {
      const text = await file.text();
      const header = JSON.parse(text);
      const name = typeof header?.name === 'string' ? header.name : file.name.replace(/\.json$/i, '');
      if (state.connected) previewImport(text, name);
      else {
        readBackup(text, 6, { macros: { count: 16, size: 2976 }, lighting: true });
        inspectProfile({ name, backup: header });
      }
    } catch (error) { notice(tr`无法读取文件：${error.message}`, 'error'); }
  }
  event.target.value = '';
});
$('restore-previous').addEventListener('click', () => previewImport(state.previous, tr('写入前的快照')));
$('undo-key').addEventListener('click', () => { assign(state.baseline[state.layer][state.selected.index]); });
$('restore-key').addEventListener('click', () => { if (state.original && state.selected) assign(state.original.keymaps[state.layer][state.selected.index]); });
$('advanced-layer').addEventListener('change', () => { if ($('advanced-layer').value) switchLayer(Number($('advanced-layer').value)); });
$('undo').addEventListener('click', () => travelHistory('undo'));
$('redo').addEventListener('click', () => travelHistory('redo'));
document.querySelectorAll('[data-level]').forEach((button) => button.addEventListener('click', () => {
  if (!editable() || !state.lightDraft) return;
  state.lightDraft.brightness = [0, 64, 128, 192, 255][Number(button.dataset.level)];
  finishEdit();
}));

$('light-effect').addEventListener('change', () => { if (!editable()) return; state.lightDraft.effect = Number($('light-effect').value); finishEdit(); });
$('undo-light').addEventListener('click', () => { if (!editable()) return; state.lightDraft = { ...state.lightBase }; finishEdit(); });
$('discard-all').addEventListener('click', () => {
  if (state.busy || state.recording || !state.baseline) return;
  state.draft = cloneKeymaps(state.baseline);
  state.lightDraft = state.lightBase ? { ...state.lightBase } : null;
  state.macroDraft = state.macroBase ? [...state.macroBase] : null;
  state.macroNames = [...state.macroBaseNames];
  state.saveInterrupted = false;
  finishEdit(); notice(tr(state.connected ? '已撤销全部未保存修改。可用撤销按钮找回。' : '已丢弃本机草稿。'));
});
$('review').addEventListener('click', previewChanges);
$('close-review').addEventListener('click', () => $('review-dialog').close());
$('review-save').addEventListener('click', () => { $('review-dialog').close(); submitChanges(); });
$('add-text').addEventListener('click', () => {
  const value = $('macro-text').value;
  if (value) insertMacro([{ type: 'text', value }]);
});
$('add-key').addEventListener('click', () => {
  const modifiers = [...document.querySelectorAll('input[name="macro-modifier"]')].reduce((value, input) => value | (input.checked ? Number(input.value) : 0), 0);
  insertMacro(chordActions(Number($('macro-key').value), modifiers));
});
$('add-delay').addEventListener('click', () => insertMacro([{ type: 'delay', value: Number($('macro-delay').value) }]));
$('clear-macro').addEventListener('click', () => updateMacro([]));
$('undo-macro').addEventListener('click', () => updateMacro(decodeMacros(state.macroBase, state.capabilities.macros.count)[state.macroSlot]));
$('record-macro').addEventListener('click', startRecording);
$('stop-record').addEventListener('click', stopRecording);
$('record-area').addEventListener('keydown', captureMacro);
$('record-area').addEventListener('keyup', captureMacro);
window.addEventListener('blur', stopRecording);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopRecording(); stopTesting(); } });
$('record-area').addEventListener('focusout', (event) => { if (!$('record-area').contains(event.relatedTarget)) stopRecording(); });
$('assign-macro').addEventListener('click', () => {
  state.assigningMacro = state.macroSlot;
  showView('keymap');
  state.kind = 'macro';
  $('search').value = '';
  renderCatalog();
  renderControls();
  notice('');
  buttons.get(state.selected?.position)?.focus();
});
$('cancel-assignment').addEventListener('click', () => { state.assigningMacro = null; renderControls(); });
$('macro-key').replaceChildren(...macroKeyOptions());
$('insert-end').addEventListener('click', () => { state.macroStep = -1; renderMacros(); renderControls(); });
$('macro-name').addEventListener('change', () => {
  if (!editable()) return;
  state.macroNames[state.macroSlot] = $('macro-name').value.trim();
  finishEdit(); renderCatalog();
});
$('copy-macro').addEventListener('click', () => {
  const target = Number($('macro-copy-target').value);
  if (!editable() || target === state.macroSlot) return;
  const copy = () => {
    if (!editable()) return;
    try {
      state.macroDraft = replaceMacro(state.macroDraft, state.capabilities.macros.count, target, macroActions());
      state.macroNames[target] = tr`${macroName(state.macroSlot)} 副本`.slice(0, 48);
      state.macroSlot = target; state.macroStep = -1; finishEdit(); renderCatalog();
      notice(tr`已复制到宏 ${target + 1}，保存后生效。`);
    } catch (error) { notice(error.message, 'error'); }
  };
  if (decodeMacros(state.macroDraft, state.capabilities.macros.count)[target].length) previewAction(tr('替换目标宏'), tr`复制将替换「${macroName(target)}」的现有动作，可通过撤销找回。`, tr('复制并替换'), copy);
  else copy();
});
$('record-delay-mode').addEventListener('change', () => { $('fixed-delay').hidden = $('fixed-delay-unit').hidden = $('record-delay-mode').value !== 'fixed'; });
$('profile-new').addEventListener('click', () => editName(tr('保存当前草稿为方案'), tr('我的方案'), (name) => {
  state.profiles.push({ id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), backup: backupOf(draftConfiguration()) });
  if (storeProfiles()) notice(tr`已将「${name}」保存到本机方案库。`, 'success');
}));
$('sample-profile').addEventListener('click', async () => {
  try {
    const response = await fetch('./examples/navigation.json');
    if (!response.ok) throw Error(response.statusText);
    inspectProfile({ name: tr('导航键示例'), backup: await response.json() });
  } catch (error) { notice(tr`无法读取文件：${error.message}`, 'error'); }
});
$('profile-select').addEventListener('change', () => {
  const selection = $('profile-select').value;
  $('profile-select').value = '';
  if (selection === 'library') { showView('backup'); return; }
  const profile = state.profiles.find((item) => item.id === selection);
  if (profile) loadProfile(profile);
});
$('name-form').addEventListener('submit', (event) => { event.preventDefault(); const name = $('name-input').value.trim(); if (!name) return; $('name-dialog').close(); state.nameAction?.(name); });
$('name-cancel').addEventListener('click', () => $('name-dialog').close());
$('action-cancel').addEventListener('click', () => $('action-dialog').close());
$('action-confirm').addEventListener('click', () => { $('action-dialog').close(); state.pendingAction?.(); });
$('export-draft').addEventListener('click', () => downloadJson(backupOf(draftConfiguration()), 'flow2-84-draft'));
$('restore-original').addEventListener('click', () => { if (state.original) previewImport(JSON.stringify(backupOf(state.original)), tr('初始配置')); });
$('restore-draft').addEventListener('click', () => {
  if (!state.recovery) return;
  try { previewAction(tr('恢复草稿'), tr('载入后成为草稿，保存后生效。'), tr('恢复草稿'), restoreDraft, configurationLines(draftConfiguration(), recoveredConfig())); }
  catch (error) { notice(error.message, 'error'); }
});
$('export-recovery').addEventListener('click', () => { if (state.recovery) downloadJson(state.recovery.draft, 'flow2-84-recovered-draft'); });
$('ignore-draft').addEventListener('click', () => { state.recovery = null; writeLocal(DRAFT_KEY, null); $('recovery-banner').hidden = true; renderControls(); });
$('capture-shortcut').addEventListener('click', openShortcut);
$('shortcut-close').addEventListener('click', () => $('shortcut-dialog').close());
$('shortcut-dialog').addEventListener('close', () => { state.shortcut = null; });
$('shortcut-area').addEventListener('keydown', captureShortcut);
$('shortcut-area').addEventListener('keyup', captureShortcut);
$('shortcut-area').addEventListener('blur', () => state.shortcut?.held.clear());
$('shortcut-apply').addEventListener('click', () => { const code = state.shortcut?.code; if (code !== null && code !== undefined) assign(code); $('shortcut-dialog').close(); });
$('test-toggle').addEventListener('pointerdown', (event) => { if (state.testing) event.preventDefault(); });
$('test-toggle').addEventListener('click', () => { if (state.testing) stopTesting(); else startTesting(); });
$('test-clear').addEventListener('click', () => { clearRun(); renderTester(); });

$('test-save-run').addEventListener('click', saveTestRun);
$('test-export').addEventListener('click', () => downloadJson({ app: 'FLOW2 Control', records: readLocal('flow2-control.test-runs', []) }, 'flow2-physical-tests'));
$('touch-probe').addEventListener('click', probeTouch);
$('test-area').addEventListener('keydown', captureTest);
$('test-area').addEventListener('keyup', captureTest);
$('test-area').addEventListener('blur', (event) => { if (event.relatedTarget !== $('test-toggle')) stopTesting(); });
window.addEventListener('blur', stopTesting);
$('export-diagnostics').addEventListener('click', () => downloadJson({ app: 'FLOW2 Control', version: VERSION, device: 'FLOW 2 84 / OE927', connected: state.connected, protocol: 12, layers: state.baseline?.length || null, capabilities: state.capabilities, logs: state.logs }, 'flow2-diagnostics'));
document.addEventListener('keydown', (event) => {
  if (event.target.closest('input, textarea, select, [contenteditable], dialog') || state.recording || state.testing) return;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  if (event.code === 'KeyZ' || event.code === 'KeyY') { event.preventDefault(); travelHistory(event.code === 'KeyY' || event.shiftKey ? 'redo' : 'undo'); }
});
$('system-layer').addEventListener('change', () => switchLayer(($('system-layer').value === 'mac' ? 0 : 2) + (state.layer < 4 ? state.layer % 2 : 0)));
document.querySelectorAll('[data-kind]').forEach((button) => button.addEventListener('click', () => {
  if (state.kind === button.dataset.kind) return;
  state.kind = button.dataset.kind; $('search').value = ''; syncEditor(); renderCatalog();
}));
$('open-bound-macro').addEventListener('click', () => {
  state.macroSlot = mappingAt(state.draft, state.layer, state.selected.index, state.macroNames).effective - 0x7700;
  state.macroStep = -1; showView('macros');
});
$('case-touch').addEventListener('click', (event) => showView('touch', event.currentTarget));
document.querySelectorAll('[data-gesture]').forEach((button) => button.addEventListener('click', () => {
  state.gesture = button.dataset.gesture;
  $('touch-detail').dataset.gestureView = state.gesture;
  document.querySelectorAll('[data-gesture]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  renderKeyboard();
}));
function closeInspector() {
  const touch = state.view === 'touch';
  if (touch) showView('keymap');
  $('inspector').classList.toggle('is-open', false);
  (touch ? touchOpener : buttons.get(state.selected?.position))?.focus();
}
$('close-inspector').addEventListener('click', closeInspector);
$('inspector').addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { event.preventDefault(); closeInspector(); }
});
$('guide-test').addEventListener('click', () => { state.testTarget = null; showView('test'); renderTester(); });
$('test-saved-key').addEventListener('click', () => {
  if (!state.savedKey) return;
  clearRun(); state.testTarget = state.savedKey; showView('test'); startTesting();
});
$('language').addEventListener('change', () => {
  const language = $('language').value;
  setLanguage(language); writeLocal('flow2-control.language', language);
  notice(''); renderProfiles(); render(); syncEditor(); renderCatalog(); renderTester(); showView(state.view);
  setBusy(state.busy);
  if (state.baseline) deviceDetails();
});

window.addEventListener('beforeunload', (event) => { if (state.busy || state.recording || dirtyCount()) { event.preventDefault(); event.returnValue = ''; } });

async function initialize() {
  try {
    prepareText(document);
    const language = readLocal('flow2-control.language', navigator.language?.startsWith('zh') ? 'zh-CN' : 'en');
    setLanguage(language); $('language').value = currentLanguage();
    $('app-version').textContent = 'v' + VERSION;
    if (/Mac/.test(navigator.platform || '')) state.layer = 0;
    openSession();
    if (document.documentElement.dataset.runtime !== 'desktop' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js', { type: 'module', updateViaCache: 'none' }).catch(() => notice(tr('离线缓存未能建立。'), 'error'));
    }
    const profiles = readLocal(PROFILES_KEY, []);
    state.profiles = Array.isArray(profiles) ? profiles : [];
    const response = await fetch('./flow2-84.official.json');
    if (!response.ok) throw new Error(tr('无法读取内置键盘布局。'));
    state.layout = buildLayout(await response.json());
    buildKeyboard();
    notice('');
    render();
    renderCatalog();
    renderProfiles();
    renderTester();
    if (!navigator.hid) return;
    navigator.hid.addEventListener('disconnect', (event) => { if (state.client?.device === event.device) disconnect(); });
    navigator.hid.addEventListener('connect', (event) => { if (!state.connected && !state.busy && isFlow2(event.device)) connect(event.device); });
    const known = (await navigator.hid.getDevices()).filter(isFlow2);
    if (known.length === 1) await connect(known[0]);
  } catch (error) { notice(error.message, 'error'); log(error.message); }
}

initialize();
