'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'homey') return { Device: require('./fake-device') };
  return load.call(this, request, parent, isMain);
};
const Blind = require('../drivers/blind/device');
Module._load = load;

function fixture(inverted = false) {
  const device = new Blind();
  const writes = [], warnings = [], timers = [], store = {};
  let connections = 0;
  device.homey = {
    setTimeout: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; },
    clearTimeout: () => {},
  };
  device.log = device.error = () => {};
  device.getStore = () => store;
  device.setStoreValue = async (key, value) => { store[key] = value; };
  device.setWarning = async message => { warnings.push(message); };
  device.setAvailable = async () => {};
  device.getSetting = () => inverted;
  const listeners = new Map();
  device.registerCapabilityListener = (id, fn) => { listeners.set(id, fn); };
  device._connect = async () => {
    connections++;
    device._peripheral = { isConnected: true, disconnect: async () => {} };
    device._write = { write: async bytes => { writes.push(bytes.toString('hex')); } };
    device._scheduleDisconnect();
  };
  const owner = { phase: 'ready', busy: false, error: null };
  const act = async action => {
    device.requestLimits(owner, action);
    await device._commandQueue;
  };
  return { device, owner, writes, warnings, timers, store, act, listeners, connections: () => connections };
}

test('calibration stays connected and saves native lower then upper exactly once each', async () => {
  const f = fixture();
  await f.device.onInit();
  await f.act('start');
  assert.equal(f.owner.phase, 'lower');
  assert.equal(f.store.limitsIncomplete, true);
  assert.equal(f.timers.some(timer => timer.delay === 8000), false);
  await f.act('down');
  await f.act('save');
  assert.equal(f.owner.phase, 'upper');
  await f.act('up');
  await f.act('save');
  assert.deepEqual(f.writes, [
    'ff78ea41d10301', 'ff78ea41210301', 'ff78ea41230301',
    'ff78ea415f0301', 'ff78ea41410301', 'ff78ea41220301',
    'ff78ea415f0301', 'ff78ea41410301',
  ]);
  assert.equal(f.connections(), 1);
  assert.equal(f.owner.phase, 'done');
  assert.equal(f.store.limitsIncomplete, false);
  assert.equal(f.device._peripheral, null);
});

test('reverse direction swaps jog commands and normal control cannot interleave', async () => {
  const f = fixture(true);
  await f.device.onInit();
  await f.act('start');
  await f.act('up');
  assert.equal(f.writes.at(-1), 'ff78ea41230301');
  const before = f.writes.length;
  await assert.rejects(f.device._move(1), /limits are being configured/);
  assert.equal(f.writes.length, before);
  await assert.rejects(f.device.onSettings({ changedKeys: ['invertDirection'] }), /Finish motor limit setup/);
  await f.device.closeLimits(f.owner);
});

test('an uncertain save is not retried or followed by another save', async () => {
  const f = fixture();
  await f.device.onInit();
  await f.act('start');
  let saves = 0;
  f.device._write.write = async bytes => {
    if (bytes.toString('hex') === 'ff78ea41410301') {
      saves++;
      throw new Error('write timeout');
    }
  };
  await f.act('save');
  assert.equal(saves, 1);
  assert.equal(f.connections(), 1);
  assert.equal(f.owner.phase, 'failed');
  assert.match(f.owner.error, /timeout/);
  assert.equal(f.store.limitsIncomplete, true);
  assert.ok(f.warnings.at(-1).includes('both motor limits'));
  assert.throws(() => f.device.requestLimits(f.owner, 'save'), /new setup/);
});

test('closing while discovery is pending never starts calibration', async () => {
  const f = fixture();
  await f.device.onInit();
  let resolveConnection;
  const connect = f.device._connect;
  f.device._connect = () => new Promise(resolve => { resolveConnection = async () => { await connect(); resolve(); }; });
  f.device.requestLimits(f.owner, 'start');
  await new Promise(resolve => setImmediate(resolve));
  const closing = f.device.closeLimits(f.owner);
  await resolveConnection();
  await closing;
  assert.equal(f.writes.includes('ff78ea41d10301'), false);
  assert.equal(f.store.limitsIncomplete, undefined);
  assert.equal(f.owner.phase, 'failed');
});

test('connection loss and inactivity stop setup without saving an endpoint', async () => {
  for (const cause of ['disconnect', 'idle']) {
    const f = fixture();
    await f.device.onInit();
    await f.act('start');
    if (cause === 'disconnect') {
      f.device._peripheral.isConnected = false;
      await f.act('save');
    } else {
      f.timers.at(-1).fn();
      await f.device._commandQueue;
    }
    assert.equal(f.owner.phase, 'failed');
    assert.equal(f.writes.includes('ff78ea41410301'), false);
    assert.equal(f.store.limitsIncomplete, true);
    assert.equal(f.device._limits, null);
  }
});

test('existing devices gain maintenance buttons without removing their controls; upgrade is idempotent', async () => {
  const f = fixture();
  await f.device.onInit();
  const expected = require('../lib/limit-controls').controls.map(control => control.id);
  assert.deepEqual(f.device.addedCapabilities, expected);
  assert.ok(f.device.hasCapability('windowcoverings_set'));
  assert.ok(f.device.hasCapability('windowcoverings_state'));
  for (const id of expected) {
    assert.equal(f.device.getCapabilityOptions(id).maintenanceAction, true);
    assert.equal(typeof f.listeners.get(id), 'function');
  }
  await f.device.onInit();
  assert.deepEqual(f.device.addedCapabilities, expected);
  assert.deepEqual(f.writes, []);
});

test('maintenance controls configure both limits and publish the current endpoint', async () => {
  for (const inverted of [false, true]) {
    const f = fixture(inverted);
    await f.device.onInit();
    assert.throws(() => f.listeners.get('button.limits_save')(), /Start Set limits/);
    assert.equal(f.listeners.get('button.limits_start')(), undefined);
    assert.throws(() => f.listeners.get('button.limits_start')(), /already active/);
    await f.device._commandQueue;
    assert.equal(f.device.getCapabilityOptions('button.limits_save').title.en,
      inverted ? 'Save upper limit' : 'Save lower limit');
    assert.match(f.device.getCapabilityOptions('button.limits_start').desc.en, /Step 1 of 2/);
    f.listeners.get('button.limits_down')();
    await f.device._commandQueue;
    f.listeners.get('button.limits_save')();
    await f.device._commandQueue;
    assert.equal(f.device.getCapabilityOptions('button.limits_save').title.en,
      inverted ? 'Save lower limit' : 'Save upper limit');
    assert.match(f.device.getCapabilityOptions('button.limits_start').desc.en, /Step 2 of 2/);
    f.listeners.get('button.limits_up')();
    await f.device._commandQueue;
    f.listeners.get('button.limits_save')();
    await f.device._commandQueue;
    assert.equal(f.device._maintenanceOwner.phase, 'done');
    assert.match(f.device.getCapabilityOptions('button.limits_start').desc.en, /Both limit commands were sent/);
    assert.equal(f.writes.filter(hex => hex === 'ff78ea41410301').length, 2);
    assert.equal(f.device.getCapabilityOptions('button.limits_save').title.en, 'Save limit');
  }
});

test('maintenance Stop setup cancels a slow connect without timeout or calibration writes', async () => {
  const f = fixture();
  await f.device.onInit();
  let release;
  const connect = f.device._connect;
  f.device._connect = () => new Promise(resolve => {
    release = async () => { await connect(); resolve(); };
  });
  assert.equal(f.listeners.get('button.limits_start')(), undefined);
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => f.listeners.get('button.limits_save')(), /Wait/);
  assert.equal(f.listeners.get('button.limits_end')(), undefined);
  assert.equal(f.device._maintenanceOwner.closed, true);
  await release();
  await f.device._commandQueue;
  assert.equal(f.device._maintenanceOwner.phase, 'failed');
  assert.equal(f.writes.includes('ff78ea41d10301'), false);
  assert.equal(f.device._peripheral, null);
});

test('maintenance actions cannot take over a repair-owned session', async () => {
  const f = fixture();
  await f.device.onInit();
  await f.act('start');
  const before = f.writes.length;
  for (const id of ['button.limits_start', 'button.limits_save', 'button.limits_up', 'button.limits_end']) {
    assert.throws(() => f.listeners.get(id)());
  }
  assert.equal(f.writes.length, before);
  await f.device.closeLimits(f.owner);
});

test('motor disconnect updates maintenance instructions and permits a new setup', async () => {
  const f = fixture();
  await f.device.onInit();
  f.listeners.get('button.limits_start')();
  await f.device._commandQueue;
  const oldOwner = f.device._maintenanceOwner;
  f.device._peripheral.isConnected = false;
  f.listeners.get('button.limits_save')();
  await f.device._commandQueue;
  assert.equal(oldOwner.phase, 'failed');
  assert.match(f.device.getCapabilityOptions('button.limits_start').desc.en, /Configure both endpoints again/);
  assert.equal(f.writes.filter(hex => hex === 'ff78ea41410301').length, 0);
  f.listeners.get('button.limits_start')();
  await f.device._commandQueue;
  assert.notEqual(f.device._maintenanceOwner, oldOwner);
  assert.equal(f.device._maintenanceOwner.phase, 'lower');
  await f.device.closeLimits(f.device._maintenanceOwner);
});
