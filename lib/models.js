'use strict';

function property(siid, piid) {
  return { siid, piid, did: `${siid}-${piid}` };
}

const fridgeTemperature = { role: 'fridge', name: 'Fridge', kind: 'temperature', property: property(3, 1) };
const freezerTemperature = { role: 'freezer', name: 'Freezer', kind: 'temperature', property: property(4, 1) };
const fridgeMode = {
  role: 'mode',
  name: 'Fridge Mode',
  kind: 'mode',
  property: property(2, 2),
  smart: 1,
  switches: [
    { subtype: 'quick-cool', name: 'Quick Cool', value: 2 },
    { subtype: 'quick-freeze', name: 'Quick Freeze', value: 3 },
  ],
};

const models = new Map([
  ['midjd.fridge.rs01s', {
    manufacturer: 'Mijia',
    accessories: [
      fridgeTemperature,
      freezerTemperature,
      { role: 'ifresh', name: 'iFresh', kind: 'temperature', property: property(6, 1) },
      fridgeMode,
      { role: 'door-reminder', name: 'Fridge Door', kind: 'contact', property: property(2, 3) },
    ],
  }],
  ['mibx5.fridge.rd01j2', {
    manufacturer: 'Mijia',
    accessories: [fridgeTemperature, freezerTemperature, fridgeMode],
  }],
]);

const informationProperties = {
  Manufacturer: property(1, 1),
  Model: property(1, 2),
  SerialNumber: property(1, 3),
  FirmwareRevision: property(1, 4),
  alternateSerial: property(1, 5),
};

module.exports = { models, informationProperties };
