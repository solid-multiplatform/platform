/**
 * Content-provider queries that stay off the UI thread.
 *
 * `AsyncQueryHandler` runs the query on the platform's own worker thread and
 * hands the cursor back on the main looper, its first window already filled.
 * The rows are then read on the main thread a few milliseconds at a time,
 * yielding to the looper between slices, so a large result never holds a
 * frame. The worker thread is the platform's: it starts with the first query
 * and waits, asleep, afterwards.
 */
import { mainHandler, strings, type AndroidApp } from './runtime.js';

/** Longest stretch of row reading before the main looper gets a turn. */
const SLICE_MS = 4;

let Handler:
  | (new (
      resolver: android.content.ContentResolver,
    ) => android.content.AsyncQueryHandler)
  | undefined;
let handler: android.content.AsyncQueryHandler | undefined;
const waiting = new Map<
  number,
  (cursor: android.database.Cursor | null) => void
>();
let tokens = 0;

export interface Query {
  uri: android.net.Uri;
  columns: readonly string[];
  where?: string;
  args?: readonly string[];
  order?: string;
}

/** Runs the query in the background. Resolves on the main looper. */
function run(app: AndroidApp, query: Query): Promise<android.database.Cursor> {
  Handler ??= android.content.AsyncQueryHandler.extend({
    onQueryComplete(token, _cookie, cursor) {
      const done = waiting.get(token);
      waiting.delete(token);
      if (done) done(cursor);
      else cursor?.close();
    },
  });
  handler ??= new Handler(app.context.getContentResolver());
  const worker = handler;
  return new Promise((resolve, reject) => {
    const token = ++tokens;
    waiting.set(token, (cursor) =>
      cursor ? resolve(cursor) : reject(new Error('The query failed')),
    );
    worker.startQuery(
      token,
      null,
      query.uri,
      strings(query.columns),
      query.where ?? null,
      query.args ? strings(query.args) : null,
      query.order ?? null,
    );
  });
}

/**
 * Queries in the background and reads up to `limit` rows in slices. `read`
 * is called with the cursor on each row; the cursor is closed at the end.
 */
export async function queryRows<T>(
  app: AndroidApp,
  query: Query,
  limit: number,
  read: (cursor: android.database.Cursor) => T,
): Promise<T[]> {
  const cursor = await run(app, query);
  return new Promise<T[]>((resolve, reject) => {
    const rows: T[] = [];
    const step = new java.lang.Runnable({
      run() {
        try {
          const started = Date.now();
          while (rows.length < limit && cursor.moveToNext()) {
            rows.push(read(cursor));
            if (Date.now() - started >= SLICE_MS) {
              mainHandler().post(step);
              return;
            }
          }
          cursor.close();
          resolve(rows);
        } catch (error) {
          cursor.close();
          reject(error as Error);
        }
      },
    });
    step.run();
  });
}
