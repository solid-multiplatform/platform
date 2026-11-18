# Services (SDK)

A service is a device feature behind a small typed interface, called a port: the clipboard, settings storage, notifications, geolocation. The SDK declares the ports. A host supplies the providers. There is one registry for all of them: `packages/platform/src/sdk/registry.ts`.

Which service is tested on which target is in the [feature matrix](/features.md).

## How the registry works

- A host installs a map of providers once, at start-up, with `installServices`. A provider is the port object itself, or a function that returns it, or a function that returns a promise of it.
- Installing does no work. Nothing is constructed, imported or subscribed until an app first uses that service. An idle scene pays for no service it does not use.
- A service with no installed provider is `unavailable`. SDK functions never fall back to a browser API on their own. On the web it is the web host that installs the browser providers.
- A later install wins over an earlier one for the same service. `installServices` returns a function that removes exactly what that call added.
- Each SDK module adds its ports to the `ServiceProviders` interface by declaration merging. That is why `loadService('clipboard')` is typed once the module that declares `clipboard` is imported.

## Call a service

Most services have SDK functions. Call the function; it finds the port.

```ts
import { writeClipboard } from '@solid-multiplatform/platform/device';
import { CapabilityError } from '@solid-multiplatform/platform/services';

export async function copyLink(url: string): Promise<boolean> {
  try {
    await writeClipboard(url);
    return true;
  } catch (error) {
    if (error instanceof CapabilityError) return false;
    throw error;
  }
}
```

Some services are used through the port itself. Settings storage is one:

```ts
import { loadService } from '@solid-multiplatform/platform/services';

export async function rememberVolume(volume: number): Promise<void> {
  const settings = await loadService('settings');
  await settings.set('volume', String(volume));
}
```

The registry functions, all exported from `@solid-multiplatform/platform/services`:

- `loadService(name)`: a promise of the port. The provider is constructed on first use. Rejects with a `CapabilityError` when no provider is installed.
- `peekService(name)`: the port if it is available without waiting, otherwise `undefined`.
- `useService(name)`: like `peekService`, but throws a `CapabilityError` instead of returning `undefined`.
- `serviceAvailable(name)`: `'available'` or `'unavailable'`. It does not construct the provider.
- `installedServices()`: the sorted names of every installed service.
- `installServices(providers)` and `resetServices()`: for hosts and tests.

## Availability and `CapabilityError`

Check before you draw a button for a feature:

```ts
import { serviceAvailable } from '@solid-multiplatform/platform/services';
// The module that declares the clipboard port.
import '@solid-multiplatform/platform/device';

export const canCopy = () => serviceAvailable('clipboard') === 'available';
```

`CapabilityError` has a `capability` field with the name of the missing service. It is thrown when the service has no provider, and a provider may also throw it for one operation it cannot do on this device.

Availability is not permission. A service can be available and the user can still refuse the prompt.

A few SDK functions degrade on purpose instead of throwing. `share()` copies the payload to the clipboard and resolves with `'copied'` where there is no share sheet. The function's comment in the source says so when it does.

## Permissions

`Permission` is `'granted' | 'denied' | 'prompt' | 'unavailable'`.

- A port that needs the user's consent exposes it. `notifications` has `permission()` and `request()` next to `show()`.
- `createPermissions(providers)` from `@solid-multiplatform/platform/permissions` groups permission ports under names. `query(name)` never prompts. Concurrent `request(name)` calls share one prompt. An unknown name resolves to `'unavailable'`.
- `androidPermission(name)` from `@solid-multiplatform/platform/permissions/android` is the Android port for one manifest permission. The app declares the permission in its manifest.
- Request from a user gesture. Browsers allow the clipboard, the share sheet, fullscreen, file pickers, the notification prompt and the camera and microphone prompts only while handling one. The registry keeps the gesture: when a port is already loaded, the SDK function calls it in the same turn as your call, with no tick in between. The web host installs the gesture-bound providers eagerly for that reason.

## The services

Each name is a key of `ServiceProviders`. The module is where the port is declared; import its subpath to use the SDK functions and get the types.

Declared in `src/sdk/device.ts` (`@solid-multiplatform/platform/device`):

- `clipboard`, `share`, `haptics`, `deviceInfo`, `battery`, `memory`, `keepAwake`, `openExternal`, `orientation`, `systemBars`, `appReview`

Declared in `src/sdk/services.ts` (`@solid-multiplatform/platform/services`):

- `settings`, `secureStorage`, `lifecycle`, `connectivity`, `links`, `notifications`, `push`, `jobs`, `request`

Media and files:

- `mediaSession`, `fullscreen`, `thumbnails`: `src/sdk/media.ts` (`/media`)
- `audio`: `src/sdk/audio.ts` (`/audio`)
- `mediaCapabilities`: `src/sdk/drm.ts` (`/drm`)
- `camera`, `microphone`: `src/sdk/capture.ts` (`/capture`)
- `fileSystem`, `filePicker`: `src/sdk/files.ts` (`/files`)
- `download`: `src/sdk/download.ts` (`/download`)

Location, sensors and personal data:

- `geolocation`: `src/sdk/geolocation.ts` (`/geolocation`)
- `sensors`: `src/sdk/sensors.ts` (`/sensors`)
- `maps`: `src/sdk/maps.ts` (`/maps`)
- `contacts`: `src/sdk/contacts.ts` (`/contacts`)
- `calendar`: `src/sdk/calendar.ts` (`/calendar`)
- `biometrics`: `src/sdk/biometrics.ts` (`/biometrics`)

App shell:

- `locale`: `src/sdk/i18n.ts` (`/i18n`)
- `colorScheme`: `src/sdk/theme.tsx` (`/theme`)
- `keyEvents`: `src/sdk/shortcuts.ts` (`/shortcuts`)
- `menus`: `src/sdk/menus.ts` (`/menus`)
- `updateDelivery`, `updateSource`: `src/sdk/update.ts` (`/update`)

## Providers on the web

The web host (`src/hosts/web.ts`) installs `webServices` and `webAppServices(namespace)` from `@solid-multiplatform/platform/services/web`. The manifests under `src/hosts/web-services/` list what the browser provides:

- `device.manifest.ts`: `clipboard`, `share`, `openExternal`, `orientation`, `keepAwake`, `notifications`, `memory`, `systemBars`, `locale`, `colorScheme`, `keyEvents` (eager); `haptics`, `deviceInfo`, `battery`, `lifecycle`, `connectivity`, `links`, `request` (loaded on first use).
- `media.manifest.ts`: `audio`, `fullscreen`, `filePicker`, `download`, `camera`, `microphone`, `mediaSession` (eager); `thumbnails`, `mediaCapabilities` (loaded on first use).
- `sensors.manifest.ts`: `geolocation`, `sensors`.
- `webAppServices(namespace, worker?)`: `settings` always. With a service worker registration, `notifications` go through the worker, and `push` and `jobs` are present where the worker supports them.

Not provided in a browser: `appReview`, `secureStorage`, `fileSystem`, `maps`, `updateDelivery`, `updateSource`, `contacts`, `calendar`, `biometrics`, `menus`. They report `unavailable` there. For maps and update delivery the SDK opens a link through `openExternal` instead.

An app with a service worker adds the worker-backed providers itself:

```ts
import { installServices } from '@solid-multiplatform/platform/services';
import { webAppServices } from '@solid-multiplatform/platform/services/web';

export async function installWorkerServices(): Promise<() => void> {
  const registration = await navigator.serviceWorker.ready;
  return installServices(webAppServices('my-app', registration));
}
```

## Providers on other targets

The other hosts return provider maps for the app to pass to `installServices`:

- `mobileServices(namespace, extensions)` from `@solid-multiplatform/platform/services/native` for Android and Apple targets.
- `desktopServices` from `@solid-multiplatform/platform/services/desktop`.
- `rokuServices(section)` from `@solid-multiplatform/platform/services/roku`. It provides `settings`.

These exist on `main` but most have no automated test on their target; the [feature matrix](/features.md) marks them `preview`. Native Android providers for more services are in progress in an open pull request.

## Add a service

1. Declare the port interface in an SDK module and add it to `ServiceProviders` by declaration merging, as `src/sdk/geolocation.ts` does.
2. Write the SDK function with `withService(name, (port) => ...)` from `src/sdk/registry.ts`. Do not call a browser API from `src/sdk`.
3. Add a provider to a host. On the web, add it to the matching manifest; make it eager only if it needs the user's gesture or a synchronous SDK function reads it.
4. Add a contract test with a fake port (`tests/contract-*.test.ts`), and a test on a real target before you mark the feature `tested` in `docs/features.json`.
