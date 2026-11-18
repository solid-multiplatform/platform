import * as v from 'vitest';
import {
  configureLogging,
  createLogger,
  logEvent,
  useLogger,
  withSpan,
  type LogRecord,
} from '../src/sdk/logging.js';
import {
  env,
  envFlag,
  envNumber,
  publicEnvironment,
  requireEnv,
  resetEnvironment,
  setEnvironment,
} from '../src/sdk/env.js';
import {
  deviceMemory,
  resetDevicePorts,
  setDevicePorts,
} from '../src/sdk/device.js';

v.describe('structured logging', () => {
  v.it('filters by level and merges child/base fields', () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      level: 'info',
      records,
      base: { app: 'demo' },
    });
    logger.debug('ignored');
    logger.info('started', { screen: 'home' });
    const child = logger.child({ feature: 'player' });
    child.warn('buffering', { seconds: 2 });
    logger.error('failed');
    v.expect(records.map((record) => record.level)).toEqual([
      'info',
      'warn',
      'error',
    ]);
    v.expect(records[0]!.fields).toEqual({ app: 'demo', screen: 'home' });
    v.expect(records[1]!.fields).toEqual({
      app: 'demo',
      feature: 'player',
      seconds: 2,
    });
  });

  v.it('emits span records for success and failure', async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({ level: 'debug', records });
    const value = await logger.span('load', async () => 42, { id: 'a' });
    v.expect(value).toBe(42);
    v.expect(records[0]).toMatchObject({
      level: 'info',
      message: 'load',
      span: 'load',
      fields: { id: 'a' },
    });
    v.expect(records[0]!.durationMs).toBeGreaterThanOrEqual(0);

    await v
      .expect(
        logger.span('save', async () => {
          throw new Error('disk');
        }),
      )
      .rejects.toThrowError('disk');
    v.expect(records[1]).toMatchObject({ level: 'error', span: 'save' });
    v.expect((records[1]!.fields as { error: Error }).error).toBeInstanceOf(
      Error,
    );
  });

  v.it('installs the active logger and times operations', async () => {
    const records: LogRecord[] = [];
    configureLogging({ level: 'debug', records, base: { app: 'active' } });
    v.expect(useLogger()).toBeDefined();
    logEvent('warn', 'hello', { n: 1 });
    v.expect(records[0]).toMatchObject({
      level: 'warn',
      message: 'hello',
      fields: { app: 'active', n: 1 },
    });
    await withSpan('work', () => 1);
    v.expect(records[1]).toMatchObject({ span: 'work', message: 'work' });
  });
});

v.describe('environment injection', () => {
  v.afterEach(() => resetEnvironment());

  v.it('reads strings, flags and numbers with fallbacks', () => {
    setEnvironment({
      API_URL: 'https://api.test',
      FEATURE: 'yes',
      OFF: '0',
      LIMIT: '25',
      BAD: 'not-a-number',
      EMPTY: '',
    });
    v.expect(env('API_URL')).toBe('https://api.test');
    v.expect(env('MISSING', 'fallback')).toBe('fallback');
    v.expect(env('EMPTY', 'fallback')).toBe('fallback');
    v.expect(envFlag('FEATURE')).toBe(true);
    v.expect(envFlag('OFF', true)).toBe(false);
    v.expect(envFlag('MISSING', true)).toBe(true);
    v.expect(envNumber('LIMIT')).toBe(25);
    v.expect(envNumber('BAD', 7)).toBe(7);
    v.expect(envNumber('MISSING', 3)).toBe(3);
    v.expect(requireEnv('API_URL')).toBe('https://api.test');
    v.expect(() => requireEnv('MISSING')).toThrowError(/MISSING/);
  });

  v.it('exposes only public values', () => {
    setEnvironment({
      PUBLIC_API: 'https://api.test',
      SOLID_PUBLIC_FLAG: 'on',
      SECRET_KEY: 'shh',
    });
    v.expect(publicEnvironment()).toEqual({
      PUBLIC_API: 'https://api.test',
      SOLID_PUBLIC_FLAG: 'on',
    });
    v.expect(publicEnvironment(['SECRET_'])).toEqual({ SECRET_KEY: 'shh' });
  });
});

v.describe('device memory', () => {
  v.afterEach(() => resetDevicePorts());

  v.it('uses a host memory signal first', () => {
    setDevicePorts({
      memory: () => ({ deviceMemoryGb: 1.5, lowMemory: false }),
    });
    v.expect(deviceMemory(2)).toEqual({
      deviceMemoryGb: 1.5,
      lowMemory: true,
    });
    setDevicePorts({ memory: () => ({ deviceMemoryGb: 8, lowMemory: true }) });
    v.expect(deviceMemory(2)).toEqual({
      deviceMemoryGb: 8,
      lowMemory: true,
    });
  });

  v.it('falls back to navigator.deviceMemory', () => {
    resetDevicePorts();
    Object.defineProperty(navigator, 'deviceMemory', {
      value: 1,
      configurable: true,
    });
    v.expect(deviceMemory(2)).toEqual({
      deviceMemoryGb: 1,
      lowMemory: true,
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      value: 8,
      configurable: true,
    });
    v.expect(deviceMemory(2).lowMemory).toBe(false);
  });
});
