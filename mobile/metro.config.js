// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Code and assets the app shares with the web, outside this project:
//  - ../lib: only pure modules with no imports (issues, notes, mentions,
//    currency), reached through the @shared/* alias in tsconfig.json;
//  - ../brand: the logo files, one source of truth for web and app.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, "../lib"),
  path.resolve(__dirname, "../brand"),
];

module.exports = config;
