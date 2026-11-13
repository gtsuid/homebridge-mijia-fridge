'use strict';

const { isIPv4 } = require('node:net');
const { MiotClient } = require('./miot-client');
const { models } = require('./models');
const { Fridge, readInformation } = require('./fridge');
const { configureAccessory, updateAccessoryName, updateInformation } = require('./accessory');

const PACKAGE_NAME = require('../package.json').name;
const PLATFORM_NAME = 'MijiaFridge';
const REFRESH_INTERVAL = 10_000;

class FridgePlatform {
  constructor(log, config, api) {
    this.log = log;
    this.api = api;
    this.accessories = new Map();
    this.fridges = new Map();
    this.devices = [];
    this.invalidConfig = !Array.isArray(config?.devices);
    const addresses = new Set();

    if (this.invalidConfig) {
      log.error('Add a refrigerator in the Mijia Fridge platform settings.');
    }
    for (const [index, device] of (this.invalidConfig ? [] : config.devices).entries()) {
      if (typeof device?.ip !== 'string' || !isIPv4(device.ip) ||
          typeof device.token !== 'string' || !/^[A-Za-z0-9]{32}$/.test(device.token)) {
        log.error(`Refrigerator #${index + 1} requires a valid IPv4 address and a 32-character alphanumeric LAN token.`);
        this.invalidConfig = true;
        continue;
      }
      const modelId = device.model === undefined ? 'auto' : device.model;
      if (modelId !== 'auto' && !models.has(modelId)) {
        log.error(`Refrigerator #${index + 1} has an unsupported model setting. Select a supported model or Detect automatically.`);
        this.invalidConfig = true;
        continue;
      }
      if (addresses.has(device.ip)) {
        log.warn(`Ignoring duplicate refrigerator address ${device.ip}.`);
        continue;
      }
      addresses.add(device.ip);
      this.devices.push({ ip: device.ip, modelId, client: new MiotClient(device.ip, device.token) });
    }

    api.on('didFinishLaunching', () => {
      for (const device of this.devices) {
        void this.refresh(device);
      }
      this.removeUnusedAccessories();
    });
    api.on('shutdown', () => {
      this.stopped = true;
      for (const device of this.devices) {
        clearTimeout(device.timer);
      }
    });
  }

  configureAccessory(accessory) {
    const { deviceId, modelId, role, firmwareRevision } = accessory.context;
    const definition = models.get(modelId)?.accessories.find((item) => item.role === role);
    if (definition?.kind === 'mode' && accessory.displayName !== definition.name) {
      updateAccessoryName(this.api.hap, accessory, definition.name);
    }
    const update = definition && configureAccessory(
      this.api.hap,
      accessory,
      definition,
      () => this.fridges.get(deviceId),
    );
    if (definition && firmwareRevision) {
      updateInformation(this.api.hap, accessory, { FirmwareRevision: firmwareRevision });
    }
    this.accessories.set(accessory.UUID, { accessory, update });
  }

  accessoryUuid(deviceId, role) {
    return this.api.hap.uuid.generate(`${PACKAGE_NAME}:${deviceId}:${role}`);
  }

  async connect(device) {
    const info = await device.client.getInfo();
    if (typeof info?.model !== 'string' || !info.model) {
      throw new Error('Fridge did not report a model. Check the LAN connection.');
    }
    if (device.modelId !== 'auto' && device.modelId !== info.model) {
      throw new Error('The selected model does not match the fridge at this address. Check the IP address and model setting.');
    }
    const model = models.get(info.model);
    if (!model) {
      this.log.error(`Unsupported refrigerator at ${device.ip}. Check the supported model in the plugin settings.`);
      device.resolved = true;
      return;
    }

    const information = await readInformation(device.client, info, model.manufacturer);
    if (this.stopped) {
      return;
    }
    const deviceId = device.client.deviceId;
    if (this.fridges.has(deviceId)) {
      this.log.warn(`Refrigerator at ${device.ip} is already configured.`);
      device.resolved = true;
      return;
    }
    const fridge = new Fridge(device.client, model.accessories, (definition, value) => {
      const uuid = this.accessoryUuid(deviceId, definition.role);
      this.accessories.get(uuid)?.update?.(value);
    });
    const created = [];
    const restored = [];
    for (const definition of model.accessories) {
      const uuid = this.accessoryUuid(deviceId, definition.role);
      const cached = this.accessories.get(uuid)?.accessory;
      const { name } = definition;
      const accessory = cached ?? new this.api.platformAccessory(name, uuid);
      const nameChanged = accessory.displayName !== name;
      if (nameChanged) {
        updateAccessoryName(this.api.hap, accessory, name);
      }
      const cachedFirmware = cached?.context.modelId === info.model ? cached.context.firmwareRevision : undefined;
      accessory.context = {
        deviceId,
        modelId: info.model,
        role: definition.role,
        firmwareRevision: information.FirmwareRevision ?? cachedFirmware,
      };
      if (!cached || nameChanged || !this.accessories.get(uuid).update) {
        this.configureAccessory(accessory);
      }
      updateInformation(this.api.hap, accessory, information);
      (cached ? restored : created).push(accessory);
    }
    if (created.length) {
      this.api.registerPlatformAccessories(PACKAGE_NAME, PLATFORM_NAME, created);
    }
    if (restored.length) {
      this.api.updatePlatformAccessories(restored);
    }
    this.fridges.set(deviceId, fridge);
    device.fridge = fridge;
    device.resolved = true;
  }

  removeUnusedAccessories() {
    if (this.invalidConfig || this.devices.some((device) => !device.resolved)) {
      return;
    }
    const stale = [...this.accessories.values()].map(({ accessory }) => accessory).filter((accessory) => {
      const { deviceId, role } = accessory.context;
      return !this.fridges.get(deviceId)?.model.some((definition) => definition.role === role);
    });
    if (stale.length) {
      this.api.unregisterPlatformAccessories(PACKAGE_NAME, PLATFORM_NAME, stale);
      for (const accessory of stale) {
        this.accessories.delete(accessory.UUID);
      }
    }
  }

  async refresh(device) {
    try {
      if (!device.resolved) {
        await this.connect(device);
        if (this.stopped) {
          return;
        }
        this.removeUnusedAccessories();
      }
      await device.fridge?.refresh();
      device.lastError = undefined;
    } catch (error) {
      if (!this.stopped && device.lastError !== error.message) {
        device.lastError = error.message;
        this.log.warn(`Refrigerator at ${device.ip}: ${error.message}`);
      }
    } finally {
      if (!this.stopped && (!device.resolved || device.fridge)) {
        device.timer = setTimeout(() => void this.refresh(device), REFRESH_INTERVAL);
      }
    }
  }
}

module.exports = { FridgePlatform, PACKAGE_NAME, PLATFORM_NAME };
