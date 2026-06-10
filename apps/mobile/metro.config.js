// Expo SDK 54 auto-configures Metro for pnpm workspaces (watchFolders +
// nodeModulesPaths); the default config is all we need.
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);
