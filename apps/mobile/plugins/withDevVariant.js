const { withXcodeProject, withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const DEV_BUNDLE_ID = "sh.davis7.inkwell.dev";
const DEV_ICON_SOURCE = path.join(
  __dirname,
  "..",
  "assets",
  "images",
  "icon-dev.png",
);
const DEV_ICON_FILENAME = "App-Icon-Dev-1024x1024@1x.png";

// Debug builds ARE the dev client (Release strips the dev launcher), so the
// dev identity lives on the Debug build configuration rather than in an
// APP_VARIANT app.config switch — both variants build from one prebuild, and
// switching never re-runs pod install (see the hermes marker footgun in
// AGENTS.md). Info.plist's CFBundleDisplayName is set to
// $(INKWELL_DISPLAY_NAME) via ios.infoPlist in app.json; this plugin defines
// that setting per configuration.
function withDevVariant(config) {
  config = withXcodeProject(config, (config) => {
    const configurations = config.modResults.pbxXCBuildConfigurationSection();
    for (const entry of Object.values(configurations)) {
      const settings = entry.buildSettings;
      // Only the app target's configurations carry a bundle identifier;
      // project-level configurations and comment entries are skipped.
      if (!settings || !settings.PRODUCT_BUNDLE_IDENTIFIER) continue;
      if (entry.name === "Debug") {
        settings.PRODUCT_BUNDLE_IDENTIFIER = DEV_BUNDLE_ID;
        settings.ASSETCATALOG_COMPILER_APPICON_NAME = "AppIconDev";
        settings.INKWELL_DISPLAY_NAME = '"Inkwell Dev"';
      } else {
        settings.INKWELL_DISPLAY_NAME = '"Inkwell"';
      }
    }
    return config;
  });

  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const iconsetDir = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        "Images.xcassets",
        "AppIconDev.appiconset",
      );
      fs.mkdirSync(iconsetDir, { recursive: true });
      fs.copyFileSync(
        DEV_ICON_SOURCE,
        path.join(iconsetDir, DEV_ICON_FILENAME),
      );
      fs.writeFileSync(
        path.join(iconsetDir, "Contents.json"),
        JSON.stringify(
          {
            images: [
              {
                filename: DEV_ICON_FILENAME,
                idiom: "universal",
                platform: "ios",
                size: "1024x1024",
              },
            ],
            info: { version: 1, author: "expo" },
          },
          null,
          2,
        ),
      );
      return config;
    },
  ]);

  return config;
}

module.exports = withDevVariant;
