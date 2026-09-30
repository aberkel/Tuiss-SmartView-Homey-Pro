'use strict';

// Adapted from pink88/Tuiss2HA (GPL-3.0), protocol.py and const.py.
const WRITE_UUID = '00010405-0405-0607-0809-0a0b0c0d1910';
const NOTIFY_UUID = '00010304-0405-0607-0809-0a0b0c0d1910';
const CONNECT = Buffer.from('ff03030303787878787878', 'hex');
const STOP = Buffer.from('ff78ea415f0301', 'hex');
// Adapted from Tuiss2HA limits.py. Both endpoints use the same SET opcode;
// the motor expects its native lower endpoint first, then its upper endpoint.
const LIMITS = Object.fromEntries(Object.entries({
  initialise: 'ff78ea41d10301', enter: 'ff78ea41210301',
  up: 'ff78ea41220301', down: 'ff78ea41230301', set: 'ff78ea41410301',
}).map(([key, hex]) => [key, Buffer.from(hex, 'hex')]));

function isTuissName(name) {
  return /^(?:TS(?:3000|5200|5300|2600|2900|5001|5101)|MRM-G2|MHC-G2)$/i.test(name || '');
}

function positionCommand(openFraction) {
  if (!Number.isFinite(openFraction) || openFraction < 0 || openFraction > 1) {
    throw new RangeError('Position must be between 0 (closed) and 1 (open)');
  }
  // Tuiss uses 0 = open, 1000 = closed; Homey uses 0 = closed, 1 = open.
  const closedTenths = Math.round((1 - openFraction) * 1000);
  return Buffer.from([0xff, 0x78, 0xea, 0x41, 0xbf, 0x03,
    closedTenths & 0xff, closedTenths >> 8]);
}

function timestampCommand(date, timezone = 'UTC') {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
  return Buffer.from([0xff, 0x78, 0xea, 0x41, 0x02, 0x00,
    Number(parts.year) - 2000, Number(parts.month), Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)]);
}

function parseMovement(data) {
  if (!data || data.length < 9 || data[4] !== 210 || data[6] > 100) return null;
  return (100 - data[6]) / 100;
}

module.exports = { WRITE_UUID, NOTIFY_UUID, CONNECT, STOP, LIMITS,
  isTuissName, positionCommand, timestampCommand, parseMovement };
