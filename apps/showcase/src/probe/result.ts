/**
 * - `ok`: the probe ran and its result was checked.
 * - `denied`: the platform refused (a permission, a user-gesture rule).
 * - `failed`: it ran and the result was wrong, or it threw.
 * - `unavailable`: no provider is installed for the service on this host.
 * - `unverified`: nothing here could check it (it needs a person, a prompt or
 *   an external app). Never reported as `ok`.
 */
export type Status = 'ok' | 'denied' | 'failed' | 'unavailable' | 'unverified';

export interface Outcome {
  status: Status;
  detail?: string;
}

/** The one document a probe run emits. */
export interface ProbeResult {
  target: string;
  backend: string;
  capabilities: unknown;
  /** `installedServices()` on this host, to check the table against. */
  installedServices: string[];
  services: Record<string, Outcome>;
  ui: Record<string, Outcome>;
}

export const ok = (detail?: string): Outcome => ({ status: 'ok', detail });
export const failed = (detail: string): Outcome => ({
  status: 'failed',
  detail,
});
export const unverified = (detail: string): Outcome => ({
  status: 'unverified',
  detail,
});

export const describe = (outcome: Outcome): string =>
  outcome.detail ? `${outcome.status}: ${outcome.detail}` : outcome.status;
