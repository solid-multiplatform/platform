# Task scheduler

The task scheduler runs work later, one task at a time, and stays out of the
way while the user is pressing keys. Use it for work that can wait: preloading
the next row, warming a cache.

```ts
import {
  clearTasks,
  scheduleTask,
  setTasksEnabled,
} from '@solid-multiplatform/platform';
```

## `scheduleTask(callback, priority?)`

Queues a function.

- `callback`: `() => void`.
- `priority`: `'low'` (default) adds it to the back of the queue. `'high'` adds
  it to the front.

```ts
scheduleTask(() => preloadRow(3));
scheduleTask(() => preloadHero(), 'high');
```

## `setTasksEnabled(enabled)`

Pauses or resumes the queue. Paused tasks stay queued.

```ts
setTasksEnabled(false);
setTasksEnabled(true);
```

## `clearTasks()`

Drops every queued task. Call it when you leave a page whose tasks no longer
matter.

## How it runs

- Tasks run one per timer, `Config.taskDelay` ms apart (50 ms when unset).
- The queue stops when focus moves, because that means the user pressed a key.
- It starts again when the renderer reports `idle`.
- A timer exists only while tasks are queued. An empty queue schedules nothing.

The idle hook is installed by `createRenderer`.
