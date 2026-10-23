import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * I3 (iOS launch crash, builds 8 and 9): with "main": "index.ts" Metro bundled
 * the Android native-module file on iOS, so requireNativeModule('OpaProtection')
 * threw at startup. The main field must have no extension so Metro picks
 * index.ios.ts on iOS and index.ts on Android.
 */
describe('opa-protection platform resolution', () => {
  const dir = join(__dirname, '../../modules/opa-protection');

  it('lets Metro choose the platform file', () => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    expect(pkg.main).toBe('index');
  });

  it('keeps the iOS file free of the native module', () => {
    const ios = readFileSync(join(dir, 'index.ios.ts'), 'utf8');
    const code = ios.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/requireNativeModule/);
  });
});
