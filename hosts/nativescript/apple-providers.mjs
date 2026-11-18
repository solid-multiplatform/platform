/** The app provisions APNs/FCM entitlements and submits the returned token to its backend. */
export function messagingPort(messaging) {
  return {
    async register() {
      await messaging.registerDeviceForRemoteMessages();
      return messaging.getToken();
    },
    async unregister() {
      await messaging.deleteToken();
      await messaging.unregisterDeviceForRemoteMessages();
    },
  };
}

/** Identifiers must have launch handlers and BGTaskSchedulerPermittedIdentifiers in the app. */
export function appleJobs(identifiers) {
  if (typeof BGTaskScheduler === 'undefined') return undefined;
  const allowed = new Set(identifiers);
  return {
    async schedule(id) {
      if (!allowed.has(id)) throw new Error('Unregistered refresh task');
      const request = BGAppRefreshTaskRequest.alloc().initWithIdentifier(id);
      if (
        !BGTaskScheduler.sharedScheduler.submitTaskRequestError(request, null)
      ) {
        throw new Error('iOS declined background work');
      }
    },
    cancel(id) {
      if (allowed.has(id))
        BGTaskScheduler.sharedScheduler.cancelTaskRequestWithIdentifier(id);
    },
  };
}
