/**
 * The services entry point for hosts and apps: the registry functions, and the
 * ports of the application services every host may provide (storage,
 * lifecycle, connectivity, links, notifications, push, background jobs and
 * network requests).
 *
 * A host installs providers with `installServices`; an app reads a service
 * with `loadService('settings')`, or `useService` where it cannot wait.
 */
export {
  CapabilityError,
  installServices,
  installedServices,
  loadService,
  peekService,
  resetServices,
  serviceAvailable,
  useService,
  type Availability,
  type ProviderMap,
  type ServiceName,
  type ServiceProvider,
  type ServiceProviders,
} from './registry.js';

export type Permission = 'granted' | 'denied' | 'prompt' | 'unavailable';
export interface Store {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export interface NotificationMessage {
  title: string;
  body?: string;
  id?: string;
  data?: Record<string, string>;
}
export interface LifecyclePort {
  active(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}
export interface ConnectivityPort {
  online(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}
export interface LinksPort {
  initial(): string | null;
  subscribe(listener: (link: string) => void): () => void;
}
export interface NotificationsPort {
  permission(): Promise<Permission>;
  request(): Promise<Permission>;
  show(value: NotificationMessage): Promise<void>;
}
export interface PushPort {
  register(publicKey: string): Promise<unknown>;
  unregister(): Promise<void>;
}
export interface JobsPort {
  schedule(id: string): Promise<void>;
}
export interface RequestPort {
  fetch: typeof fetch;
}

declare module './registry.js' {
  interface ServiceProviders {
    settings: Store;
    secureStorage: Store;
    lifecycle: LifecyclePort;
    connectivity: ConnectivityPort;
    links: LinksPort;
    notifications: NotificationsPort;
    push: PushPort;
    jobs: JobsPort;
    request: RequestPort;
  }
}

export function subscribeEvent(
  target: EventTarget,
  type: string,
  listener: EventListener,
) {
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}
