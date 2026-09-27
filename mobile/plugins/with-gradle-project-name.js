// Prebuild names the Gradle root project after the app ("book."), and Gradle
// refuses project names that start or end with a dot. The launcher label keeps
// the dot — it comes from strings.xml, not from this name.
const { withSettingsGradle } = require("expo/config-plugins");

const PROJECT_NAME = "book";

module.exports = function withGradleProjectName(config) {
  return withSettingsGradle(config, (cfg) => {
    const pattern = /rootProject\.name\s*=\s*'[^']*'/;
    if (!pattern.test(cfg.modResults.contents)) {
      throw new Error("with-gradle-project-name: rootProject.name not found in settings.gradle");
    }
    cfg.modResults.contents = cfg.modResults.contents.replace(pattern, `rootProject.name = '${PROJECT_NAME}'`);
    return cfg;
  });
};
