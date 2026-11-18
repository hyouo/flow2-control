import { tr } from './locale.js';
export const FLOW2 = Object.freeze({ vendorId: 0x388d, productId: 0x0002, rows: 6, cols: 15 });
export const COMMAND = Object.freeze({ VERSION: 0x01, GET_KEY: 0x04, SET_KEY: 0x05, SET_LIGHT: 0x07, GET_LIGHT: 0x08, SAVE_LIGHT: 0x09, MACRO_COUNT: 0x0c, MACRO_SIZE: 0x0d, GET_MACRO: 0x0e, SET_MACRO: 0x0f, LAYERS: 0x11, GET_BUFFER: 0x12 });

export class UnsupportedCommandError extends Error {}
export const brightnessLevel = (value) => Math.round(value * 4 / 255);
export const sameLighting = (a, b) => Boolean(a && b && brightnessLevel(a.brightness) === brightnessLevel(b.brightness) && a.effect === b.effect);

export function isFlow2(device) {
  return device.vendorId === FLOW2.vendorId && device.productId === FLOW2.productId
    && device.collections.some((collection) => collection.usagePage === 0xff60 && collection.usage === 0x61);
}

const word = (value) => [value >> 8, value & 0xff];

export class ViaTransport {
  constructor(device, { timeoutMs = 1800 } = {}) {
    this.device = device;
    this.timeoutMs = timeoutMs;
    this.queue = Promise.resolve();
    this.pending = null;
    this.closed = true;
    this.failure = null;
    this.ignoredReports = 0;
    this.onReport = this.onReport.bind(this);
  }

  async open() {
    if (!this.closed) return;
    if (!this.device.opened) await this.device.open();
    this.closed = false;
    this.failure = null;
    this.device.addEventListener('inputreport', this.onReport);
  }

  onReport(event) {
    const pending = this.pending;
    if (!pending || event.reportId !== 0) return;
    const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    if (bytes[0] === 0xff) {
      pending.finish(new UnsupportedCommandError(tr('键盘固件不支持这条配置命令。')));
      return;
    }
    if (!pending.prefix.every((value, index) => bytes[index] === value)) {
      this.ignoredReports += 1;
      return;
    }
    if (bytes.length !== 32) {
      pending.finish(new Error(tr('键盘返回的数据不完整，请重新连接。')));
      return;
    }
    pending.finish(null, bytes.slice());
  }

  request(command, args = []) {
    const prefix = [command, ...args];
    if (prefix.length > 32) return Promise.reject(new Error(tr('HID 命令超过 32 字节。')));
    const operation = this.queue.then(() => this.exchange(prefix));
    this.queue = operation.catch(() => {});
    return operation;
  }

  exchange(payload) {
    if (this.closed) return Promise.reject(new Error(tr('键盘尚未连接。')));
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const packet = new Uint8Array(32);
      packet.set(payload);
      const headerLength = [4, 5, 0x0e, 0x0f, 0x12, 0x16, 0x18].includes(payload[0]) ? 4 : [7, 8].includes(payload[0]) ? 3 : payload.length;
      const prefix = payload.slice(0, headerLength);
      const pending = {
        prefix,
        finish: (error, data) => {
          if (this.pending !== pending) return;
          clearTimeout(timer);
          this.pending = null;
          if (error) {
            if (!(error instanceof UnsupportedCommandError)) this.failure = error;
            reject(error);
          } else {
            resolve(data);
          }
        },
      };
      const timer = setTimeout(() => pending.finish(new Error(tr('键盘没有及时回应。请关闭其他键盘配置页面，再重新连接。'))), this.timeoutMs);
      this.pending = pending;
      Promise.resolve().then(() => this.device.sendReport(0, packet)).catch((error) => {
        pending.finish(new Error(tr`USB 通信失败：${error.message}`));
      });
    });
  }

  async close() {
    this.closed = true;
    this.pending?.finish(new Error(tr('键盘连接已断开。')));
    this.device.removeEventListener('inputreport', this.onReport);
    if (this.device.opened) await this.device.close();
  }
}

export class Flow2Keyboard {
  constructor(device, options) {
    if (!isFlow2(device)) throw new Error(tr('请选择 FLOW 2 84 键（OE927）。'));
    this.device = device;
    this.transport = new ViaTransport(device, options);
    this.protocol = 0;
    this.layerCount = 0;
    this.macroCount = 0;
    this.macroSize = 0;
  }

  async connect() {
    await this.transport.open();
    try {
      const version = await this.transport.request(COMMAND.VERSION);
      this.protocol = (version[1] << 8) | version[2];
      if (this.protocol !== 12) throw new Error(tr`当前键盘使用 VIA 协议 ${this.protocol}；此版本工具适配协议 12。`);
      const layers = await this.transport.request(COMMAND.LAYERS);
      this.layerCount = layers[1];
      if (this.layerCount < 1 || this.layerCount > 32) throw new Error(tr('键盘返回的配置层数无效。'));
      return { protocol: this.protocol, layerCount: this.layerCount };
    } catch (error) {
      await this.transport.close();
      throw error;
    }
  }

  async readKeymaps(onProgress = () => {}) {
    const cellCount = FLOW2.rows * FLOW2.cols;
    const result = [];
    for (let layer = 0; layer < this.layerCount; layer += 1) {
      const bytes = new Uint8Array(cellCount * 2);
      for (let offset = 0; offset < bytes.length; offset += 28) {
        const size = Math.min(28, bytes.length - offset);
        const address = layer * bytes.length + offset;
        const response = await this.transport.request(COMMAND.GET_BUFFER, [...word(address), size]);
        bytes.set(response.subarray(4, 4 + size), offset);
      }
      result.push(Array.from({ length: cellCount }, (_, index) => (bytes[index * 2] << 8) | bytes[index * 2 + 1]));
      onProgress(layer + 1, this.layerCount);
    }
    return result;
  }

  async readCapabilities() {
    const result = { macros: null, lighting: null };
    try {
      const count = await this.transport.request(COMMAND.MACRO_COUNT);
      const size = await this.transport.request(COMMAND.MACRO_SIZE);
      this.macroCount = count[1];
      this.macroSize = (size[1] << 8) | size[2];
      if (this.macroCount > 0 && this.macroCount <= 128 && this.macroSize > this.macroCount) result.macros = { count: this.macroCount, size: this.macroSize };
    } catch (error) { if (!(error instanceof UnsupportedCommandError)) throw error; }
    try { result.lighting = await this.readLighting(); }
    catch (error) { if (!(error instanceof UnsupportedCommandError)) throw error; }
    return result;
  }

  async readLighting() {
    const brightness = await this.transport.request(COMMAND.GET_LIGHT, [1, 1]);
    const effect = await this.transport.request(COMMAND.GET_LIGHT, [1, 2]);
    if (effect[3] > 1) throw new UnsupportedCommandError(tr('当前背光模式尚未适配。'));
    return { brightness: brightness[3], effect: effect[3] };
  }

  async readTouchSupport() {
    const request = new Uint8Array(32);
    request.set([0x18, 0x4c, 0x46, 0x54, 0x02]);
    request[21] = 84;
    crypto.getRandomValues(request.subarray(22, 26));
    let reply;
    try { reply = await this.transport.request(request[0], [...request.subarray(1)]); }
    catch (error) { if (error instanceof UnsupportedCommandError) return { supported: false }; throw error; }
    const supported = reply[4] === 0x81 && reply[5] === 0 && reply[6] === 0 && reply[21] === 84
      && request.subarray(22, 26).every((n, i) => reply[22 + i] === n)
      && [3, 0x54, 0x43, 0x32, 0].every((n, i) => reply[27 + i] === n);
    return supported ? { supported, model: 84, version: 'TC2' } : { supported: false };
  }

  async readMacros() {
    const bytes = [];
    for (let offset = 0; offset < this.macroSize; offset += 28) {
      const size = Math.min(28, this.macroSize - offset);
      const reply = await this.transport.request(COMMAND.GET_MACRO, [...word(offset), size]);
      bytes.push(...reply.subarray(4, 4 + size));
    }
    return bytes;
  }

  async applyMacros(before, after) {
    if (!this.macroSize || after.length !== this.macroSize || after.at(-1) !== 0 || after.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) throw new Error(tr('宏备份容量或内容与键盘不一致。'));
    const actual = await this.readMacros();
    if (actual.every((value, index) => value === after[index])) return;
    if (!actual.every((value, index) => value === before[index])) throw new Error(tr('宏已被其他配置操作修改，请重新连接后再保存。'));
    const last = this.macroSize - 1;
    await this.transport.request(COMMAND.SET_MACRO, [...word(last), 1, 255]);
    for (let offset = 0; offset < last; offset += 28) {
      const data = after.slice(offset, Math.min(offset + 28, last));
      await this.transport.request(COMMAND.SET_MACRO, [...word(offset), data.length, ...data]);
    }
    const written = await this.readMacros();
    if (!written.slice(0, last).every((value, index) => value === after[index])) throw new Error(tr('宏读回不一致，宏暂未启用；重新连接后可继续保存或导入备份恢复。'));
    await this.transport.request(COMMAND.SET_MACRO, [...word(last), 1, 0]);
    const verified = await this.readMacros();
    if (!verified.every((value, index) => value === after[index])) throw new Error(tr('宏保存未确认，请重新连接。'));
  }

  async applyLighting(before, after) {
    if (!Number.isInteger(after.brightness) || after.brightness < 0 || after.brightness > 255) throw new Error(tr('请选择有效的背光档位。'));
    if (![0, 1].includes(after.effect)) throw new Error(tr('请选择常亮或呼吸模式。'));
    const actual = await this.readLighting();
    const actualLevel = brightnessLevel(actual.brightness);
    if ((actualLevel !== brightnessLevel(before.brightness) && actualLevel !== brightnessLevel(after.brightness)) || (actual.effect !== before.effect && actual.effect !== after.effect)) throw new Error(tr('背光已发生变化，请重新连接后再保存。'));
    for (const [name, id] of [['brightness', 1], ['effect', 2]]) {
      if (actual[name] !== after[name]) await this.transport.request(COMMAND.SET_LIGHT, [1, id, after[name]]);
    }
    await this.transport.request(COMMAND.SAVE_LIGHT, [1]);
    const result = await this.readLighting();
    if (!sameLighting(result, after)) throw new Error(tr('背光设置未保存成功，请重新连接读取实际值。'));
    return result;
  }

  async getKey(layer, row, col) {
    const response = await this.transport.request(COMMAND.GET_KEY, [layer, row, col]);
    return (response[4] << 8) | response[5];
  }

  async applyChanges(changes, onApplied = () => {}) {
    let completed = 0;
    for (const change of changes) {
      const { layer, row, col, before, after } = change;
      const current = await this.getKey(layer, row, col);
      if (current !== after) {
        if (current !== before) throw new Error(tr`层 ${layer} 的键位已被其他配置操作修改，请重新读取后再编辑。`);
        await this.transport.request(COMMAND.SET_KEY, [layer, row, col, ...word(after)]);
        const readback = await this.getKey(layer, row, col);
        if (readback !== after) throw new Error(tr`层 ${layer} 的按键未保存成功。请重新读取键位。`);
      }
      completed += 1;
      onApplied(change, completed, changes.length);
    }
    return completed;
  }

  close() { return this.transport.close(); }
}
