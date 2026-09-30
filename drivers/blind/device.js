'use strict';
const Homey = require('homey');
const { isTuissName } = require('../../lib/protocol');
const limitControls = require('../../lib/limit-controls');
const {
  WRITE_UUID, NOTIFY_UUID, CONNECT, STOP, LIMITS,
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
    this._limits = null;
    this._limitsTimer = null;
    this._maintenanceOwner = null;
    this._limitsUiQueue = Promise.resolve();
    this._limitsIncomplete = this.getStore?.().limitsIncomplete === true;
    // Older versions marked a transient BLE failure as device-unavailable.
    // That blocks Homey from sending a later command that could reconnect it.
    await this.setAvailable();
    if (this._limitsIncomplete) await this.setWarning('Tuiss: finish setting both motor limits using Set limits or the Tuiss app');
    this.registerCapabilityListener('windowcoverings_set', value => this._acceptCommand(this._move(value)));
    this.registerCapabilityListener('windowcoverings_state', state => {
      return this._acceptCommand(state === 'idle' ? this._stop() : this._move(state === 'up' ? 1 : 0));
    });
    await this._initLimitControls();
  }

  async _initLimitControls() {
    // Adding only missing capabilities preserves paired IDs, settings and Flows.
    for (const control of limitControls.controls) {
      if (!this.hasCapability(control.id)) await this.addCapability(control.id);
      await this._applyLimitControlOptions(control.id, limitControls.options(control));
      this.registerCapabilityListener(control.id, () => this._maintenanceLimits(control.action));
    }
    await this._publishLimitControls();
  }

  _maintenanceLimits(action) {
    if (action === 'start') {
      if (this._limits) throw new Error('Limit setup is already active. Complete it or press Stop setup.');
      this._maintenanceOwner = { phase: 'ready', busy: false, error: null };
      this.requestLimits(this._maintenanceOwner, action);
    } else {
      const owner = this._maintenanceOwner;
      if (!owner || this._limits !== owner) throw new Error('Start Set limits first. If using Repair, finish setup in that screen.');
      if (action === 'close') {
        // Cancellation also works during discovery or a pending write.
        this.closeLimits(owner).catch(err => this.error(`BLE: stop setup: ${err.message}`));
      } else {
        this.requestLimits(owner, action);
      }
    }
    // Return immediately, like normal control: BLE discovery can exceed 10s.
  }

  _publishLimitControls() {
    this._limitsUiQueue = this._limitsUiQueue.then(async () => {
      const owner = this._limits || this._maintenanceOwner;
      const description = limitControls.progress(owner, this._limitsIncomplete);
      const start = limitControls.options(limitControls.controls[0]);
      if (description) start.desc = { en: description, nl: description };
      const save = limitControls.options(limitControls.controls.find(control => control.action === 'save'));
      if (owner && ['lower', 'upper'].includes(owner.phase)) {
        const title = (owner.phase === 'lower') !== owner.inverted ? 'Save lower limit' : 'Save upper limit';
        save.title = { en: title, nl: title };
        save.desc = { en: description, nl: description };
      }
      await this._applyLimitControlOptions('button.limits_start', start);
      await this._applyLimitControlOptions('button.limits_save', save);
    }).catch(err => this.error(`Homey: update limit controls: ${err.message}`));
    return this._limitsUiQueue;
  }

  async _applyLimitControlOptions(id, options) {
    const current = this.getCapabilityOptions(id) || {};
    if (Object.entries(options).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value))) return;
    await this.setCapabilityOptions(id, options);
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
        if (this._limits) return this._finishLimits(this._limits, false, 'Bluetooth disconnected. Set both limits again.');
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
    this._disconnectTimer = null;
    if (this._limits) return;
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
        if (!this._limitsIncomplete) await this.setWarning(null).catch(err => this.error(`BLE: clear warning: ${err.message}`));
      } catch (error) {
        await this.setWarning(`Tuiss: ${error.message}`).catch(err => this.error(`BLE: show warning: ${err.message}`));
        throw error;
      }
    });
  }

  async _send(bytes) {
    if (this._limits) throw new Error('Motor limits are being configured; finish or close the setup first');
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
    if (this._limits) return;
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
    if (this._limits) throw new Error('Finish motor limit setup before changing direction');
    const position = this.getCapabilityValue('windowcoverings_set');
    if (typeof position === 'number' && Number.isFinite(position)) {
      await this.setCapabilityValue('windowcoverings_set', 1 - position);
    }
    if (this._target !== null) this._target = 1 - this._target;
  }

  async onUninit() {
    if (this._limits) await this.closeLimits(this._limits);
    await this._disconnect();
  }

  // Custom repair requests return immediately; polling shows progress even if
  // discovery takes longer than Homey's request timeout. Calibration writes
  // are never retried: repeating SET could save the wrong endpoint.
  requestLimits(owner, action) {
    if (owner.busy) throw new Error('Wait for the current operation to finish');
    if (!['start', 'up', 'down', 'stop', 'save', 'close'].includes(action)) throw new Error('Unknown action');
    if (action === 'start') {
      if (this._limits || owner.phase !== 'ready') throw new Error('Setup already started');
      this._limits = owner;
      owner.phase = 'connecting';
      owner.inverted = this.getSetting('invertDirection') === true;
      this._target = null;
      this._scheduleDisconnect();
    } else if (this._limits !== owner || !['lower', 'upper'].includes(owner.phase)) {
      throw new Error('Start a new setup session first');
    }
    owner.busy = true;
    this._publishLimitControls();
    this._enqueue(async () => {
      try {
        if (action === 'start') {
          await this._connect();
          if (owner.closed) throw new Error('Setup closed before calibration started');
          // Persist before the first calibration write, including an uncertain
          // write failure or an app restart midway through configuration.
          await this.setStoreValue('limitsIncomplete', true);
          this._limitsIncomplete = true;
          await this._limitsWrite(owner, LIMITS.initialise);
          await this._limitsWrite(owner, LIMITS.enter);
          owner.phase = 'lower';
        } else if (action === 'close') {
          await this._finishLimits(owner, false);
        } else if (action === 'save') {
          await this._limitsWrite(owner, STOP);
          await this._limitsWrite(owner, LIMITS.set);
          if (owner.phase === 'lower') owner.phase = 'upper';
          else {
            await this.setStoreValue('limitsIncomplete', false);
            this._limitsIncomplete = false;
            await this.setWarning(null);
            await this._finishLimits(owner, true);
          }
        } else {
          const direction = owner.inverted && action !== 'stop'
            ? (action === 'up' ? 'down' : 'up') : action;
          await this._limitsWrite(owner, direction === 'stop' ? STOP : LIMITS[direction]);
        }
        if (this._limits === owner) this._refreshLimitsTimer(owner);
      } catch (error) {
        this.error(`BLE: motor limit setup: ${error.message}`);
        await this._finishLimits(owner, false, error.message).catch(err => this.error(err));
      } finally {
        owner.busy = false;
        await this._publishLimitControls();
      }
    }).catch(err => this.error(err));
    return { ...owner };
  }

  async _limitsWrite(owner, bytes) {
    if (owner.closed || this._limits !== owner || !this._peripheral?.isConnected || !this._write) {
      throw new Error('Bluetooth disconnected. Set both limits again.');
    }
    await this._write.write(bytes);
  }

  _refreshLimitsTimer(owner) {
    if (this._limitsTimer) this.homey.clearTimeout(this._limitsTimer);
    this._limitsTimer = this.homey.setTimeout(() => {
      this._enqueue(() => this._finishLimits(owner, false, 'Setup timed out after 3 minutes of inactivity.'))
        .catch(err => this.error(err));
    }, 180000);
  }

  closeLimits(owner) {
    owner.closed = true;
    return this._enqueue(() => this._finishLimits(owner, false));
  }

  async _finishLimits(owner, complete, error) {
    if (this._limits !== owner) return;
    if (this._limitsTimer) this.homey.clearTimeout(this._limitsTimer);
    this._limitsTimer = null;
    owner.phase = complete ? 'done' : 'failed';
    owner.error = error || (complete ? null : 'Setup closed. Set both limits again before using the blind.');
    if (!complete && this._peripheral?.isConnected && this._write) {
      await this._write.write(STOP).catch(err => this.error(`BLE: calibration stop: ${err.message}`));
    }
    this._limits = null;
    if (this._limitsIncomplete) {
      await this.setWarning('Tuiss: finish setting both motor limits using Set limits or the Tuiss app')
        .catch(err => this.error(err));
    } else if (!complete && error) {
      await this.setWarning(`Tuiss: ${error}`).catch(err => this.error(err));
    }
    await this._disconnect();
    await this._publishLimitControls();
  }
};
