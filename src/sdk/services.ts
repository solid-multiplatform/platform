export type Availability = 'available' | 'unavailable';
export type Permission = 'granted' | 'denied' | 'prompt' | 'unavailable';
export class CapabilityError extends Error {
  constructor(public readonly capability: string) {
    super('Unavailable capability: ' + capability);
    this.name = 'CapabilityError';
  }
}
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
export interface AppServices {
  settings?: Store;
  secureStorage?: Store;
  lifecycle?: {
    active(): boolean;
    subscribe(listener: (active: boolean) => void): () => void;
  };
  connectivity?: {
    online(): boolean;
    subscribe(listener: (online: boolean) => void): () => void;
  };
  links?: {
    initial(): string | null;
    subscribe(listener: (link: string) => void): () => void;
  };
  notifications?: {
    permission(): Promise<Permission>;
    request(): Promise<Permission>;
    show(value: NotificationMessage): Promise<void>;
  };
  push?: {
    register(publicKey: string): Promise<unknown>;
    unregister(): Promise<void>;
  };
  jobs?: { schedule(id: string): Promise<void> };
  request?: typeof fetch;
}
export function services(ports: AppServices) {
  return {
    available(name: keyof AppServices): Availability {
      return ports[name] ? 'available' : 'unavailable';
    },
    use<K extends keyof AppServices>(name: K): NonNullable<AppServices[K]> {
      const value = ports[name];
      if (!value) throw new CapabilityError(name);
      return value;
    },
  };
}
export function subscribeEvent(
  target: EventTarget,
  type: string,
  listener: EventListener,
) {
  target.addEventListener(type, listener);
  return () => target.removeEventListener(type, listener);
}
