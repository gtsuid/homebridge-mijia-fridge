# homebridge-mijia-fridge

Homebridge plugin for Xiaomi/Mijia Smart Refrigerator.

Apple HomeKit currently does not support refrigerators as native accessories, so this plugin uses existing accessory types as a workaround.

While the Xiaomi Home app supports individual compartment temperature control, cooling mode presets, and door-open alerts, this plugin exposes only temperature readings, cooling modes as switches, and door status as a contact sensor.

HomeKit's ``HeaterCooler`` accessory could enable temperature control, but it includes an ``OFF`` state that does not apply to Mijia refrigerators, which are always on. Using it would introduce unnecessary complexity and UX inconsistencies.

For now, the plugin keeps this simplified approach until Apple introduces native refrigerator support in HomeKit.

## Supported Devices
| No | Product | Model | Exposed Accessories |
| :-: | :-: | :- | :- |
| 1 | Mijia Refrigerator Cross Door 510L/502L/451L | ``midjd.fridge.rs01s`` | 3 temperature sensors, 2 cooling mode switches, door sensor |
| 2 | Mijia Refrigerator Side-by-Side 635L | ``mibx5.fridge.rd01j2`` | 2 temperature sensors, 2 cooling mode switches, door sensor |

**Note**: I only own and have tested the 510L model. Other models remain untested. If you encounter any bugs, please report them via **[issues](https://github.com/gtsuid/homebridge-mijia-fridge/issues)**.

## Prerequisites
1. Install Homebridge 2.x.x, please follow it's [README](https://github.com/homebridge/homebridge#readme).
2. Get the fridge's 32 digits LAN token.

## Configuration
You can config the plugin via Homebridge UI or manually edit the ``JSON Config``.

| No | Key | Expected value (with example) | Note |
| :-: | --- | --- | --- |
| 1 | `platform` | Platform identifier, `"MijiaFridge"` | Mandatory |
| 2 | `devices` | Array of refrigerator objects. For example, `[{"ip":"192.168.1.110","token":"0123456789abcdef0123456789abcdef"}]` | Mandatory |
| 3 | `devices[].ip` | Refrigerator's LAN IPv4 address. For example, `"192.168.1.110"`. | Mandatory |
| 4 | `devices[].token` | Refrigerator's 32-character alphanumeric LAN token. For example, `"0123456789abcdef0123456789abcdef"`. | Mandatory |
| 5 | `devices[].name` | Label shown in Homebridge settings. For example, `"Kitchen Fridge"`. | Optional |
| 6 | `devices[].model` | `"auto"` for automatic detection, `"midjd.fridge.rs01s"` for Cross Door 510L/502L/451L, or `"mibx5.fridge.rd01j2"` for Side-by-Side 635L. | Optional (defaults to `"auto"`) |

## Credits
