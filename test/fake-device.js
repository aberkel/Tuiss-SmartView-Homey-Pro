'use strict';
// Minimal Homey device state for exercising upgrades and maintenance UI options.
module.exports = class FakeDevice {
  constructor() {
    this.capabilities = new Set(['windowcoverings_set', 'windowcoverings_state']);
    this.options = new Map();
    this.addedCapabilities = [];
  }
  hasCapability(id) { return this.capabilities.has(id); }
  async addCapability(id) { this.capabilities.add(id); this.addedCapabilities.push(id); }
  getCapabilityOptions(id) { return this.options.get(id); }
  async setCapabilityOptions(id, options) { this.options.set(id, structuredClone(options)); }
};
