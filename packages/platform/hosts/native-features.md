# Native host features

The phone host uses logical display units, Android system and IME insets, and a native input surface. Import `setSystemBars` from `@solid-multiplatform/platform/android/system` after mount and call its disposer when the screen exits. `lightStatusIcons` and `lightNavigationIcons` describe the glyph color. Android reports bar placement through the viewport.

For a credential form, mount `Controls` around `TextField`, give each editor its own accessible label, and use `purpose="username"`, `"current-password"` or `"new-password"`. Pass `browserControls(form)` on the web or `nativeControls(host.root, host.target)` on mobile. Supply each control's rectangle in the host's logical units. The native/browser field handles composition and autofill. Associated Domains on Apple and Digital Asset Links on Android belong to the app. Grant access through the OS password provider. Store API tokens via secure storage after authentication.

The `/services` entry is the service registry: a host registers providers with `installServices`, and `serviceAvailable` reports capability availability independently of permission. Read a service with `loadService('settings')`, or `useService` where the code cannot wait. The web host installs the browser's providers itself; add `installServices(webAppServices(namespace, registration))` from `/services/web` for settings and, with the optional service worker registration, push and background sync. Permissions must be requested from a user gesture. `mobileServices(namespace, extensions)` from `/services/native` returns the providers for application settings, lifecycle and network reachability, for the app to pass to `installServices`; `desktopServices` and `rokuServices` do the same for their hosts. Plug in `secureStoragePort` with a Keychain/Keystore SecureStorage instance, `localNotificationPort` with LocalNotifications, and `messagingPort` with the app-configured Firebase Messaging instance. The app owns notification delivery and backend tokens. The Android background-job port targets manifest-declared JobService components. The Apple port targets BGAppRefreshTask identifiers already registered with the system. Neither scheduler promises a wall-clock execution time.

The Android phone and Android TV hosts install the device's own services when they start: `androidServices({ form, app })` from `/services/android`, built on platform classes with no plugin. Nothing in them is constructed or loaded until the app first uses a service, and a service the device, the form factor or the app's manifest cannot support is absent, so the SDK reports it `unavailable`. `androidManifestRequirements(services, form)` from the same entry lists the permissions, optional features, `<queries>`, FileProvider and activity attributes each service needs; a service whose permission the manifest does not declare is not offered. `ANDROID_PREVIEW_SERVICES` names the services written but not yet verified on a device, and `ANDROID_TV_PREVIEW_SERVICES` those verified on a phone only; they are offered only with `preview: true`, passed as `runAndroid(loadApp, { services: { preview: true } })`. `mobileServices` still works and, installed by the app, takes precedence for the services it provides.

`node tests/native-device/android-probe.mjs verify --serial emulator-<port> --form phone|tv` builds the probe app, drives every service through the SDK and checks the result from outside the app with adb, restores the device settings it changed and removes the probe. "Verified" below means a passing check in that run on an API 36 emulator; a service is offered by default only on a form where it is verified. On the TV the run used `--shared`, which changes no device-wide setting, so the two rows marked "state only" were checked without toggling the network or night mode.

| Service           | Android phone                           | Android TV                                |
| ----------------- | --------------------------------------- | ----------------------------------------- |
| clipboard         | verified by `verify`                    | verified by `verify`                      |
| share             | verified by `verify`                    | verified by `verify`                      |
| haptics           | verified by `verify`                    | absent (phone only)                       |
| deviceInfo        | verified by `verify`                    | verified by `verify`                      |
| battery           | verified by `verify`                    | preview (the TV emulator has no battery)  |
| memory            | verified by `verify`                    | verified by `verify`                      |
| keepAwake         | verified by `verify`                    | verified by `verify`                      |
| orientation       | verified by `verify`                    | absent (phone only)                       |
| systemBars        | verified by `verify`                    | absent (phone only)                       |
| appReview         | preview (needs Google Play's library)   | absent (phone only)                       |
| openExternal      | verified by `verify`                    | verified by `verify`                      |
| settings          | verified by `verify`                    | verified by `verify`                      |
| secureStorage     | verified by `verify`                    | verified by `verify`                      |
| lifecycle         | verified by `verify`                    | verified by `verify`                      |
| connectivity      | verified by `verify`                    | verified by `verify` (state only)         |
| links             | verified by `verify`                    | verified by `verify`                      |
| notifications     | verified by `verify`                    | absent (phone only)                       |
| jobs              | verified by `verify`                    | verified by `verify`                      |
| locale            | verified by `verify`                    | verified by `verify`                      |
| colorScheme       | verified by `verify`                    | verified by `verify` (state only)         |
| keyEvents         | absent (the phone host has no key port) | preview (shortcuts do not match its keys) |
| biometrics        | preview                                 | absent (phone only)                       |
| camera            | preview                                 | preview                                   |
| fileSystem        | verified by `verify`                    | verified by `verify`                      |
| filePicker        | preview                                 | preview                                   |
| download          | verified by `verify`                    | verified by `verify`                      |
| geolocation       | verified by `verify`                    | preview                                   |
| sensors           | verified by `verify`                    | preview (the TV emulator has no sensors)  |
| maps              | verified by `verify`                    | absent (phone only)                       |
| contacts          | verified by `verify`                    | absent (phone only)                       |
| calendar          | verified by `verify`                    | absent (phone only)                       |
| audio             | verified by `verify`                    | verified by `verify`                      |
| mediaSession      | verified by `verify`                    | verified by `verify`                      |
| fullscreen        | verified by `verify`                    | preview (the TV emulator has no PiP)      |
| mediaCapabilities | verified by `verify`                    | verified by `verify`                      |
| request           | absent                                  | absent                                    |
| push              | absent                                  | absent                                    |
| microphone        | absent                                  | absent                                    |
| thumbnails        | absent                                  | absent                                    |

The optional media entry retains the upstream browser/TV player and session API. The Android phone smoke test used an 8-second H.264/AAC clip in a real Media3 PlayerView, checked the selected audio track and observed advancing time. The native SDK field appeared as an Android EditText with password semantics. A provider being available and a password manager having saved credentials for this app are separate conditions.
