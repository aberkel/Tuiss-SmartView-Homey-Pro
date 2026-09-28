'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'homey') return { Device: class {} };
  return load.call(this, request, parent, isMain);
};
const Blind = require('../drivers/blind/device');
Module._load = load;

test('a stale write gets a fresh BLE connection and retries the command', async () => {
  let writes = 0;
  let scans = 0;
  let disconnects = 0;
  let unavailable = 0;
  const device = new Blind();
  device.homey = { setTimeout: fn => { queueMicrotask(fn); return 1; } };
  device.error = () => {};
  device.log = () => {};
  device._connect = async () => {
    scans++;
    device._write = { write: async () => {
      writes++;
      if (writes === 1) throw new Error('NotConnected');
    } };
  };
  device._disconnect = async () => { disconnects++; };
  device._scheduleDisconnect = () => {};
  device.setAvailable = async () => {};
  device.setUnavailable = async () => { unavailable++; };

  await device._send(Buffer.from('ff', 'hex'));
  assert.equal(writes, 2);
  assert.equal(scans, 2);
  assert.equal(disconnects, 1);
  assert.equal(unavailable, 0);
});

test('a disconnected cached peripheral is discarded before connecting', async () => {
  const device = new Blind();
  device._peripheral = { isConnected: false };
  let discarded = false;
  device._disconnect = async () => { discarded = true; device._peripheral = null; };
  device._openConnection = async () => {
    assert.equal(discarded, true);
    return { isConnected: true };
  };
  assert.equal((await device._connect()).isConnected, true);
});

test('disconnect removes notifications before releasing BLE', async () => {
  const device = new Blind();
  const calls = [];
  device.homey = { clearTimeout: () => {} };
  device.log = () => {};
  device.error = () => {};
  device._notify = { unsubscribeFromNotifications: async () => { calls.push('unsubscribe'); } };
  device._peripheral = { isConnected: true, disconnect: async () => { calls.push('disconnect'); } };
  await device._disconnect();
  assert.deepEqual(calls, ['unsubscribe', 'disconnect']);
});

test('motor disconnect releases the Homey connection and next command connects again', async () => {
  const device = new Blind();
  let connected = 0;
  let released = 0;
  let disconnected;
  device.homey = {
    ble: {
      discover: async () => [{ uuid: 'motor', address: 'aa:bb', connect: async () => {
        connected++;
        return {
          isConnected: true,
          on: (_, handler) => { disconnected = handler; },
          discoverServices: async () => [{ discoverCharacteristics: async () => [
            { uuid: require('../lib/protocol').WRITE_UUID, write: async () => {} },
            { uuid: require('../lib/protocol').NOTIFY_UUID, subscribeToNotifications: async () => {}, unsubscribeFromNotifications: async () => {} },
          ] }],
          disconnect: async () => { released++; },
        };
      } }],
    },
    clock: { getTimezone: async () => 'Europe/Amsterdam' },
    setTimeout: () => 1,
    clearTimeout: () => {},
  };
  device.getStore = () => ({ peripheralUuid: 'motor' });
  device.getData = () => ({ id: 'aa:bb' });
  device.log = () => {};
  device.error = err => { throw err; };
  device.setAvailable = async () => {};
  device.setWarning = async () => {};
  device.getSetting = () => false;
  device.registerCapabilityListener = () => {};
  await device.onInit();
  await device._move(1);
  disconnected();
  await device._commandQueue;
  assert.equal(released, 1);
  assert.equal(device._peripheral, null);
  await device._move(0);
  assert.equal(connected, 2);
});

test('a changed peripheral UUID is refreshed when the paired MAC still matches', async () => {
  const device = new Blind();
  let updated;
  device.homey = {
    ble: {
      discover: async () => [{ uuid: 'new-uuid', address: 'AA:BB:CC', connectable: true,
        connect: async () => ({
          on: () => {},
          discoverServices: async () => [{ discoverCharacteristics: async () => [
            { uuid: require('../lib/protocol').WRITE_UUID, write: async () => {} },
            { uuid: require('../lib/protocol').NOTIFY_UUID, subscribeToNotifications: async () => {} },
          ] }],
        }),
      }],
      find: async () => { throw new Error('should use the matching MAC'); },
    },
    clock: { getTimezone: async () => 'Europe/Amsterdam' },
    setTimeout: () => 1,
  };
  device.getStore = () => ({ peripheralUuid: 'old-uuid' });
  device.getData = () => ({ id: 'aa-bb-cc' });
  device.setStoreValue = async (key, value) => { updated = [key, value]; };
  device.log = () => {};
  await device._openConnection(true);
  assert.deepEqual(updated, ['peripheralUuid', 'new-uuid']);
});

test('consecutive commands can reuse the active connection', async () => {
  const device = new Blind();
  let timerCount = 0;
  let disconnectCount = 0;
  let connectCount = 0;
  device.homey = {
    ble: { discover: async () => [{ uuid: 'motor', address: 'aa:bb', connect: async () => {
      connectCount++;
      return {
        isConnected: true,
        on: () => {},
        disconnect: async () => { disconnectCount++; },
        discoverServices: async () => [{ discoverCharacteristics: async () => [
          { uuid: require('../lib/protocol').WRITE_UUID, write: async () => {} },
          { uuid: require('../lib/protocol').NOTIFY_UUID, subscribeToNotifications: async () => {} },
        ] }],
      };
    } }] },
    clock: { getTimezone: async () => 'Europe/Amsterdam' },
    setTimeout: () => { timerCount++; return 1; },
    clearTimeout: () => {},
  };
  device.getStore = () => ({ peripheralUuid: 'motor' });
  device.getData = () => ({ id: 'aa:bb' });
  device.log = () => {};
  device.setAvailable = async () => {};
  device.setWarning = async () => {};
  device.getSetting = () => false;
  device.registerCapabilityListener = () => {};
  await device.onInit();
  await device._move(1);
  await device._move(0);
  assert.equal(connectCount, 1);
  assert.equal(disconnectCount, 0);
  assert.ok(timerCount > 0);
});

test('reverse direction flips commands, notifications and the displayed position', async () => {
  const device = new Blind();
  let inverted = false;
  const sent = [];
  const displayed = [];
  device._commandQueue = Promise.resolve();
  device._target = null;
  device.getSetting = () => inverted;
  device.setWarning = async () => {};
  device._send = async bytes => { sent.push(bytes.toString('hex')); };
  device.getCapabilityValue = () => 0.25;
  device.setCapabilityValue = async (key, value) => { displayed.push([key, value]); };
  await device._move(1);
  assert.equal(sent.pop(), 'ff78ea41bf030000');
  inverted = true;
  await device.onSettings({ changedKeys: ['invertDirection'] });
  assert.deepEqual(displayed.pop(), ['windowcoverings_set', 0.75]);
  await device._move(1);
  assert.equal(sent.pop(), 'ff78ea41bf03e803');
  await device._move(0.25);
  assert.equal(sent.pop(), 'ff78ea41bf03fa00');
  device._target = null;
  device._onNotification(Buffer.from([255, 120, 234, 65, 210, 0, 25, 0, 0]));
  assert.deepEqual(displayed.pop(), ['windowcoverings_set', 0.25]);
});

test('Homey receives an immediate acknowledgement while BLE is still connecting', async () => {
  const device = new Blind();
  let listener;
  let finishConnection;
  const warnings = [];
  device.setAvailable = async () => {};
  device.setWarning = async message => { warnings.push(message); };
  device.getSetting = () => false;
  device.registerCapabilityListener = (id, callback) => {
    if (id === 'windowcoverings_set') listener = callback;
  };
  device._send = () => new Promise(resolve => { finishConnection = resolve; });
  device.error = () => {};
  await device.onInit();
  assert.equal(listener(1), undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof finishConnection, 'function');
  assert.deepEqual(warnings, []);
  finishConnection();
  await device._commandQueue;
  assert.deepEqual(warnings, [null]);
});

test('only a final BLE failure shows a warning, and a later success clears it', async () => {
  const device = new Blind();
  let listener;
  const warnings = [];
  const errors = [];
  let fail = true;
  device.setAvailable = async () => {};
  device.setWarning = async message => { warnings.push(message); };
  device.getSetting = () => false;
  device.registerCapabilityListener = (id, callback) => {
    if (id === 'windowcoverings_set') listener = callback;
  };
  device._send = async () => { if (fail) throw new Error('Motor niet gevonden'); };
  device.error = message => { errors.push(message); };
  await device.onInit();
  assert.equal(listener(0), undefined);
  await device._commandQueue;
  assert.deepEqual(warnings, ['Tuiss: Motor niet gevonden']);
  fail = false;
  assert.equal(listener(1), undefined);
  await device._commandQueue;
  assert.deepEqual(warnings, ['Tuiss: Motor niet gevonden', null]);
  assert.ok(errors.some(message => String(message).includes('command failed')));
});
