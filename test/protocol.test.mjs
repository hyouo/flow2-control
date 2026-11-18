import test from 'node:test';
import assert from 'node:assert/strict';
import { ViaTransport, Flow2Keyboard, COMMAND, FLOW2 } from '../public/via.js';

class FakeHid extends EventTarget {
  constructor(respond) {
    super();
    this.vendorId = FLOW2.vendorId;
    this.productId = FLOW2.productId;
    this.collections = [{ usagePage: 0xff60, usage: 0x61 }];
    this.respond = respond;
    this.opened = false;
    this.sent = [];
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport(id, packet) {
    assert.equal(id, 0);
    assert.equal(packet.length, 32);
    this.sent.push([...packet]);
    await this.respond?.(packet, this);
  }
  emit(values) {
    const bytes = new Uint8Array(32);
    bytes.set(values);
    const event = new Event('inputreport');
    event.data = new DataView(bytes.buffer);
    event.reportId = 0;
    this.dispatchEvent(event);
  }
}

test('touch query uses the read operation and an unsupported reply leaves VIA usable', async () => {
  const device = new FakeHid((packet, target) => target.emit(packet[0] === 0x18 ? [0xff] : [1, 0, 12]));
  const keyboard = new Flow2Keyboard(device); await keyboard.transport.open();
  assert.deepEqual(await keyboard.readTouchSupport(), { supported: false });
  assert.deepEqual(device.sent[0].slice(0, 8), [0x18, 0x4c, 0x46, 0x54, 2, 0, 0, 0]);
  const reply = await keyboard.transport.request(1); assert.equal(reply[2], 12);
  await keyboard.close();
});

test('touch query accepts the 84-key extension response with its response header', async () => {
  const device = new FakeHid((packet, target) => {
    const reply = [...packet]; reply[4] = 0x81; reply[5] = 0;
    reply.splice(27, 5, 3, 0x54, 0x43, 0x32, 0);
    target.emit(reply);
  });
  const keyboard = new Flow2Keyboard(device); await keyboard.transport.open();
  assert.deepEqual(await keyboard.readTouchSupport(), { supported: true, version: 'TC2', model: 84 });
  await keyboard.close();
});

test('ignores a response for the preceding keymap offset', async () => {
  const device = new FakeHid((packet, target) => {
    target.emit([0x12, 0, 28, 28, 0, 4]);
    target.emit([...packet.slice(0, 4), 0x12, 0x34]);
  });
  const transport = new ViaTransport(device);
  await transport.open();
  const result = await transport.request(0x12, [0, 56, 28]);
  assert.equal(transport.ignoredReports, 1);
  assert.deepEqual([...result.slice(4, 6)], [0x12, 0x34]);
  await transport.close();
});

test('concurrent callers send one request at a time', async () => {
  let inFlight = 0;
  let maximum = 0;
  const device = new FakeHid(async (packet, target) => {
    maximum = Math.max(maximum, ++inFlight);
    await new Promise((resolve) => setTimeout(resolve, 3));
    inFlight -= 1;
    target.emit(packet);
  });
  const transport = new ViaTransport(device);
  await transport.open();
  await Promise.all([transport.request(1), transport.request(0x11), transport.request(0x04, [0, 2, 1])]);
  assert.equal(maximum, 1);
  assert.deepEqual(device.sent.map((packet) => packet[0]), [1, 0x11, 0x04]);
  await transport.close();
});

test('a timed-out connection stops queued commands instead of retrying forever', async () => {
  const device = new FakeHid();
  const transport = new ViaTransport(device, { timeoutMs: 15 });
  await transport.open();
  const results = await Promise.allSettled([transport.request(1), transport.request(0x11)]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  assert.equal(device.sent.length, 1);
  await transport.close();
});

test('disconnect rejects an active request and does not send queued work', async () => {
  const device = new FakeHid();
  const transport = new ViaTransport(device);
  await transport.open();
  const result = Promise.allSettled([transport.request(1), transport.request(0x11)]);
  await new Promise((resolve) => setImmediate(resolve));
  await transport.close();
  assert.ok((await result).every((item) => item.status === 'rejected'));
  assert.equal(device.sent.length, 1);
});

function memoryDevice({ ignoreWrites = false, ignoreMacroWrites = false } = {}) {
  const memory = Array.from({ length: 6 * 90 }, (_, index) => (index * 17) & 0xffff);
  const macroMemory = Array(2976).fill(0);
  const lighting = { brightness: 255, effect: 0 };
  const device = new FakeHid((packet, target) => {
    const reply = [...packet];
    if (packet[0] === COMMAND.VERSION) { reply[1] = 0; reply[2] = 12; }
    if (packet[0] === COMMAND.LAYERS) reply[1] = 6;
    if (packet[0] === COMMAND.MACRO_COUNT) reply[1] = 16;
    if (packet[0] === COMMAND.MACRO_SIZE) { reply[1] = 11; reply[2] = 160; }
    if ([COMMAND.GET_MACRO, COMMAND.SET_MACRO].includes(packet[0])) {
      const offset = (packet[1] << 8) | packet[2];
      for (let index = 0; index < packet[3]; index++) {
        if (packet[0] === COMMAND.SET_MACRO && (!ignoreMacroWrites || offset === 2975)) macroMemory[offset + index] = packet[4 + index];
        if (packet[0] === COMMAND.GET_MACRO) reply[4 + index] = macroMemory[offset + index];
      }
    }
    if ([COMMAND.GET_LIGHT, COMMAND.SET_LIGHT].includes(packet[0])) {
      const name = packet[2] === 1 ? 'brightness' : 'effect';
      if (packet[0] === COMMAND.SET_LIGHT && !ignoreWrites) lighting[name] = name === 'brightness' ? Math.floor(Math.round(packet[3] * 4 / 255) * 255 / 4) : packet[3];
      reply[3] = lighting[name];
    }
    if (packet[0] === COMMAND.GET_BUFFER) {
      const offset = ((packet[1] << 8) | packet[2]) / 2;
      for (let byte = 0; byte < packet[3]; byte += 2) {
        const value = memory[offset + byte / 2];
        reply[4 + byte] = value >> 8;
        reply[5 + byte] = value & 255;
      }
    }
    if (packet[0] === COMMAND.GET_KEY || packet[0] === COMMAND.SET_KEY) {
      const index = packet[1] * 90 + packet[2] * 15 + packet[3];
      if (packet[0] === COMMAND.SET_KEY && !ignoreWrites) memory[index] = (packet[4] << 8) | packet[5];
      if (packet[0] === COMMAND.GET_KEY) { reply[4] = memory[index] >> 8; reply[5] = memory[index] & 255; }
    }
    target.emit(reply);
  });
  return { device, memory, macroMemory, lighting };
}

test('reads all six complete matrix layers without writing to the keyboard', async () => {
  const { device, memory } = memoryDevice();
  const keyboard = new Flow2Keyboard(device);
  const info = await keyboard.connect();
  assert.deepEqual(info, { protocol: 12, layerCount: 6 });
  const keymaps = await keyboard.readKeymaps();
  assert.equal(keymaps.length, 6);
  assert.deepEqual(keymaps.flat(), memory);
  assert.ok(device.sent.every((packet) => [1, 0x11, 0x12].includes(packet[0])));
  await keyboard.close();
});

test('writes only requested key positions and verifies the saved value', async () => {
  const { device, memory } = memoryDevice();
  const keyboard = new Flow2Keyboard(device);
  await keyboard.connect();
  const change = { layer: 2, row: 3, col: 0, before: memory[2 * 90 + 3 * 15], after: 0x29 };
  const applied = [];
  await keyboard.applyChanges([change], (value) => applied.push(value));
  assert.equal(memory[2 * 90 + 3 * 15], 0x29);
  assert.deepEqual(device.sent.slice(-2).map((packet) => packet[0]), [0x05, 0x04]);
  assert.deepEqual(applied, [change]);
  await keyboard.close();
});

test('does not report a write as saved when firmware ignores it', async () => {
  const { device, memory } = memoryDevice({ ignoreWrites: true });
  const keyboard = new Flow2Keyboard(device);
  await keyboard.connect();
  let applied = 0;
  await assert.rejects(keyboard.applyChanges([{ layer: 2, row: 3, col: 0, before: memory[225], after: 0x29 }], () => applied++), /未保存成功/);
  assert.equal(applied, 0);
  await keyboard.close();
});

test('rejects an unsupported protocol before any keymap write', async () => {
  const device = new FakeHid((_packet, target) => target.emit([1, 0, 13]));
  const keyboard = new Flow2Keyboard(device);
  await assert.rejects(keyboard.connect(), /协议 13/);
  assert.equal(device.opened, false);
  assert.equal(device.sent.length, 1);
});

test('preserves an external change instead of overwriting stale data', async () => {
  const { device, memory } = memoryDevice();
  const keyboard = new Flow2Keyboard(device);
  await keyboard.connect();
  const before = memory[0];
  memory[0] = 0x2a;
  await assert.rejects(keyboard.applyChanges([{ layer: 0, row: 0, col: 0, before, after: 0x29 }]), /其他配置操作/);
  assert.equal(memory[0], 0x2a);
  assert.ok(device.sent.every((packet) => packet[0] !== COMMAND.SET_KEY));
  await keyboard.close();
});

test('retains confirmed progress and stops writes after a connection loss', async () => {
  const { device, memory } = memoryDevice();
  const keyboard = new Flow2Keyboard(device, { timeoutMs: 15 });
  await keyboard.connect();
  const initialSecond = memory[1];
  const changes = [0, 1].map((col) => ({ layer: 0, row: 0, col, before: memory[col], after: 0x29 }));
  const applied = [];
  await assert.rejects(keyboard.applyChanges(changes, (change) => {
    applied.push(change);
    device.respond = undefined;
  }), /没有及时回应/);
  assert.equal(memory[0], 0x29);
  assert.equal(memory[1], initialSecond);
  assert.deepEqual(applied, [changes[0]]);
  await keyboard.close();
});

test('reads actual macro capacity and both stock lighting values without writes', async () => {
  const { device } = memoryDevice();
  const keyboard = new Flow2Keyboard(device);
  await keyboard.connect();
  assert.deepEqual(await keyboard.readCapabilities(), { macros: { count: 16, size: 2976 }, lighting: { brightness: 255, effect: 0 } });
  assert.equal((await keyboard.readMacros()).length, 2976);
  const last = device.sent.at(-1);
  assert.deepEqual(last.slice(0, 4), [COMMAND.GET_MACRO, 11, 152, 8]);
  assert.ok(device.sent.every((packet) => [1, 0x11, 0x0c, 0x0d, 0x0e, 8].includes(packet[0])));
  await keyboard.close();
});

test('an unsupported optional feature does not poison the keymap connection', async () => {
  const device = new FakeHid((packet, target) => target.emit(packet[0] === 0x0c ? [255] : packet));
  const transport = new ViaTransport(device);
  await transport.open();
  await assert.rejects(transport.request(0x0c), /不支持/);
  assert.equal((await transport.request(4, [0, 0, 0]))[0], 4);
  await transport.close();
});

test('macro transfer activates the buffer only after every byte has been read back', async () => {
  const { device, macroMemory } = memoryDevice();
  const keyboard = new Flow2Keyboard(device);
  await keyboard.connect();
  await keyboard.readCapabilities();
  const before = [...macroMemory];
  const after = [...before];
  after[0] = 65;
  await keyboard.applyMacros(before, after);
  assert.deepEqual(macroMemory, after);
  const writes = device.sent.filter((packet) => packet[0] === COMMAND.SET_MACRO);
  assert.deepEqual(writes[0].slice(1, 5), [11, 159, 1, 255]);
  assert.deepEqual(writes.at(-1).slice(1, 5), [11, 159, 1, 0]);
  const enabledAt = device.sent.findIndex((packet) => packet[0] === COMMAND.SET_MACRO && packet[1] === 11 && packet[2] === 159 && packet[4] === 0);
  assert.ok(device.sent.slice(enabledAt - 107, enabledAt).every((packet) => packet[0] === COMMAND.GET_MACRO));
  await keyboard.close();
});

test('a failed macro verification leaves invocation disabled and never reports success', async () => {
  const { device, macroMemory } = memoryDevice({ ignoreMacroWrites: true });
  const keyboard = new Flow2Keyboard(device);
  await keyboard.connect();
  await keyboard.readCapabilities();
  const before = [...macroMemory];
  const after = [...before];
  after[0] = 65;
  await assert.rejects(keyboard.applyMacros(before, after), /读回不一致/);
  assert.equal(macroMemory.at(-1), 255);
  assert.equal(macroMemory[0], 0);
  await keyboard.close();
});

test('backlight write is saved and read back, and ignored writes are reported', async () => {
  for (const ignoreWrites of [false, true]) {
    const { device, lighting } = memoryDevice({ ignoreWrites });
    const keyboard = new Flow2Keyboard(device);
    await keyboard.connect();
    const before = await keyboard.readLighting();
    const after = { brightness: 128, effect: 1 };
    if (ignoreWrites) await assert.rejects(keyboard.applyLighting(before, after), /未保存成功/);
    else { assert.deepEqual(await keyboard.applyLighting(before, after), { brightness: 127, effect: 1 }); assert.deepEqual(lighting, { brightness: 127, effect: 1 }); }
    assert.ok(device.sent.some((packet) => packet[0] === COMMAND.SAVE_LIGHT));
    await keyboard.close();
  }
});
