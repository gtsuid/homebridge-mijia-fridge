'use strict';

const { informationProperties } = require('./models');

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim();
}

function firmwareValue(value) {
  const version = firstString(value);
  return version && !/^0+(\.0+)*$/.test(version) ? version : undefined;
}

async function readInformation(client, info, defaultManufacturer) {
  const read = (properties) => client.readProperties(properties).catch(() => new Map());
  const values = await read(Object.values(informationProperties));
  const get = (name) => values.get(informationProperties[name].did);

  // Some firmware omits device information from a batch read.
  async function readOne(name) {
    const property = informationProperties[name];
    return firstString((await read([property])).get(property.did));
  }

  const manufacturer = firstString(get('Manufacturer'), info.manufacturer)
    ?? await readOne('Manufacturer');
  const serialNumber = firstString(
    get('SerialNumber'), get('alternateSerial'),
    info.serial_number, info.serial_no, info.serial, info.sn,
  ) ?? await readOne('SerialNumber') ?? await readOne('alternateSerial');

  const firmwareRevision = firmwareValue(get('FirmwareRevision'))
    ?? firmwareValue(await readOne('FirmwareRevision'))
    ?? firmwareValue(info.fw_ver)
    ?? firmwareValue(info.firmware_revision);

  return {
    Manufacturer: manufacturer ?? defaultManufacturer,
    Model: firstString(get('Model'), info.model),
    SerialNumber: serialNumber ?? `MI-${client.deviceId}`,
    FirmwareRevision: firmwareRevision,
  };
}

class Fridge {
  constructor(client, model, onReading) {
    this.client = client;
    this.model = model;
    this.onReading = onReading;
    this.readings = new Map();
    this.pending = Promise.resolve();
  }

  enqueue(operation) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  applyReading(definition, value) {
    this.readings.set(definition.role, value);
    this.onReading(definition, value);
  }

  refresh() {
    return this.enqueue(async () => {
      let values;
      try {
        values = await this.client.readProperties(this.model.map(({ property }) => property));
      } catch (error) {
        this.readings.clear();
        throw error;
      }
      for (const definition of this.model) {
        this.applyReading(definition, values.get(definition.property.did));
      }
    });
  }

  async refreshMode(definition) {
    let value;
    try {
      const values = await this.client.readProperties([definition.property]);
      value = values.get(definition.property.did);
      if (!Number.isInteger(value)) {
        throw new Error('Fridge did not report its mode.');
      }
      return value;
    } finally {
      this.applyReading(definition, value);
    }
  }

  setMode(definition, mode, enabled) {
    return this.enqueue(async () => {
      try {
        const current = await this.refreshMode(definition);
        const desired = enabled ? mode : current === mode ? definition.smart : current;
        if (desired !== current) {
          await this.client.writeProperty(definition.property, desired);
          const confirmed = await this.refreshMode(definition);
          if (confirmed !== desired) {
            throw new Error('Fridge did not confirm the requested mode.');
          }
        }
      } catch (error) {
        await this.refreshMode(definition).catch(() => {});
        throw error;
      }
    });
  }
}

module.exports = { Fridge, readInformation };
