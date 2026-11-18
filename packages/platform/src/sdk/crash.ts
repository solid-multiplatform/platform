export interface CrashContext {
  error: unknown;
  /** Framework/component stack when the host provides one. */
  componentStack?: string;
  /** Extra app context attached by the reporter owner. */
  tags?: Record<string, string>;
}

export type CrashReporter = (context: CrashContext) => void;

let reporter: CrashReporter | undefined;

/**
 * Install the crash reporter (Sentry, Crashlytics, a logging endpoint).
 * A reporter must never throw; failures are swallowed so error handling does
 * not recurse.
 */
export function setCrashReporter(next: CrashReporter | undefined): void {
  reporter = next;
}

/** Remove the reporter, e.g. between tests. */
export function resetCrashReporter(): void {
  reporter = undefined;
}

/** Send an error to the installed reporter. A no-op when none is installed. */
export function reportCrash(
  error: unknown,
  extra: Omit<CrashContext, 'error'> = {},
): void {
  if (!reporter) return;
  try {
    reporter({ error, ...extra });
  } catch {
    // Never let reporting mask the original failure.
  }
}
