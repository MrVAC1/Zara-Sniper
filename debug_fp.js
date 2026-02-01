import { FingerprintInjector } from 'fingerprint-injector';
import { FingerprintGenerator } from 'fingerprint-generator';

console.log('--- Inspector ---');
console.log('FingerprintInjector type:', typeof FingerprintInjector);
try {
  const injector = new FingerprintInjector();
  console.log('Injector instance keys:', Object.keys(injector));
  console.log('Has attachFingerprintTo:', typeof injector.attachFingerprintTo);
} catch (e) {
  console.error('Error instantiating injector:', e);
}

console.log('--- Generator Test ---');
const generator = new FingerprintGenerator();
try {
  const fp = generator.getFingerprint({
    devices: ['desktop'],
    operatingSystems: ['windows'],
    browsers: [{ name: 'chrome', minVersion: 120 }],
  });
  console.log('Generated FP:', fp ? 'Yes' : 'No');
  if (fp) {
    console.log('FP keys:', Object.keys(fp));
    console.log('FP properties:', fp.fingerprint ? 'Yes' : 'No');
  }
} catch (e) {
  console.error('Generation error:', e);
}
