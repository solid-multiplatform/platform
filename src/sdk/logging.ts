export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  message: string;
  /** Unix milliseconds. */
  time: number;
  fields?: Record<string, unknown>;
  span?: string;
  durationMs?: number;
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Add fields to every record from the child logger. */
  child(fields: Record<string, unknown>): Logger;
  /** Measure an async/sync operation and emit one record. */
  span<T>(
    name: string,
    run: () => T | Promise<T>,
    fields?: Record<string, unknown>,
  ): Promise<T>;
}

export interface LoggingOptions {
  /** Records below this level are dropped. Defaults to `info`. */
  level?: LogLevel;
  sink?(record: LogRecord): void;
  /** Fields attached to every record, e.g. app version and target. */
  base?: Record<string, unknown>;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const now = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** A logger that keeps records in memory for tests and devtools. */
export function createLogger(
  options: LoggingOptions & { records?: LogRecord[] } = {},
): Logger {
  const level = options.level ?? 'info';
  const base = options.base ?? {};
  const records = options.records;
  const sink =
    options.sink ??
    (records
      ? (record: LogRecord) => {
          records.push(record);
        }
      : (record: LogRecord) => {
          const method = record.level === 'debug' ? 'log' : record.level;
          // eslint-disable-next-line no-console
          console[method](
            `[${record.level}] ${record.message}`,
            record.fields ?? {},
          );
        });

  const emit = (
    recordLevel: LogLevel,
    message: string,
    fields?: Record<string, unknown>,
    extra?: Pick<LogRecord, 'span' | 'durationMs'>,
  ) => {
    if (priorities[recordLevel] < priorities[level]) return;
    sink({
      level: recordLevel,
      message,
      time: Date.now(),
      ...(base || fields ? { fields: { ...base, ...fields } } : {}),
      ...extra,
    });
  };

  const make = (extraFields: Record<string, unknown>): Logger => ({
    debug: (message, fields) =>
      emit('debug', message, { ...extraFields, ...fields }),
    info: (message, fields) =>
      emit('info', message, { ...extraFields, ...fields }),
    warn: (message, fields) =>
      emit('warn', message, { ...extraFields, ...fields }),
    error: (message, fields) =>
      emit('error', message, { ...extraFields, ...fields }),
    child: (fields) => make({ ...extraFields, ...fields }),
    async span(name, run, fields) {
      const startedAt = now();
      try {
        const value = await run();
        emit(
          'info',
          name,
          { ...extraFields, ...fields },
          { span: name, durationMs: Math.round(now() - startedAt) },
        );
        return value;
      } catch (error) {
        emit(
          'error',
          name,
          { ...extraFields, ...fields, error },
          { span: name, durationMs: Math.round(now() - startedAt) },
        );
        throw error;
      }
    },
  });

  return make({});
}

let active = createLogger();

/** Install the app logger (one sink to your observability backend). */
export function configureLogging(options: LoggingOptions): Logger {
  active = createLogger(options);
  return active;
}

export function useLogger(): Logger {
  return active;
}

export function logEvent(
  level: LogLevel,
  message: string,
  fields?: Record<string, unknown>,
): void {
  active[level](message, fields);
}

/** Time an operation against the active logger. */
export function withSpan<T>(
  name: string,
  run: () => T | Promise<T>,
  fields?: Record<string, unknown>,
): Promise<T> {
  return active.span(name, run, fields);
}
