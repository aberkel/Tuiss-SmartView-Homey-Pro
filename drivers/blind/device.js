'use strict';
const Homey = require('homey');
const { isTuissName } = require('../../lib/protocol');
const {
  WRITE_UUID, NOTIFY_UUID, CONNECT, STOP,
  positionCommand, timestampCommand, parseMovement,
} = require('../../lib/protocol');

const normalize = uuid => String(uuid).replace(/-/g, '').toLowerCase();
const addressKey = address => String(address || '').replace(/[^0-9a-f]/gi, '').toLowerCase();

module.exports = class TuissBlind extends Homey.Device {
  async onInit() {
    this._peripheral = null;
    this._connecting = null;
    this._disconnectTimer = null;
    this._commandQueue = Promise.resolve();
    this._target = null;
    // Older versions marked a transient BLE failure as device-unavailable.
    // That blocks Homey from sending a later command that could reconnect it.
    await this.setAvailable();
    this.registerCapabilityListener('windowcoverings_set', value => this._acceptCommand(this._move(value)));
    this.registerCapabilityListener('windowcoverings_state', state => {
      return this._acceptCommand(state === 'idle' ? this._stop() : this._move(state === 'up' ? 1 : 0));
    });
  }

  _acceptCommand(pending) {
    // Homey times out a capability request before a slow BLE scan and handshake
    // can finish. The queued command keeps running after the listener returns.
    pending.catch(error => this.error(`BLE: command failed after retries: ${error.message}`));
  }

  async _connect() {
    if (this._peripheral?.isConnected) return this._peripheral;
    if (this._peripheral) await this._disconnect();
    if (this._connecting) return this._connecting;
    this._connecting = this._openConnection(true);
    try { return await this._connecting; }
    finally { this._connecting = null; }
  }

  async _openConnection(fresh = false) {
    this.log(`BLE: searching for motor (${fresh ? 'fresh scan' : 'cached lookup'})`);
    const uuid = this.getStore().peripheralUuid;
    // find() may return a cached advertisement after a motor goes to sleep.
    // On a retry, scan again and match the stable peripheral UUID or MAC.
    const advertisements = fresh ? await this.homey.ble.discover() : [];
    const id = this.getData().id;
    this.log(`BLE: scan returned ${advertisements.length} devices; stored UUID=${uuid}, paired address=${id}`);
    const candidates = advertisements.filter(ad => isTuissName(ad.localName));
    this.log(`BLE: recognizable Tuiss advertisements: ${candidates.map(ad => `${ad.localName} [uuid=${ad.uuid}, address=${ad.address}, connectable=${ad.connectable}]`).join('; ') || 'none'}`);
    const advertisement = advertisements.find(ad => normalize(ad.uuid) === normalize(uuid)
      || (addressKey(id) && addressKey(ad.address) === addressKey(id)))
      || await this.homey.ble.find(uuid);
    if (!advertisement) throw new Error('Motor niet gevonden via Bluetooth; controleer bereik en voeding');
    this.log(`BLE: selected advertisement uuid=${advertisement.uuid}, address=${advertisement.address}, connectable=${advertisement.connectable}`);
    const peripheral = await advertisement.connect();
    this.log('BLE: connected, discovering characteristics');
    this._peripheral = peripheral;
    peripheral.on('disconnect', () => {
      if (this._peripheral !== peripheral) return;
      this.log('BLE: motor disconnected; releasing Homey BLE connection');
      this._enqueue(() => {
        if (this._peripheral === peripheral) return this._disconnect();
      }).catch(err => this.error(`BLE: disconnect cleanup: ${err.message}`));
    });
    try {
      const services = await peripheral.discoverServices();
      let write, notify;
      for (const service of services) {
        const chars = await service.discoverCharacteristics();
        write ||= chars.find(char => normalize(char.uuid) === normalize(WRITE_UUID));
        notify ||= chars.find(char => normalize(char.uuid) === normalize(NOTIFY_UUID));
        if (write && notify) break;
      }
      if (!write || !notify) throw new Error('Bluetooth-protocol van deze motor wordt niet ondersteund');
      await notify.subscribeToNotifications(data => this._onNotification(data));
      await write.write(CONNECT);
      const timezone = await this.homey.clock.getTimezone();
      await write.write(timestampCommand(new Date(), timezone));
      this._write = write;
      this._notify = notify;
      this._scheduleDisconnect();
      this.log('BLE: handshake complete');
      if (advertisement.uuid !== uuid) {
        await this.setStoreValue('peripheralUuid', advertisement.uuid);
        this.log(`BLE: updated stored peripheral UUID to ${advertisement.uuid}`);
      }
      return peripheral;
    } catch (error) {
      this.error(`BLE: handshake failed: ${error.message}`);
      await this._disconnect().catch(err => this.error(`BLE: handshake cleanup: ${err.message}`));
      throw error;
    }
  }

  _scheduleDisconnect() {
    if (this._disconnectTimer) this.homey.clearTimeout(this._disconnectTimer);
    this._disconnectTimer = this.homey.setTimeout(() => {
      this._enqueue(() => this._disconnect()).catch(err => this.error(err));
    }, 8000);
  }

  async _disconnect() {
    if (this._disconnectTimer) this.homey.clearTimeout(this._disconnectTimer);
    this._disconnectTimer = null;
    const peripheral = this._peripheral;
    const notify = this._notify;
    this._peripheral = null;
    this._write = null;
    this._notify = null;
    this._target = null;
    if (peripheral) {
      if (notify && peripheral.isConnected) {
        await notify.unsubscribeFromNotifications().catch(err => this.error(`BLE: unsubscribe: ${err.message}`));
      }
      await peripheral.disconnect();
      this.log('BLE: disconnected and notification subscription removed');
    }
  }

  _enqueue(operation) {
    const pending = this._commandQueue.then(operation);
    this._commandQueue = pending.catch(() => {});
    return pending;
  }

  _enqueueReported(operation) {
    return this._enqueue(async () => {
      try {
        await operation();
        await this.setWarning(null).catch(err => this.error(`BLE: clear warning: ${err.message}`));
      } catch (error) {
        await this.setWarning(`Tuiss: ${error.message}`).catch(err => this.error(`BLE: show warning: ${err.message}`));
        throw error;
      }
    });
  }

  async _send(bytes) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        this.log(`BLE: command attempt ${attempt + 1}/3`);
        await this._connect();
        await this._write.write(bytes);
        this.log('BLE: command sent');
        this._scheduleDisconnect();
        await this.setAvailable().catch(err => this.error(`BLE: update availability: ${err.message}`));
        return;
      } catch (error) {
        await this._disconnect().catch(err => this.error(err));
        this.error(`Bluetooth attempt ${attempt + 1}/3: ${error.message}`);
        if (attempt < 2) {
          await new Promise(resolve => this.homey.setTimeout(resolve, 1500));
          continue;
        }
        // Keep the tile actionable so the next user command can reconnect.
        throw error;
      }
    }
  }

  _move(position) {
    return this._enqueueReported(async () => {
      await this._send(positionCommand(this._mapPosition(position)));
      this._target = position;
    });
  }

  _mapPosition(position) {
    return this.getSetting('invertDirection') === true ? 1 - position : position;
  }

  _stop() {
    return this._enqueueReported(async () => {
      await this._send(STOP);
      this._target = null;
      if (this._disconnectTimer) this.homey.clearTimeout(this._disconnectTimer);
      this._disconnectTimer = this.homey.setTimeout(() => {
        this._enqueue(() => this._disconnect()).catch(err => this.error(err));
      }, 5000);
    });
  }

  _onNotification(data) {
    const motorPosition = parseMovement(data);
    if (motorPosition === null) return;
    const position = this._mapPosition(motorPosition);
    this.setCapabilityValue('windowcoverings_set', position).catch(err => this.error(err));
    if (this._target !== null && Math.abs(this._target - position) <= 0.02) {
      this._target = null;
      this.setCapabilityValue('windowcoverings_state', 'idle').catch(err => this.error(err));
      if (this._disconnectTimer) this.homey.clearTimeout(this._disconnectTimer);
      this._disconnectTimer = this.homey.setTimeout(() => {
        this._enqueue(() => this._disconnect()).catch(err => this.error(err));
      }, 3000);
    }
  }

  async onSettings({ changedKeys }) {
    if (!changedKeys.includes('invertDirection')) return;
    const position = this.getCapabilityValue('windowcoverings_set');
    if (typeof position === 'number' && Number.isFinite(position)) {
      await this.setCapabilityValue('windowcoverings_set', 1 - position);
    }
    if (this._target !== null) this._target = 1 - this._target;
  }

  async onUninit() {
    await this._disconnect();
  }
};
