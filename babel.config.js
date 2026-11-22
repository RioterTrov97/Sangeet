module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Unistyles only rewrites StyleSheet usage inside `root`, so keep styles in src/.
    // Route files in app/ stay thin and compose components from src/ui.
    plugins: [['react-native-unistyles/plugin', { root: 'src' }]],
  };
};
