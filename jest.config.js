const preset = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/ios/', '/android/'],
  // youtubei.js (and its deps) ship ESM only.
  transformIgnorePatterns: [
    preset.transformIgnorePatterns[0].replace('(.pnpm|', '(.pnpm|youtubei\\.js|jintr|meriyah|acorn|@bufbuild|'),
    ...preset.transformIgnorePatterns.slice(1),
  ],
};
