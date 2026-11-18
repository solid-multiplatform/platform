import type { ResolvedConfig, TargetName } from './config.d.ts';

export type { ResolvedConfig, TargetName };

export interface ExecResult {
  /** The exit code, or null when the tool could not be started. */
  status: number | null;
  stdout: string | Uint8Array;
  stderr: string | Uint8Array;
}

export interface ExecOptions {
  cwd?: string;
  /** `inherit` streams the tool's output to the terminal until it exits. */
  stdio?: 'pipe' | 'inherit';
  /** Return stdout as bytes, for screenshots. */
  binary?: boolean;
}

/** Everything a target may use to look at or change the machine. Tests replace all of it. */
export interface TargetContext {
  /** The app directory. */
  root: string;
  /** The project settings, loaded and validated on first use. Throws outside an app directory. */
  readonly config: ResolvedConfig;
  env: Record<string, string | undefined>;
  /** `process.platform`: `linux`, `darwin`, `win32`. */
  platform: string;
  arch: string;
  nodeVersion: string;
  exec(bin: string, args: string[], options?: ExecOptions): ExecResult;
  /** The full path of a tool on PATH, or null. */
  which(bin: string): string | null;
  exists(file: string): boolean;
  /** Names in a directory; empty when it does not exist. */
  readdir(dir: string): string[];
  readFile(file: string): string;
  /** Writes a file, creating its directory. */
  writeFile(file: string, data: string | Uint8Array): void;
  /** Prints one line. Values of device and credential variables are removed. */
  out(line: string): void;
  err(line: string): void;
  /** Test seam for the build step of `run` and `package`. */
  buildProject?: (
    root: string,
    target: string,
    dev?: boolean | 'plugins',
    legacy?: boolean,
  ) => void;
  /** Test seam for `cli/roku-device.mjs`. */
  rokuDevice?: RokuDeviceModule;
}

export interface RokuDeviceModule {
  rokuDevice(env?: Record<string, string | undefined>): unknown;
  deviceInfo(device: unknown): Promise<{
    model?: string;
    softwareVersion?: string;
    developerEnabled?: boolean;
  }>;
  sideload(device: unknown, zipFile: string): Promise<unknown>;
  launch(device: unknown, appId?: string): Promise<unknown>;
  screenshot(device: unknown): Promise<Uint8Array>;
  readConsole(
    device: unknown,
    onLine: (line: string) => boolean | void,
    timeoutMs?: number,
  ): { done: Promise<string[]>; stop(): void };
}

export interface Check {
  name: string;
  status: 'ok' | 'missing' | 'skipped';
  /** What was found, or how to fix it. Never a credential or a device address. */
  detail: string;
  /** A missing or skipped check that stops this target from building. */
  blocksBuild?: boolean;
}

export interface BuildOptions {
  /** `true` serves or launches after building; `plugins` runs desktop plugins only. */
  dev?: boolean | 'plugins';
  /** Canvas 2D build for older browser TVs. */
  legacy?: boolean;
}

export interface RunOptions {
  /** A device id from `solid-platform devices`. */
  device?: string;
  /** Use what the last build produced. */
  build?: boolean;
  /** web: the port to serve on; 0 picks a free one. */
  port?: number;
}

export interface LogOptions {
  device?: string;
  /** Stop after this many milliseconds. Default: until interrupted. */
  timeoutMs?: number;
}

export interface ScreenshotOptions {
  device?: string;
  /** Where the PNG is written. */
  file: string;
}

export interface TargetDefinition {
  name: TargetName;
  /** Targets in one family share a toolchain. */
  family: 'web' | 'browser-tv' | 'roku' | 'android' | 'apple' | 'desktop';
  /** One line for `solid-platform --help`. */
  summary: string;
  doctor(ctx: TargetContext): Check[] | Promise<Check[]>;
  build(ctx: TargetContext, options: BuildOptions): void | Promise<void>;
  run?(ctx: TargetContext, options: RunOptions): unknown;
  package?(ctx: TargetContext, options: BuildOptions): void | Promise<void>;
  /** Prints the devices this target can run on. */
  devices?(ctx: TargetContext): void | Promise<void>;
  logs?(ctx: TargetContext, options: LogOptions): void | Promise<void>;
  screenshot?(
    ctx: TargetContext,
    options: ScreenshotOptions,
  ): void | Promise<void>;
}
