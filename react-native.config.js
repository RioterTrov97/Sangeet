// @react-native-menu/menu does not compile against RN 0.88 on Android (setHitSlopRect) and the Android TV app
// never renders its menus (they are phone UI), so it is excluded from Android autolinking only.
module.exports = {
  dependencies: {
    '@react-native-menu/menu': { platforms: { android: null } },
  },
};
