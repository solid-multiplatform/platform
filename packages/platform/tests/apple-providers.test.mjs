import * as v from 'vitest';
import {
  appleJobs,
  messagingPort,
} from '../hosts/nativescript/apple-providers.mjs';

v.describe('Apple push provider', () => {
  v.it('registers and unregisters a remote messaging token', async () => {
    const calls = [];
    const port = messagingPort({
      async registerDeviceForRemoteMessages() {
        calls.push('register');
      },
      getToken() {
        calls.push('token');
        return 'apns-token';
      },
      async deleteToken() {
        calls.push('delete');
      },
      async unregisterDeviceForRemoteMessages() {
        calls.push('unregister');
      },
    });
    v.expect(await port.register()).toBe('apns-token');
    await port.unregister();
    v.expect(calls).toEqual(['register', 'token', 'delete', 'unregister']);
  });
});

v.describe('Apple background tasks', () => {
  v.afterEach(() => {
    delete globalThis.BGTaskScheduler;
    delete globalThis.BGAppRefreshTaskRequest;
  });

  v.it('submits registered refresh identifiers and cancels them', async () => {
    const submitted = [];
    const cancelled = [];
    class Request {
      constructor(id) {
        this.id = id;
      }
    }
    globalThis.BGAppRefreshTaskRequest = {
      alloc: () => ({
        initWithIdentifier: (id) => new Request(id),
      }),
    };
    globalThis.BGTaskScheduler = {
      sharedScheduler: {
        submitTaskRequestError(request) {
          submitted.push(request.id);
          return request.id !== 'declined';
        },
        cancelTaskRequestWithIdentifier(id) {
          cancelled.push(id);
        },
      },
    };
    const jobs = appleJobs(['refresh', 'declined']);
    await jobs.schedule('refresh');
    await v
      .expect(jobs.schedule('declined'))
      .rejects.toThrowError(/declined background/);
    await v
      .expect(jobs.schedule('unknown'))
      .rejects.toThrowError(/Unregistered/);
    jobs.cancel('refresh');
    jobs.cancel('unknown');
    v.expect(submitted).toEqual(['refresh', 'declined']);
    v.expect(cancelled).toEqual(['refresh']);
  });

  v.it('is unavailable without BGTaskScheduler', () => {
    v.expect(appleJobs(['refresh'])).toBeUndefined();
  });
});
