const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/* https://docs.expo.dev/guides/customizing-metro */
config.resolver.sourceExts.push('js', 'jsx', 'json', 'ts', 'tsx', 'cjs', 'mjs');
config.resolver.assetExts.push('glb', 'gltf', 'png', 'jpg');

module.exports = config;
