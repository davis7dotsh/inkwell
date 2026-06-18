// @clerk/expo's app.plugin.js requires @expo/config-plugins without declaring
// it. Expo SDK 56 stopped depending on that package, so under pnpm's strict
// layout the require fails. Inject it until Clerk declares it properly.
function readPackage(pkg) {
  if (pkg.name === "@clerk/expo") {
    pkg.dependencies = {
      ...pkg.dependencies,
      "@expo/config-plugins": "~56.0.8",
    };
  }
  return pkg;
}
module.exports = { hooks: { readPackage } };
