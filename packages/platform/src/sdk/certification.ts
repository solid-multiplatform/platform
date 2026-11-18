export interface RokuCertificationMetrics {
  /** Cold launch to first interactive frame. */
  launchMs: number;
  /** Worst scene transition. */
  sceneSwitchMs: number;
  /** Worst key-to-visible-response time. */
  keyResponseMs: number;
  /** Packaged application size. */
  packageBytes: number;
}

export interface CertificationBudgets {
  launchMs: number;
  sceneSwitchMs: number;
  keyResponseMs: number;
  packageBytes: number;
}

/** Roku certification limits for the beta profile. */
export const ROKU_CERTIFICATION_BUDGETS: CertificationBudgets = Object.freeze({
  launchMs: 15_000,
  sceneSwitchMs: 3_000,
  keyResponseMs: 250,
  packageBytes: 4 * 1024 * 1024,
});

export interface CertificationFailure {
  metric: keyof CertificationBudgets;
  actual: number;
  limit: number;
}

export interface CertificationResult {
  pass: boolean;
  failures: CertificationFailure[];
  metrics: RokuCertificationMetrics;
}

/** Evaluate measured Roku startup/scene/input/package metrics against the gate. */
export function checkRokuCertification(
  metrics: RokuCertificationMetrics,
  budgets: CertificationBudgets = ROKU_CERTIFICATION_BUDGETS,
): CertificationResult {
  const failures = (Object.keys(budgets) as (keyof CertificationBudgets)[])
    .filter((metric) => Number(metrics[metric]) > budgets[metric])
    .map((metric) => ({
      metric,
      actual: Number(metrics[metric]),
      limit: budgets[metric],
    }));
  return { pass: failures.length === 0, failures, metrics };
}
