import { tr } from './locale.js';

export const KEYCODES = [];
const add = (code, label, group, hint = '') => KEYCODES.push({ code, label, group, hint });

for (let index = 0; index < 26; index++) add(4 + index, String.fromCharCode(65 + index), '字母数字');
for (let index = 0; index < 10; index++) add(0x1e + index, String((index + 1) % 10), '字母数字');

[
  [0x28, 'Enter', '回车'], [0x29, 'Esc', '退出'], [0x2a, 'Backspace', '退格'],
  [0x2b, 'Tab', '制表'], [0x2c, 'Space', '空格'], [0x39, 'Caps Lock', '大写锁定'],
  [0x46, 'PrtSc', '截图'], [0x47, 'Scroll Lock', '滚动锁定'], [0x48, 'Pause', '暂停'],
  [0x49, 'Insert', '插入'], [0x4a, 'Home', '行首'], [0x4b, 'Page Up', '向上翻页'],
  [0x4c, 'Delete', '删除'], [0x4d, 'End', '行尾'], [0x4e, 'Page Down', '向下翻页'],
  [0x4f, '→', '方向右'], [0x50, '←', '方向左'], [0x51, '↓', '方向下'], [0x52, '↑', '方向上'],
  [0x65, 'Menu', '菜单'],
].forEach(([code, label, hint]) => add(code, label, '编辑导航', hint));

[
  [0x2d, '-'], [0x2e, '='], [0x2f, '['], [0x30, ']'], [0x31, '\\'],
  [0x33, ';'], [0x34, "'"], [0x35, '`'], [0x36, ','], [0x37, '.'], [0x38, '/'],
].forEach(([code, label]) => add(code, label, '符号'));
for (let index = 0; index < 12; index++) add(0x3a + index, `F${index + 1}`, '功能键');
for (let index = 0; index < 12; index++) add(0x68 + index, `F${index + 13}`, '功能键');
[
  [0xe0, '左 Ctrl'], [0xe1, '左 Shift'], [0xe2, '左 Alt'], [0xe3, '左 Win / Cmd'],
  [0xe4, '右 Ctrl'], [0xe5, '右 Shift'], [0xe6, '右 Alt'], [0xe7, '右 Win / Cmd'],
].forEach(([code, label]) => add(code, label, '修饰键'));
[
  [0xa8, '静音'], [0xa9, '音量 +'], [0xaa, '音量 −'], [0xab, '下一曲'], [0xac, '上一曲'],
  [0xad, '停止播放'], [0xae, '播放 / 暂停'], [0xb1, '邮件'], [0xb2, '计算器'], [0xb3, '我的电脑'],
  [0xb4, '搜索'], [0xbd, '屏幕亮度 +'], [0xbe, '屏幕亮度 −'],
  [0x7800, '背光开启'], [0x7801, '背光关闭'], [0x7802, '背光开关'],
  [0x7803, '背光 −'], [0x7804, '背光 +'], [0x7805, '背光档位'],
].forEach(([code, label]) => add(code, label, '媒体灯光'));
[
  [0x0106, '复制', 'Ctrl + C'], [0x0119, '粘贴', 'Ctrl + V'], [0x011b, '剪切', 'Ctrl + X'],
  [0x011d, '撤销', 'Ctrl + Z'], [0x0104, '全选', 'Ctrl + A'], [0x0116, '保存', 'Ctrl + S'],
  [0x0109, '查找', 'Ctrl + F'], [0x0808, '文件管理器', 'Win + E'], [0x0807, '显示桌面', 'Win + D'],
].forEach(([code, label, hint]) => add(code, label, '快捷键', hint));
add(0, '禁用此键', '特殊');
add(1, '沿用下层', '特殊', '透明键');

const byCode = new Map(KEYCODES.map((key) => [key.code, key]));
const shortModifiers = new Map([[0xe0, 'Ctrl'], [0xe1, 'Shift'], [0xe2, 'Alt'], [0xe3, 'Win'], [0xe4, 'RCtrl'], [0xe5, 'RShift'], [0xe6, 'RAlt'], [0xe7, 'RWin']]);
const flowActions = new Map([
  [0x7793, '蓝牙 1'], [0x7794, '蓝牙 2'], [0x7795, '蓝牙 3'], [0x7785, '2.4G'],
  [0x7e07, '多屏显示'], [0x7e0a, '切换背光模式'], [0x7e0e, '切换背光模式'], [0x7e0d, '触控条开关'],
]);

export const hexCode = (code) => `0x${code.toString(16).toUpperCase().padStart(4, '0')}`;

export function formatKeycode(code, system = 'windows') {
  if (code >= 0x0100 && code <= 0x1fff) {
    const modifier = code >> 8;
    if (system === 'mac') {
      const keys = ['⌃', '⇧', '⌥', '⌘'].filter((_, i) => modifier & (1 << i));
      return (modifier & 0x10 ? 'R' : '') + keys.join('') + formatKeycode(code & 0xff, system);
    }
    const names = ['Ctrl', 'Shift', 'Alt', 'Win'].filter((_, index) => modifier & (1 << index));
    if (modifier & 0x10) names.forEach((name, index) => { names[index] = `R${name}`; });
    return [...names, formatKeycode(code & 0xff, system)].join('+');
  }
  if (shortModifiers.has(code)) return system === 'mac' ? ['⌃','⇧','⌥','⌘','R⌃','R⇧','R⌥','R⌘'][code - 0xe0] : shortModifiers.get(code);
  if (code >= 0x5220 && code <= 0x523f) return `Fn → ${code & 0x1f}`;
  if (code >= 0x5260 && code <= 0x527f) return tr`切换层 ${code & 0x1f}`;
  if (code >= 0x5200 && code <= 0x521f) return tr`进入层 ${code & 0x1f}`;
  if (code >= 0x5240 && code <= 0x525f) return tr`基础层 ${code & 0x1f}`;
  if (code >= 0x7700 && code <= 0x777f) return tr`宏 ${code - 0x7700 + 1}`;
  if (flowActions.has(code)) return tr(flowActions.get(code));
  if (system === 'windows' && code === 0x7e0c) return tr('语音助手');
  if (system === 'windows' && code === 0x7e08) return tr('锁定系统');
  return tr(byCode.get(code)?.label ?? hexCode(code));
}

export function keyCatalog(layerCount, macroCount = 0, system = 'windows', macroNames = []) {
  const layers = [];
  for (let layer = 0; layer < layerCount; layer++) {
    layers.push({ code: 0x5220 + layer, label: tr`按住切换到层 ${layer}`, hint: `Fn → ${layer}`, group: '层切换' });
    layers.push({ code: 0x5260 + layer, label: tr`切换层 ${layer} 开关`, hint: `TG(${layer})`, group: '层切换' });
    layers.push({ code: 0x5200 + layer, label: tr`进入层 ${layer}`, hint: `TO(${layer})`, group: '层切换' });
  }
  const macros = Array.from({ length: macroCount }, (_, index) => ({ code: 0x7700 + index, label: macroNames[index] || tr`宏 ${index + 1}`, hint: tr`宏 ${index + 1}`, group: '宏' }));
  const catalogue = system === 'mac' ? KEYCODES.filter((key) => key.group !== '快捷键').concat([
    [6, '复制'], [25, '粘贴'], [27, '剪切'], [29, '撤销'], [4, '全选'], [22, '保存'], [9, '查找'],
  ].map(([code, label]) => ({ code: 0x0800 | code, label, hint: 'Cmd + ' + formatKeycode(code), group: '快捷键' }))) : KEYCODES;
  return [...catalogue, ...layers, ...macros];
}

export function keycodeModifiers(code) {
  return code >= 0x0100 && code <= 0x1fff ? { mask: (code >> 8) & 15, side: code & 0x1000 ? 'right' : 'left' } : { mask: 0, side: 'left' };
}

export function withModifiers(code, mask, side = 'left') {
  return mask ? code | (mask << 8) | (side === 'right' ? 0x1000 : 0) : code;
}

export const PHYSICAL_LABELS = [
  ['Esc', ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`), 'PrtSc', 'Ins', 'Del'],
  ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace', 'Home'],
  ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\', 'End'],
  ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter', 'PgUp'],
  ['LShift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'RShift', '↑', 'PgDn'],
  ['LCtrl', 'LWin', 'LAlt', 'Space', 'RAlt', 'Fn', 'RCtrl', '←', '↓', '→'],
];
