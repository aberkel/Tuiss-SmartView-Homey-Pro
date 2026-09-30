'use strict';
const Homey = require('homey');
const { isTuissName } = require('../../lib/protocol');

module.exports = class TuissDriver extends Homey.Driver {
  onRepair(session, device) {
    const owner = { phase: 'ready', busy: false, error: null };
    session.setHandler('limits_status', () => ({ ...owner,
      inverted: device.getSetting('invertDirection') === true }));
    session.setHandler('limits_action', action => device.requestLimits(owner, action));
    session.setHandler('disconnect', () => device.closeLimits(owner));
  }

  async onPairListDevices() {
    const advertisements = await this.homey.ble.discover();
    const seen = new Set();
    const connectable = advertisements.filter(ad => ad.connectable);
    const recognized = connectable.filter(ad => isTuissName(ad.localName));
    // Some Gen 2 motors advertise with an unknown BLE name. If no known name
    // is visible, allow pairing by the MAC address printed on the blind label.
    return (recognized.length ? recognized : connectable)
      .filter(ad => {
        const id = ad.address || ad.uuid;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .map(ad => ({
        name: `${isTuissName(ad.localName) ? 'Tuiss' : 'Bluetooth: controleer adres'} ${ad.localName || 'onbekend'} (${ad.address || ad.uuid})`,
        data: { id: ad.address || ad.uuid },
        store: { peripheralUuid: ad.uuid },
      }));
  }
};
