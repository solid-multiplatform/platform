import * as v from 'vitest';
import {
  checkRokuCertification,
  ROKU_CERTIFICATION_BUDGETS,
} from '../src/sdk/certification.js';

const passing = {
  launchMs: 10_000,
  sceneSwitchMs: 1_500,
  keyResponseMs: 120,
  packageBytes: 3 * 1024 * 1024,
};

v.describe('Roku certification gate', () => {
  v.it('accepts metrics at or under every budget', () => {
    const result = checkRokuCertification(passing);
    v.expect(result.pass).toBe(true);
    v.expect(result.failures).toEqual([]);
    v.expect(ROKU_CERTIFICATION_BUDGETS).toEqual({
      launchMs: 15_000,
      sceneSwitchMs: 3_000,
      keyResponseMs: 250,
      packageBytes: 4 * 1024 * 1024,
    });
  });

  v.it('reports every exceeded budget', () => {
    const result = checkRokuCertification({
      launchMs: 15_001,
      sceneSwitchMs: 3_001,
      keyResponseMs: 251,
      packageBytes: 4 * 1024 * 1024 + 1,
    });
    v.expect(result.pass).toBe(false);
    v.expect(result.failures.map((failure) => failure.metric)).toEqual([
      'launchMs',
      'sceneSwitchMs',
      'keyResponseMs',
      'packageBytes',
    ]);
  });

  v.it('accepts exact boundary values and custom budgets', () => {
    v.expect(
      checkRokuCertification({
        launchMs: 15_000,
        sceneSwitchMs: 3_000,
        keyResponseMs: 250,
        packageBytes: 4 * 1024 * 1024,
      }).pass,
    ).toBe(true);
    v.expect(
      checkRokuCertification(passing, {
        launchMs: 1,
        sceneSwitchMs: 1,
        keyResponseMs: 1,
        packageBytes: 1,
      }).failures,
    ).toHaveLength(4);
  });
});
