import { createSignal, type Accessor } from 'solid-js';

/** Parse `1.2.3-beta.1` into comparable numeric parts. */
export function parseVersion(version: string): number[] {
  return version
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .map((part) => {
      const match = /^(\d+)/.exec(part);
      return match ? Number(match[1]) : 0;
    });
}

/** Compare two semantic versions. Returns -1, 0 or 1. */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const first = left[i] ?? 0;
    const second = right[i] ?? 0;
    if (first > second) return 1;
    if (first < second) return -1;
  }
  return 0;
}

export interface UpdateInfo {
  version: string;
  notes?: string;
  /** Store or installer URL. */
  url?: string;
  /** A mandatory update cannot be dismissed. */
  mandatory?: boolean;
}

export interface UpdateCheckerOptions {
  currentVersion: string;
  /** Query the update channel. Return null when up to date. */
  check(): Promise<UpdateInfo | null>;
  onError?(error: unknown): void;
}

export interface UpdateChecker {
  checking: Accessor<boolean>;
  update: Accessor<UpdateInfo | null>;
  error: Accessor<unknown>;
  /** Resolves with the available update, or null when current/latest. */
  check(): Promise<UpdateInfo | null>;
  /** Dismiss a non-mandatory update prompt. */
  dismiss(): void;
}

/**
 * Version/update check in the Tauri updater shape: the host supplies the
 * channel query, this helper filters older versions, tracks checking/error
 * state, and refuses to dismiss mandatory updates.
 */
export function createUpdateChecker(
  options: UpdateCheckerOptions,
): UpdateChecker {
  const [checking, setChecking] = createSignal(false);
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null);
  const [error, setError] = createSignal<unknown>(undefined);
  let request = 0;

  return {
    checking,
    update,
    error,
    async check() {
      const token = ++request;
      setChecking(true);
      setError(undefined);
      try {
        const result = await options.check();
        if (token !== request) return null;
        if (
          !result ||
          compareVersions(result.version, options.currentVersion) <= 0
        ) {
          setUpdate(null);
          return null;
        }
        setUpdate(result);
        return result;
      } catch (caught) {
        if (token !== request) return null;
        setError(() => caught);
        options.onError?.(caught);
        return null;
      } finally {
        if (token === request) setChecking(false);
      }
    },
    dismiss() {
      if (!update()?.mandatory) setUpdate(null);
    },
  };
}
