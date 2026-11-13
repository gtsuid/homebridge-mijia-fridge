'use strict';

function configureAccessory(hap, accessory, definition, getFridge) {
  const { Characteristic, Service } = hap;
  const communicationFailure = () => new hap.HapStatusError(hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

  function bind(serviceType, characteristicType, name, subtype, mapReading) {
    const service = accessory.getServiceById(serviceType, subtype) ??
      accessory.addService(serviceType, name, subtype);
    if (service.displayName !== name) {
      service.displayName = name;
      service.setCharacteristic(Characteristic.Name, name);
    }
    const characteristic = service.getCharacteristic(characteristicType);
    characteristic.onGet(() => {
      const reading = getFridge()?.readings.get(definition.role);
      const value = mapReading(reading);
      if (value === undefined) {
        throw communicationFailure();
      }
      return value;
    });
    return {
      service,
      characteristic,
      update(reading) {
        const value = mapReading(reading);
        if (value !== undefined) {
          characteristic.updateValue(value);
        }
      },
    };
  }

  if (definition.kind === 'mode') {
    const switches = definition.switches.map(({ name, subtype, value }) => {
      const binding = bind(Service.Switch, Characteristic.On, name, subtype, (reading) => {
        if (Number.isInteger(reading)) {
          return reading === value;
        }
      });
      binding.service.setCharacteristic(Characteristic.Name, name);
      if (!binding.service.testCharacteristic(Characteristic.ConfiguredName)) {
        binding.service.addOptionalCharacteristic(Characteristic.ConfiguredName);
        binding.service.setCharacteristic(Characteristic.ConfiguredName, name);
      }
      binding.characteristic.onSet(async (enabled) => {
        const fridge = getFridge();
        if (!fridge) {
          throw communicationFailure();
        }
        try {
          await fridge.setMode(definition, value, enabled);
        } catch {
          throw communicationFailure();
        }
      });
      return binding;
    });
    switches[0].service.setPrimaryService(true);
    return (reading) => switches.forEach(({ update }) => update(reading));
  }

  if (definition.kind === 'contact') {
    const state = Characteristic.ContactSensorState;
    if (accessory.displayName === 'Door Reminder') {
      updateAccessoryName(hap, accessory, definition.name);
    }
    const binding = bind(Service.ContactSensor, state, accessory.displayName, definition.role, (reading) => {
      if (reading === 0 || reading === 1) {
        return reading === 0 ? state.CONTACT_DETECTED : state.CONTACT_NOT_DETECTED;
      }
    });
    return binding.update;
  }

  const binding = bind(
    Service.TemperatureSensor,
    Characteristic.CurrentTemperature,
    accessory.displayName,
    definition.role,
    (reading) => Number.isFinite(reading) ? reading : undefined,
  );
  binding.characteristic.setProps({ minValue: -50, maxValue: 100 });
  return binding.update;
}

function updateAccessoryName(hap, accessory, name) {
  accessory.updateDisplayName(name);
  accessory.getService(hap.Service.AccessoryInformation).setCharacteristic(hap.Characteristic.Name, name);
}

function updateInformation(hap, accessory, information) {
  const service = accessory.getService(hap.Service.AccessoryInformation);
  for (const [name, value] of Object.entries(information)) {
    if (value !== undefined) {
      service.setCharacteristic(hap.Characteristic[name], value);
    }
  }
}

module.exports = { configureAccessory, updateAccessoryName, updateInformation };
