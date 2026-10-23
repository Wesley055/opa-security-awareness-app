// Asset-only native sync after Expo generation. Never deletes/regenerates Android.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withDangerousMod } = require('@expo/config-plugins');
module.exports = function withCanonicalBrand(config) {
  return withDangerousMod(config, ['android', async config => {
    const root = config.modRequest.projectRoot;
    const source = path.join(root, 'assets/brand/android-res');
    const target = path.join(root, 'android/app/src/main/res');
    const repository = path.resolve(root, '../..');
    const register = JSON.parse(fs.readFileSync(path.join(repository, 'docs/brand-assets.json'), 'utf8'));
    const digest = (bytes, file = '') => {
      const canonical = /\.(svg|xml)$/i.test(file)
        ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')
        : bytes;
      return crypto.createHash('sha256').update(canonical).digest('hex');
    };
    if (digest(fs.readFileSync(path.join(repository, register.source)), register.source) !== register.sourceSha256) throw new Error('Canonical brand master hash mismatch');
    const expected = register.assets.filter(entry => entry.path.startsWith('apps/mobile-app/assets/brand/android-res/'));
    if (expected.length !== 32) throw new Error('Incomplete canonical native asset register');
    for (const asset of expected) {
      if (digest(fs.readFileSync(path.join(repository, asset.path)), asset.path) !== asset.sha256) throw new Error('Canonical native asset missing or changed: ' + asset.path);
    }
    for (const directory of fs.readdirSync(source)) {
      if (!/^(mipmap-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi|anydpi-v26)|drawable-(mdpi|hdpi|xhdpi|xxhdpi|xxxhdpi))$/.test(directory)) throw new Error('Unexpected brand resource directory');
      for (const filename of fs.readdirSync(path.join(source,directory))) {
        if (!/^(ic_launcher(?:_round|_foreground|_background|_monochrome)?\.(webp|xml)|splashscreen_logo\.png)$/.test(filename)) throw new Error('Unexpected brand resource filename');
        const relative = 'apps/mobile-app/assets/brand/android-res/' + directory + '/' + filename;
        const asset = register.assets.find(entry => entry.path === relative);
        if (!asset || digest(fs.readFileSync(path.join(source,directory,filename)), filename) !== asset.sha256) throw new Error('Canonical native asset hash mismatch: ' + relative);
        fs.mkdirSync(path.join(target,directory),{recursive:true});
        fs.copyFileSync(path.join(source,directory,filename),path.join(target,directory,filename));
      }
    }
    return config;
  }]);
};
