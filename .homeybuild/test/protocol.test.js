'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { positionCommand, timestampCommand, parseMovement, isTuissName } = require('../lib/protocol');

test('Tuiss command encodes both end positions and a middle position', () => {
  assert.equal(positionCommand(0).toString('hex'), 'ff78ea41bf03e803');
  assert.equal(positionCommand(1).toString('hex'), 'ff78ea41bf030000');
  assert.equal(positionCommand(0.5).toString('hex'), 'ff78ea41bf03f401');
  assert.throws(() => positionCommand(-0.1));
});

test('time uses Homey local time', () => {
  const time = new Date('2026-09-27T12:30:04Z');
  assert.equal(timestampCommand(time, 'Europe/Amsterdam').toString('hex'), 'ff78ea4102001a091b0e1e04');
});

test('movement response maps closed percentage to Homey openness', () => {
  assert.equal(parseMovement(Buffer.from([255, 120, 234, 65, 210, 0, 25, 0, 0])), 0.75);
  assert.equal(parseMovement(Buffer.from([0, 1])), null);
  assert.equal(parseMovement(Buffer.from([255, 120, 234, 65, 211, 0, 25, 0, 0])), null);
});

test('pair only known Tuiss motor advertisements', () => {
  assert.equal(isTuissName('TS5200'), true);
  assert.equal(isTuissName('TS2900'), true);
  assert.equal(isTuissName('MRM-G2'), true);
  assert.equal(isTuissName('Other Bluetooth Device'), false);
});
