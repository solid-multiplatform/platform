import { readFileSync } from 'node:fs';
import { checkRokuCertification } from '@solid-multiplatform/platform/certification';

/**
 * Evaluate a Roku metrics JSON file against the certification budgets.
 * Exits non-zero on a budget failure so CI can gate a release.
 */
export function certifyRoku(file) {
  const metrics = JSON.parse(readFileSync(file, 'utf8'));
  const result = checkRokuCertification(metrics);
  console.log(JSON.stringify(result, null, 2));
  if (!result.pass) process.exitCode = 1;
  return result;
}
