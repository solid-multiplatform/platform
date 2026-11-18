export type ReleaseTarget =
  | 'android'
  | 'android-tv'
  | 'ios'
  | 'tvos'
  | 'macos'
  | 'windows'
  | 'linux'
  | 'web'
  | 'roku';

export interface ReleaseContext {
  target: ReleaseTarget;
  version: string;
  /** Built artifacts or store bundles to sign/notarize. */
  artifacts?: readonly string[];
  /** Environment overrides for CI signing identities. */
  env?: Record<string, string | undefined>;
  [key: string]: unknown;
}

export interface ReleaseHook {
  name: string;
  /** Skip the hook when this returns false. */
  when?(context: ReleaseContext): boolean;
  run(context: ReleaseContext): void | Promise<void>;
}

export interface ReleasePipelineOptions {
  onHook?(
    name: string,
    phase: 'start' | 'end' | 'skip' | 'error',
    context: ReleaseContext,
  ): void;
}

export interface ReleasePipeline {
  hooks: readonly ReleaseHook[];
  /** Run enabled hooks in order. Returns the context for chaining. */
  run(context: ReleaseContext): Promise<ReleaseContext>;
}

/**
 * Build a signing/notarization pipeline. The platform toolchain stays in the
 * hooks (codesign/notarytool, apksigner, signtool, Tauri signing); this
 * orchestrates ordering, skips and error reporting, and is directly testable.
 */
export function createReleasePipeline(
  hooks: readonly ReleaseHook[],
  options: ReleasePipelineOptions = {},
): ReleasePipeline {
  return {
    hooks,
    async run(context) {
      for (const hook of hooks) {
        if (hook.when && !hook.when(context)) {
          options.onHook?.(hook.name, 'skip', context);
          continue;
        }
        options.onHook?.(hook.name, 'start', context);
        try {
          await hook.run(context);
          options.onHook?.(hook.name, 'end', context);
        } catch (error) {
          options.onHook?.(hook.name, 'error', context);
          throw error;
        }
      }
      return context;
    },
  };
}

/** Identity helper for typed hook arrays in release configs. */
export function defineReleaseHooks(
  hooks: readonly ReleaseHook[],
): ReleaseHook[] {
  return [...hooks];
}

/** Common hook: require a signing identity before running platform tools. */
export function requireSigningIdentity(envKey: string): ReleaseHook {
  return {
    name: `require:${envKey}`,
    run(context) {
      let fromProcess: string | undefined;
      try {
        fromProcess =
          typeof process === 'undefined' ? undefined : process.env?.[envKey];
      } catch {
        fromProcess = undefined;
      }
      const value = context.env?.[envKey] ?? fromProcess;
      if (!value) {
        throw new Error(`Missing release signing value: ${envKey}`);
      }
    },
  };
}
