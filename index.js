'use strict';

const { FridgePlatform, PACKAGE_NAME, PLATFORM_NAME } = require('./lib/platform');

module.exports = (api) => {
  api.registerPlatform(PACKAGE_NAME, PLATFORM_NAME, FridgePlatform);
};
