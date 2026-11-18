export type EnvSource = Record<string, string | undefined>;

const buildEnv = (import.meta as ImportMeta & { env?: EnvSource }).env ?? {};

let environment: EnvSource = { ...buildEnv };

/**
 * Inject configuration at boot, e.g. from a desktop config file, native
 * properties or a test harness. Values merge over build-time env.
 */
export function setEnvironment(values: EnvSource): void {
  environment = { ...environment, ...values };
}

export function resetEnvironment(): void {
  environment = { ...buildEnv };
}

/** Read a configuration value. Returns the fallback when absent. */
export function env(key: string, fallback?: string): string | undefined {
  const value = environment[key];
  return value === undefined || value === '' ? fallback : value;
}

/** Read a required value; throws with the key name when it is missing. */
export function requireEnv(key: string): string {
  const value = env(key);
  if (value === undefined) {
    throw new Error(`Missing required environment value: ${key}`);
  }
  return value;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

/** Read a boolean flag (`1/true/yes/on`). */
export function envFlag(key: string, fallback = false): boolean {
  const value = env(key);
  if (value === undefined) return fallback;
  return TRUTHY.has(value.toLowerCase());
}

/** Read a numeric value, falling back when absent or not finite. */
export function envNumber(key: string, fallback = 0): number {
  const value = env(key);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The subset safe to expose to app code. Prefixes match Vite's
 * `import.meta.env` convention (`PUBLIC_`/`VITE_`); secrets stay in the host.
 */
export function publicEnvironment(
  prefixes: readonly string[] = ['PUBLIC_', 'SOLID_PUBLIC_'],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    if (prefixes.some((prefix) => key.startsWith(prefix))) {
      result[key] = value;
    }
  }
  return result;
}
