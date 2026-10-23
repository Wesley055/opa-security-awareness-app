const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

const KEYWORD_FILE = 'help-help_en_android_v4_0_0.ppn';

module.exports = function withPicovoiceKeyword(config) {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;

      const source = path.join(
        projectRoot,
        'assets',
        'picovoice',
        KEYWORD_FILE,
      );

      const destinationDirectory = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'assets',
      );

      const destination = path.join(
        destinationDirectory,
        KEYWORD_FILE,
      );

      if (!fs.existsSync(source)) {
        throw new Error(
          `Picovoice keyword file not found: ${source}`,
        );
      }

      fs.mkdirSync(destinationDirectory, {
        recursive: true,
      });

      fs.copyFileSync(source, destination);

      return config;
    },
  ]);
};
