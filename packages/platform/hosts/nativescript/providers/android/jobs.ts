import type { JobsPort } from '../../../../src/sdk/services.js';
import type { AndroidApp } from './runtime.js';

/** A background job the app declared: its `JobService` and a stable id. */
export interface AndroidJob {
  /** The `JobService` class named in the manifest. */
  className: string;
  /** The app's own id for the job; scheduling again replaces it. */
  id: number;
  /** Earliest start, in milliseconds from now. */
  delayMs?: number;
  /** Run only while a network is available. */
  network?: boolean;
}

export type AndroidJobs = Readonly<Record<string, AndroidJob>>;

/**
 * `JobScheduler` over the jobs the app registered by name. The system chooses
 * when each runs; nothing is scheduled, and no service runs, until an app
 * asks.
 */
export function jobs(
  app: AndroidApp,
  registry: AndroidJobs,
): JobsPort & { cancel(id: string): void } {
  const scheduler = (): android.app.job.JobScheduler =>
    app.context.getSystemService(android.content.Context.JOB_SCHEDULER_SERVICE);
  const find = (name: string): AndroidJob | undefined =>
    Object.prototype.hasOwnProperty.call(registry, name)
      ? registry[name]
      : undefined;
  return {
    async schedule(name) {
      const job = find(name);
      if (!job) throw new Error('Unknown background job: ' + name);
      const builder = new android.app.job.JobInfo.Builder(
        job.id,
        new android.content.ComponentName(app.context, job.className),
      );
      builder.setMinimumLatency(Math.max(0, job.delayMs ?? 0));
      if (job.network)
        builder.setRequiredNetworkType(
          android.app.job.JobInfo.NETWORK_TYPE_ANY,
        );
      if (
        scheduler().schedule(builder.build()) !==
        android.app.job.JobScheduler.RESULT_SUCCESS
      )
        throw new Error('Android declined background work');
    },
    cancel(name) {
      const job = find(name);
      if (job) scheduler().cancel(job.id);
    },
  };
}
