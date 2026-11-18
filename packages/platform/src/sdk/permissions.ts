import type { Permission } from './services.js';
export interface PermissionPort {
  query(): Promise<Permission>;
  request(): Promise<Permission>;
}
/** Prompts for the same capability share a result. Querying never prompts. */
export function createPermissions(
  providers: Readonly<Record<string, PermissionPort>>,
) {
  const pending = new Map<string, Promise<Permission>>();
  return {
    query: (name: string) =>
      Object.prototype.hasOwnProperty.call(providers, name)
        ? providers[name]!.query()
        : Promise.resolve<Permission>('unavailable'),
    request(name: string): Promise<Permission> {
      if (!Object.prototype.hasOwnProperty.call(providers, name))
        return Promise.resolve('unavailable');
      const prior = pending.get(name);
      if (prior) return prior;
      const next = Promise.resolve()
        .then(() => providers[name]!.request())
        .finally(() => pending.delete(name));
      pending.set(name, next);
      return next;
    },
  };
}
