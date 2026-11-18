# Functional application feature matrix

This document defines what "a functional application" means for Solid Multiplatform. It is the implementation backlog for the beta. Features are derived from established frameworks and platform guidance, not invented per app:

- [React Native core components and APIs](https://reactnative.dev/docs/components-and-apis), [KeyboardAvoidingView](https://reactnative.dev/docs/keyboardavoidingview), [Modal](https://reactnative.dev/docs/modal), [ScrollView](https://reactnative.dev/docs/scrollview), [FlatList](https://reactnative.dev/docs/flatlist)
- [Flutter widget catalog](https://docs.flutter.dev/ui/widgets), [MediaQuery viewInsets](https://api.flutter.dev/flutter/widgets/MediaQueryData/viewInsets.html), [Scaffold.resizeToAvoidBottomInset](https://api.flutter.dev/flutter/material/Scaffold/resizeToAvoidBottomInset.html), [ScrollBehavior.dragDevices](https://api.flutter.dev/flutter/widgets/ScrollBehavior/dragDevices.html), [showDialog](https://api.flutter.dev/flutter/material/showDialog.html)
- [Android window insets and IME animation](https://developer.android.com/develop/ui/views/layout/sw-keyboard), [edge-to-edge](https://developer.android.com/develop/ui/views/layout/edge-to-edge), [Android TV quality](https://developer.android.com/docs/quality-guidelines/tv-app-quality)
- [Apple safeAreaInsets](https://developer.apple.com/documentation/uikit/uiview/safeareainsets) and [safeAreaLayoutGuide](https://developer.apple.com/documentation/uikit/uiview/safearealayoutguide)
- [Expo SDK modules](https://docs.expo.dev/versions/latest/) and [Capacitor official plugins](https://capacitorjs.com/docs/apis) for the device-service surface
- [Tauri features](https://v2.tauri.app/plugin/) for desktop window, menu, tray, updater, deep links and single-instance behavior
- [Roku certification criteria](https://developer.roku.com/dev/docs/certification)
- [WCAG 2.2 for mobile applications](https://www.w3.org/TR/wcag2mobile-22/) and the [MDN mobile accessibility checklist](https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Mobile_accessibility_checklist)

Status: **S** shipped and exercised, **P** partial, **M** missing.

## 1. Authoring, tooling and delivery

| Feature                                     | Established pattern                                | Status | Evidence / gap                                                             | Phase |
| ------------------------------------------- | -------------------------------------------------- | ------ | -------------------------------------------------------------------------- | ----- |
| Project init and target selection           | Expo `create-expo-app`, Flutter `create`           | S      | `cli/init.mjs`, `cli/main.mjs`                                             | —     |
| Screen/component variants per target        | Flutter platform folders, RN `.ios/.android` files | S      | `cli/variants.mjs`, `tests/cli/variants.test.mjs`, `screens/Home.*`        | —     |
| Plugin scaffolding (Kotlin, Swift, C, Roku) | Tauri plugin template, Expo Modules                | S      | `cli/templates`, `android-smoke.sh`, `apple-smoke.sh`                      | —     |
| Build/run/package commands                  | Expo CLI, Tauri CLI                                | S      | `cli/build.mjs`, `cli/desktop-package.mjs`                                 | —     |
| Target explain/check                        | Flutter `flutter analyze`                          | S      | `solid-platform explain`, `check`                                          | —     |
| Dev server and hot reload                   | Vite/Expo                                          | P      | Vite dev works; no state-preserving hot reload contract documented         | 10    |
| Asset pipeline (images, fonts, icons)       | Expo Asset, Flutter pubspec assets                 | P      | Fonts and images load; no manifest/optimisation pipeline                   | 10    |
| Environment/config injection                | Expo `app.config`, Vite env                        | M      | No first-class API                                                         | 4     |
| Generated type-safe routes                  | Expo Router typed routes                           | M      | Navigation is string-based                                                 | 2     |
| Debug inspector / component tree            | RN DevTools, Flutter Inspector                     | M      | Dev overlay and JSX locator exist only as stubs                            | 10    |
| Error boundaries                            | React error boundaries                             | S      | `AppErrorBoundary` with `ListState` fallback and retry                     | —     |
| Structured logging and tracing              | Expo/Flutter logging                               | M      | Trace markers exist in fixtures only                                       | 10    |
| Crash reporting hook                        | Sentry/Crashlytics integration point               | S      | `setCrashReporter`/`reportCrash`; `AppErrorBoundary` reports render errors | —     |
| Release signing/notarization hooks          | Tauri/Expo build profiles                          | P      | Manual per platform; documented in workflows                               | 10    |
| OTA/update channel                          | Tauri updater, Expo Updates                        | M      | No API                                                                     | 5     |

## 2. Layout, rendering and visual system

| Feature                                     | Established pattern                             | Status | Evidence / gap                                                     | Phase |
| ------------------------------------------- | ----------------------------------------------- | ------ | ------------------------------------------------------------------ | ----- |
| Flex row/column                             | Yoga/Flexbox, Flutter Row/Column                | S      | `src/core/flex*`, contract tests                                   | —     |
| Grid                                        | CSS grid, Flutter GridView                      | S      | `Grid`, `VirtualGrid`                                              | —     |
| Absolute positioning and z-order            | CSS position/z-index                            | S      | `x/y/zIndex`, paint-order tests                                    | —     |
| Min/max sizing, aspect ratio                | CSS min/max/aspect-ratio                        | P      | Check coverage in `contract-flex`; aspect ratio not first-class    | 1     |
| Padding/margin/borders                      | CSS box model                                   | S      | `borderBox`, contract tests                                        | —     |
| Border radius                               | CSS radius, Flutter BorderRadius                | P      | Verify per backend; document limits                                | 1     |
| Clipping and overflow                       | CSS overflow, Flutter clipBehavior              | S      | Flex clipping/culling                                              | —     |
| Safe-area-aware layout                      | iOS safe area, Android insets, Flutter SafeArea | S      | `viewport().insets` + `SafeArea` primitive                         | —     |
| RTL and writing direction                   | CSS direction, I18nManager                      | M      | No direction contract                                              | 8     |
| Responsive breakpoints                      | CSS media queries, Flutter LayoutBuilder        | P      | Viewport signals exist; no breakpoint helper                       | 1     |
| Text wrapping, ellipsis, truncation         | CSS text-overflow, Flutter Text                 | P      | Text layout exists; verify ellipsis/maxLines                       | 1     |
| Rich text / inline spans                    | RN Text nesting, Flutter TextSpan               | P      | Text nodes exist; no documented span API                           | 1     |
| Custom fonts and fallbacks                  | CSS @font-face, Flutter FontLoader              | S      | MSDF font loading, font tests                                      | —     |
| Image fit/placeholder/lazy decode           | RN Image, Flutter Image                         | P      | `Image` placeholder/load; no visibility-driven deferral            | 3     |
| SVG and icons                               | react-native-svg, Flutter vector                | M      | No SVG primitive                                                   | 9     |
| Gradients, shaders, blur                    | CSS gradients/filters, Skia                     | P      | Shaders and blurred-image helper exist; no high-level API          | 9     |
| Opacity and alpha blending                  | CSS opacity/blend                               | S      | Contract and visual tests                                          | —     |
| Shadows and elevation                       | CSS box-shadow, Material elevation              | M      | No shadow primitive                                                | 9     |
| Transforms                                  | CSS transform                                   | P      | `scale` exists; rotation/translation coverage to document          | 1     |
| Theme tokens (color, type, spacing, motion) | Material Theme, Tailwind, SwiftUI Environment   | S      | `ThemeProvider`, `useTheme`, light/dark palettes                   | —     |
| Light/dark/system color scheme              | RN `useColorScheme`, Flutter ThemeMode          | P      | `useColorScheme`; web/Android/iOS hosts; desktop defaults to light | 0     |
| Idle frame scheduling                       | Flutter/RN frame callbacks                      | S      | Renderer sleeps when idle; fast harness uses it                    | —     |
| Frame pacing and trace markers              | Android FrameTimeline                           | S      | Three-pass gate and `quick-android.py`                             | —     |
| Virtualization and culling                  | FlatList, Flutter ListView.builder              | S      | `Virtual`, `VirtualGrid`, `Lazy`                                   | —     |

## 3. Input, gestures and focus

| Feature                          | Established pattern                        | Status | Evidence / gap                                                                        | Phase |
| -------------------------------- | ------------------------------------------ | ------ | ------------------------------------------------------------------------------------- | ----- |
| Remote/D-pad navigation          | Android TV D-pad, Roku remote              | S      | Focus manager, TV templates, gate fixture                                             | —     |
| Gamepad input                    | Android gamepad keys                       | M      | No mapping                                                                            | 9     |
| Physical keyboard                | Tab/arrows/Enter/Escape                    | P      | Tab/arrows/Enter work; no documented shortcut layer                                   | 3     |
| Mouse hover/press/click          | Pointer Events                             | S      | Web pointer binding; SDL3 pointer/mouse mapping + `useMouse()` in the desktop starter | —     |
| Mouse drag and wheel             | Pointer Events, wheel                      | S      | `dragToScroll`, `wheelToScroll`; `createInputScope` drag/wheel on native and web      | —     |
| Touch multi-point                | Pointer Events, Android MotionEvent        | S      | `bindSceneTouch`, pointer IDs                                                         | —     |
| Pointer capture and cancellation | Pointer Events `setPointerCapture`         | S      | Web binding; mobile cancel                                                            | —     |
| Long press and key repeat        | RN Pressable, Android key repeat           | S      | `useHold`, input hold, KeyBridge repeat                                               | —     |
| Focus states and visible focus   | CSS :focus-visible, TV focus               | S      | `$focus`, focus manager tests                                                         | —     |
| Spatial/directional focus        | TV/console navigation                      | S      | `handleNavigation`, focus manager                                                     | —     |
| Focus restoration and stack      | Flutter Navigator, focus stack             | P      | `createFocusStack` is manual; no route integration                                    | 2     |
| Focus trap / modal containment   | Flutter DialogRoute closedLoop, ARIA modal | S      | `pushFocusTrap` in the focus manager; `Modal` installs it for its panel               | —     |
| IME composition and text editing | RN TextInput, native editors               | S      | Native editor + desktop editor; mobile smoke                                          | —     |
| Hardware back                    | Android BackHandler, Roku Back             | P      | TV back works; no app-wide back contract                                              | 2     |
| Media transport keys             | Android TV media keys, Roku                | P      | TV fixture handles play/pause; no shared API                                          | 9     |
| Drag and drop files              | Desktop/web DnD                            | M      | No API                                                                                | 9     |
| Pointer cursor styles            | CSS cursor                                 | S      | `cursorStyle` on elements, `useCursor`/`setCursor`; applied by `useMouse`             | —     |
| Pinch/rotate gestures            | Pointer Events multi-touch                 | M      | Not required for beta; document as non-goal                                           | —     |

## 4. Controls, forms and editing

| Feature                       | Established pattern                         | Status | Evidence / gap                                                                               | Phase |
| ----------------------------- | ------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- | ----- |
| Text and labels               | RN Text, Flutter Text                       | S      | Text node, contract tests                                                                    | —     |
| Buttons                       | RN Button/Pressable                         | S      | TV/web templates, controls                                                                   | —     |
| Switch/toggle                 | RN Switch, Flutter Switch                   | S      | `Toggle`, native/web controls                                                                | —     |
| Checkbox and radio            | Material/Flutter                            | M      | No primitive                                                                                 | 9     |
| Slider and progress           | RN Slider/Progress                          | S      | `Slider`, `Progress`, native controls                                                        | —     |
| Single-line text field        | RN TextInput                                | S      | Native/desktop/web editors                                                                   | —     |
| Multiline text area           | RN multiline                                | P      | Verify native editor supports multiline                                                      | 1     |
| Password masking and autofill | Android autofill, Apple Password AutoFill   | S      | `purpose`, password smoke tested                                                             | —     |
| Keyboard types and return key | RN keyboardType/returnKeyType               | P      | Email/password handled; full matrix missing                                                  | 1     |
| Validation and error messages | HTML constraint validation, Flutter Form    | P      | `createForm` validation, touched state and per-field errors; no rendered field component yet | 1     |
| Focus traversal inside forms  | HTML tab order, Flutter FocusTraversal      | P      | Tab works globally; no form grouping                                                         | 1     |
| Date/time picker              | RN community datetimepicker                 | M      | No primitive                                                                                 | 9     |
| Select/picker                 | RN Picker, Flutter Dropdown                 | M      | No primitive                                                                                 | 9     |
| Search field                  | Flutter SearchBar                           | M      | No primitive                                                                                 | 9     |
| File/image picker             | Expo ImagePicker/DocumentPicker             | M      | No app-facing API                                                                            | 5     |
| Clipboard                     | Expo Clipboard, Capacitor Clipboard         | S      | `readClipboard`/`writeClipboard` with host port and web fallback                             | —     |
| Loading/submitting states     | Flutter Form/Button state                   | P      | `createForm().submitting` plus per-app disabled state                                        | 1     |
| Input above keyboard          | RN KeyboardAvoidingView, Flutter viewInsets | S      | `KeyboardAvoidingView` + keyboard-aware mobile template                                      | —     |
| Auto-reveal focused field     | Flutter ensureVisible, Android adjustResize | P      | `revealAboveKeyboard` and `keyboardAwareBounds`; native editor wiring remains app-owned      | 1     |

## 5. Navigation and presentation

| Feature                          | Established pattern                           | Status | Evidence / gap                                                                                | Phase |
| -------------------------------- | --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- | ----- |
| Stack navigation                 | React Navigation, Flutter Navigator           | S      | `createNavigation` push/replace/back/reset with `subscribe`                                   | —     |
| Tabs                             | React Navigation tabs, Flutter TabBar         | S      | `createTabNavigation` with independent per-tab stacks and snapshots                           | —     |
| Drawer                           | Flutter Drawer                                | S      | `Drawer` on the shared Modal: edge panel, barrier, safe area, focus trap                      | —     |
| URL/history integration (web)    | History API                                   | S      | `createBrowserNavigation`/`bindBrowserHistory`: pushState, replaceState, popstate, base paths | —     |
| Deep links / universal links     | Tauri deep-link, Expo Linking                 | S      | `bindDeepLinks` + `routeFromUrl` feed the `links` port into navigation                        | —     |
| Route guards/auth gating         | React Navigation guards                       | S      | `beforeEach` and `beforeBack` guards cancel stack changes                                     | —     |
| State restoration                | React Navigation state persistence            | S      | `snapshot()`/`restore()` for a stack and for every tab                                        | —     |
| Modal/dialog                     | RN Modal, Flutter showDialog                  | S      | `Modal`: portal, barrier, Back/Escape, safe area, focus trap and restore                      | —     |
| Bottom sheet                     | Flutter showModalBottomSheet                  | S      | `Sheet` built on `Modal` (barrier, safe area, keyboard avoidance, focus restore)              | —     |
| Popover/menu/context menu        | Radix, Flutter MenuAnchor                     | S      | `Popover` and `Menu` with anchored placement, safe-area flip and barrier dismissal            | —     |
| Toast/snackbar                   | RN ToastAndroid, Flutter SnackBar             | S      | `Toast` with duration, action and safe-area/keyboard anchoring                                | —     |
| Tooltip                          | Flutter Tooltip                               | S      | `Tooltip` anchored, non-modal, safe-area aware                                                | —     |
| Alert/confirm                    | RN Alert, native dialogs                      | S      | `Alert` with title, message, cancel/confirm on the shared Modal                               | —     |
| Back/escape/barrier dismiss      | RN onRequestClose, Flutter barrierDismissible | S      | Shared by `Modal`, `Sheet`, `Alert`, `Popover` and `Menu`                                     | —     |
| Transition animations            | Flutter page transitions                      | P      | Animation primitives exist; no route transitions                                              | 2     |
| Focus/scroll restoration on back | React Navigation                              | M      | None                                                                                          | 2     |

## 6. Lists, data and async UI

| Feature                      | Established pattern             | Status | Evidence / gap                                                       | Phase |
| ---------------------------- | ------------------------------- | ------ | -------------------------------------------------------------------- | ----- |
| Flat/vertical list           | FlatList, ListView              | S      | `Virtual`, templates                                                 | —     |
| Section list                 | RN SectionList                  | M      | No primitive                                                         | 6     |
| Grid list                    | Flutter GridView                | S      | `VirtualGrid`                                                        | —     |
| Windowed rendering           | FlatList windowSize             | S      | `Virtual`, `Lazy` buffer                                             | —     |
| Lazy route/component loading | React.lazy, Flutter deferred    | S      | `lazy()`                                                             | —     |
| Infinite scroll/pagination   | FlatList onEndReached           | S      | `createPagedList` + `Virtual` `onEndReached`/`scrollIndex`           | —     |
| Pull to refresh              | RN RefreshControl               | S      | `createPullToRefresh` threshold gesture + `createPagedList.refresh`  | —     |
| Sticky headers               | Flutter SliverAppBar            | M      | No primitive                                                         | 6     |
| Swipe actions                | Flutter Dismissible             | M      | No primitive                                                         | 6     |
| Reorder/drag                 | Flutter ReorderableListView     | M      | No primitive                                                         | 6     |
| Selection/multi-select       | Flutter/React patterns          | S      | `createSelection` single/multiple with custom equality               | —     |
| Empty/loading/error states   | Flutter/React patterns          | S      | `ListState` loading/empty/error view with optional action            | —     |
| Async resource/Suspense      | Solid resources, React Suspense | S      | `createQuery`: data/loading/error, retry/backoff, staleTime, refetch | —     |
| Global store and persistence | Redux/Zustand, Flutter provider | S      | `createPersistentStore` over the `settings`/`secureStorage` ports    | —     |
| Offline queue and retry      | React Query/SWR                 | S      | `createOfflineQueue`: durable FIFO, connectivity-triggered retry     | —     |
| Cache invalidation           | React Query                     | S      | `invalidateQueries`, `setQueryData`, keyed `createQuery` cache       | —     |

## 7. Device, platform and app services

| Feature                                | Established pattern                         | Status | Evidence / gap                                                   | Phase |
| -------------------------------------- | ------------------------------------------- | ------ | ---------------------------------------------------------------- | ----- |
| Lifecycle (active/background)          | RN AppState, Flutter AppLifecycleState      | S      | `AppServices.lifecycle`, host bindings                           | —     |
| Orientation lock                       | Expo ScreenOrientation                      | S      | `lockOrientation` with a host port or Screen Orientation API     | —     |
| Status/navigation bars                 | Capacitor StatusBar/SystemBars              | P      | `setSystemBars` visibility/icons; no background color            | 5     |
| Keyboard inset and visibility          | Android IME insets, iOS notifications       | S      | `viewport().keyboardInset`                                       | —     |
| Safe area and display cutout           | Apple safeAreaInsets, Android displayCutout | S      | `safeArea` per edge                                              | —     |
| Dark/light/system theme                | RN useColorScheme                           | S      | `ThemeProvider`, `useTheme`, `useColorScheme`                    | —     |
| Text scaling / accessibility font size | iOS Dynamic Type, Android sp                | S      | `setTextScale` scales theme typography and `scaled()` tokens     | —     |
| Reduce motion                          | iOS/Android/Web                             | S      | `reducedMotion` in viewport                                      | —     |
| Locale and i18n                        | i18next, Flutter intl                       | S      | `setupI18n`/`createI18n` with locale fallback and interpolation  | —     |
| RTL layout                             | CSS direction, I18nManager                  | S      | `isRTL`, `textDirection`, `dir()` and document `dir`/`lang` sync | —     |
| Haptics                                | Expo Haptics, Capacitor Haptics             | S      | `impact`/`vibrate` with host port and Vibration API fallback     | —     |
| Clipboard                              | Expo/Capacitor                              | S      | `readClipboard`/`writeClipboard` with host port and web fallback | —     |
| Share sheet                            | RN Share, Capacitor Share                   | S      | `share` with host port, Web Share and clipboard fallback         | —     |
| Local notifications                    | Expo/Capacitor LocalNotifications           | S      | `notifications` port + host                                      | —     |
| Push notifications                     | Expo/Capacitor PushNotifications            | P      | `push` port exists; no end-to-end flow                           | 5     |
| Permissions                            | Expo/Capacitor Permissions                  | S      | `createPermissions`, host ports                                  | —     |
| Capability registry                    | Expo modules `isAvailableAsync`             | S      | `src/sdk/capabilities.ts` (`setCapabilities`, `supports`)        | —     |
| Connectivity state                     | NetInfo, Capacitor Network                  | S      | `connectivity` port                                              | —     |
| HTTP client and cancellation           | fetch/axios, Tauri HTTP                     | S      | `network.ts`, host adapters                                      | —     |
| Preferences/settings                   | AsyncStorage, Capacitor Preferences         | S      | `settings` store                                                 | —     |
| Secure storage                         | Keychain/Keystore                           | S      | `secureStorage` port + native                                    | —     |
| File system                            | Expo FileSystem, Capacitor Filesystem       | M      | Native modules exist for plugins; no app API                     | 5     |
| Background jobs                        | Expo BackgroundTask, WorkManager            | P      | `jobs` port + native registries                                  | 5     |
| Device info                            | Expo Device                                 | S      | `deviceInfo` with host port and web fallback                     | —     |
| Battery/power state                    | Expo Battery                                | S      | `batteryState` with host port and Battery Status API             | —     |
| Keep awake / screen lock               | Expo KeepAwake                              | S      | `keepAwake` with host port and Screen Wake Lock API              | —     |
| Biometrics/local auth                  | Expo LocalAuthentication                    | M      | No API                                                           | 5     |
| Geolocation                            | Expo Location, Capacitor Geolocation        | M      | No API                                                           | 5     |
| Camera                                 | Expo Camera/ImagePicker                     | M      | No API                                                           | 5     |
| Microphone/recording                   | Expo Audio                                  | M      | No API                                                           | 7     |
| Contacts/calendar                      | Expo Contacts/Calendar                      | M      | Deferred; optional                                               | —     |
| Sensors                                | Expo Sensors                                | M      | Deferred; optional                                               | —     |
| Maps                                   | Expo Maps                                   | M      | Deferred; optional                                               | —     |
| In-app browser / external opener       | Expo WebBrowser, Tauri Opener               | S      | `openExternal` with host port and window.open fallback           | —     |
| App/store review                       | Expo StoreReview                            | M      | Deferred; optional                                               | —     |

## 8. Media

| Feature                     | Established pattern             | Status | Evidence / gap                                       | Phase |
| --------------------------- | ------------------------------- | ------ | ---------------------------------------------------- | ----- |
| Image display and fit       | RN Image resizeMode             | S      | `Image`, gallery fixture                             | —     |
| Video playback              | Media3/AVPlayer/HTML/Roku Video | S      | optional video module, device gate                   | —     |
| Audio playback              | Expo Audio                      | P      | Video module handles audio tracks; no audio-only API | 7     |
| Captions/subtitles          | Media3/AVPlayer/Roku            | S      | native caption verified                              | —     |
| Audio/text track selection  | Media3                          | S      | video adapters                                       | —     |
| Playback controls/transport | Media3 custom layout            | S      | video module                                         | —     |
| Resume/bookmarks            | Roku uses bookmarks             | M      | No shared API                                        | 7     |
| Fullscreen/PiP              | AVPlayer/Media3/HTML            | M      | No API                                               | 7     |
| Media session / now playing | Android MediaSession            | M      | No API                                               | 7     |
| Keep awake during playback  | FLAG_KEEP_SCREEN_ON             | P      | Native video handles it; no app API                  | 7     |
| Video thumbnails            | Expo VideoThumbnails            | M      | No API                                               | 7     |
| DRM/capability reporting    | Media3/AVPlayer                 | P      | Capability fields exist; no DRM probe                | 7     |
| HLS/DASH                    | Media3/hls.js                   | S      | video dependencies                                   | —     |

## 9. Accessibility and internationalization

| Feature                         | Established pattern                  | Status | Evidence / gap                                                          | Phase |
| ------------------------------- | ------------------------------------ | ------ | ----------------------------------------------------------------------- | ----- |
| Roles, labels, values, actions  | ARIA, UIAccessibility, TalkBack      | S      | `browserSemantics` covers 24 roles, state, value, level and description | —     |
| Reading/focus order             | WCAG 2.4.3                           | S      | `readingOrder()` sorts rows by direction                                | —     |
| Visible focus                   | WCAG 2.4.7                           | S      | `$focus` states                                                         | —     |
| Modal semantics / hide siblings | aria-modal, accessibilityViewIsModal | M      | None                                                                    | 2     |
| Live announcements              | aria-live, UIAccessibility.post      | S      | announcer primitives                                                    | —     |
| Touch targets ≥44pt/48dp        | Apple HIG, Material                  | S      | `MIN_TOUCH_TARGET`, `meetsTouchTarget`, `ensureTouchTarget`             | —     |
| Gesture alternatives            | WCAG 2.5.1                           | P      | Not enforced                                                            | 8     |
| Text scaling                    | Dynamic Type, sp                     | S      | `setTextScale` + theme typography scaling                               | —     |
| High contrast                   | WCAG 1.4.11                          | S      | `setHighContrast`, high-contrast light/dark palettes                    | —     |
| Reduced motion                  | WCAG 2.3.3                           | S      | `reducedMotion`                                                         | —     |
| RTL mirroring                   | CSS direction, I18nManager           | S      | `dir()` and document direction; `readingOrder` accepts RTL              | —     |
| Translations/pluralization      | i18next, Flutter intl                | S      | `t()` with `Intl.PluralRules` categories and `{param}` interpolation    | —     |
| Locale-aware dates/numbers      | Intl                                 | S      | `formatNumber`, `formatDate`, `formatRelativeTime`, `formatList`        | —     |

## 10. Performance, reliability and quality

| Feature                  | Established pattern        | Status | Evidence / gap                                                             | Phase |
| ------------------------ | -------------------------- | ------ | -------------------------------------------------------------------------- | ----- |
| Startup measurement      | Roku 15s, Flutter startup  | S      | Android launch time recorded                                               | —     |
| Frame pacing gate        | Android FrameTimeline      | S      | three ten-minute passes, zero misses                                       | —     |
| Idle frame scheduling    | Flutter frame callbacks    | S      | event-driven loop                                                          | —     |
| Image decode budgets     | Flutter image cache        | P      | renderer upload budget exists; no app API                                  | 9     |
| List recycling           | FlatList/ListView.builder  | S      | `Virtual`, `Lazy`                                                          | —     |
| Memory budgets / low-RAM | Android `isLowRamDevice`   | M      | No signal                                                                  | 9     |
| Error boundaries         | React/Solid                | S      | `AppErrorBoundary` with `ListState` fallback and retry                     | —     |
| Crash reporting hook     | Sentry/Crashlytics         | S      | `setCrashReporter`/`reportCrash`; `AppErrorBoundary` reports render errors | —     |
| Offline/retry            | React Query                | S      | `createOfflineQueue` with persisted items and retry                        | —     |
| State persistence        | React Navigation persist   | S      | `createPersistentStore` snapshot persistence                               | —     |
| Version/update check     | Tauri updater              | M      | No API                                                                     | 5     |
| Profiling overlay        | RN/Flutter DevTools        | P      | FPSCounter primitive                                                       | 10    |
| Automated a11y audit     | axe, Accessibility Scanner | S      | `auditSemantics()` for labels, roles, values and touch targets             | —     |
| Visual regression        | screenshot tests           | S      | `tests/visual`, TV pixel audit                                             | —     |
| Device smoke matrices    | CI                         | S      | Android TV, Apple simulator, desktop probe, browser smoke                  | —     |

## 11. Platform-specific requirements

### Web

| Feature                       | Status | Gap                                         |
| ----------------------------- | ------ | ------------------------------------------- |
| Pointer/touch/keyboard        | S      | —                                           |
| Responsive resize             | S      | —                                           |
| History/routing               | S      | `createBrowserNavigation` (History API)     |
| PWA/offline                   | M      | No service-worker/offline contract          |
| Clipboard/share/notifications | P      | Browser services partially exposed          |
| File input/download           | M      | No API                                      |
| Browser TV (Chromium 85)      | S      | Tizen/webOS/Vizio generated builds verified |

### Android phone / tablet

| Feature                          | Status | Gap                       |
| -------------------------------- | ------ | ------------------------- |
| Touch, lifecycle, insets         | S      | —                         |
| Native editor, password autofill | S      | —                         |
| Status/navigation bars           | P      | No background color       |
| Rotation/reflow                  | S      | Regression test           |
| Back gesture                     | P      | App-wide contract missing |
| Permissions/notifications        | S      | Ports exist               |
| Camera/file/biometrics           | M      | No app API                |

### Android TV

| Feature                           | Status | Gap                       |
| --------------------------------- | ------ | ------------------------- |
| D-pad focus, overscan, 10-foot UI | S      | —                         |
| Media keys, playback              | S      | Video module              |
| Frame pacing gate                 | S      | Zero-miss passes recorded |
| Ambient mode / keep awake         | P      | Video only                |
| Deep linking                      | M      | No TV router integration  |

### Apple (iOS / iPadOS / tvOS)

| Feature                            | Status | Gap                                                          |
| ---------------------------------- | ------ | ------------------------------------------------------------ |
| NativeScript hosts, touch, plugins | S      | CI simulator evidence                                        |
| Safe area / keyboard               | S      | —                                                            |
| Dynamic Island                     | P      | Covered by safe-area top inset; no separate rect (by design) |
| Push/background tasks              | P      | Ports exist; end-to-end flow missing                         |
| Apple TV focus/remote              | P      | Build/tested, no physical device                             |
| Signing/distribution               | M      | App-owned identity required                                  |

### Desktop (Linux / Windows / macOS)

| Feature                                | Status | Gap                                           |
| -------------------------------------- | ------ | --------------------------------------------- |
| SDL3 window, GL, text, resize          | S      | Linux/X11 + CI Windows/macOS first frame      |
| Keyboard and IME                       | S      | —                                             |
| Scene mouse hover/press/click/drag     | M      | Pointer events reach host but not scene nodes |
| Native menus/tray                      | M      | No API                                        |
| File dialogs / drag-drop files         | M      | No API                                        |
| Window state persistence               | M      | No API                                        |
| Single instance / deep links / updater | M      | No API                                        |
| Accessibility (AccessKit)              | P      | Bridge exists; audit pending                  |
| Keyboard shortcuts/accelerators        | M      | No API                                        |

### Roku

| Feature                                                        | Status | Gap                              |
| -------------------------------------------------------------- | ------ | -------------------------------- |
| SceneGraph host, focus, remote                                 | S      | —                                |
| BrighterScript plugin preset                                   | S      | CLI template                     |
| Registry/storage/tasks                                         | S      | `roku/storage`, `roku/tasks`     |
| Video/captions/trick play                                      | P      | Video node integration partial   |
| Deep linking / roInputEvent                                    | M      | No router integration            |
| Voice keyboard/PIN                                             | P      | Native text dialog bridge exists |
| Certification budgets (15s launch, 3s scenes, 250ms keys, 4MB) | P      | No automated gate                |

## 12. Implementation phases

Progress: Phase 0 is implemented (theme tokens, colour scheme, capability registry, extended inset contract). Phase 1 is implemented for `useKeyboard`, `KeyboardAvoidingView`, `SafeArea`, `revealAboveKeyboard`, `keyboardAwareBounds`, `createForm` validation/touched/errors/submitting, and the keyboard-aware mobile template. Remaining: a rendered FormField component and automatic wiring of native editors. Desktop scene pointer hover/press/click is implemented (`useMouse` plus SDL pointer/mouse forwarding), along with `dragToScroll`, `wheelToScroll`, and pointer cursor styles (`cursorStyle`, `useCursor`). Phase 2 now has `Modal` with a real focus trap and restore, `Sheet`, `Toast`, `Popover`, `Menu`, `Tooltip` and `Alert`, plus tab navigation, guards, snapshot/restore and browser history. Remaining in Phase 2: drawer, route transitions, focus/scroll restoration on back, and deep-link router integration. Phase 4 data primitives are in place: `createQuery` (cache/retry/invalidation), `createPersistentStore` and `createOfflineQueue`. Device services now cover clipboard, share, haptics, device/battery info, keep-awake, orientation and external opening, and `bindDeepLinks` connects the links port to navigation. Internationalization covers translations, plurals, RTL, text scaling, high contrast and locale-aware formatting; `auditSemantics` and reading-order helpers cover the accessibility gate. Phase 6 has paged loading, pull-to-refresh state, selection and standard list states; section lists, sticky headers, swipe actions and reordering remain. Phase 2 also has `Drawer`, and crash reporting is wired through `AppErrorBoundary`.

### Phase 0 — Contracts and theme foundation

- Add `ThemeProvider`/tokens (color, typography, spacing, motion, radius), light/dark/system scheme, and `useColorScheme`.
- Add a platform capability registry (target, input kinds, insets, services) so features fail explicitly rather than silently.
- Add safe-area/cutout/status-bar/IME fields to the viewport contract while keeping current aliases.
- Acceptance: one reference screen renders in light/dark and safe-area modes on web, desktop, Android phone and TV.

### Phase 1 — Keyboard, forms and insets

- `useKeyboard()`, `KeyboardAvoidingView` (`padding`/`height`/`position`, `keyboardVerticalOffset`), `SafeArea`.
- Automatic focus reveal: the focused editor scrolls above the IME; the mobile template form needs no manual keyboard code.
- Form primitives: `Form`, `FormField`, validation messages, error announcements, submit/loading state, multiline, keyboard types, return-key actions.
- Acceptance: a login/credential form works on Android, iOS, web and desktop at all font scales, with autofill and the field always visible above the keyboard.

### Phase 2 — Navigation and presentation

- Router with stack/tabs/drawer, typed routes, guards, state restoration, web URL sync and deep-link handoff.
- `Modal`, `Sheet`, `Popover`, `Menu`, `Tooltip`, `Toast`, `Alert` with focus trap/restore, barrier/back dismiss, safe-area padding and modal accessibility.
- Acceptance: a multi-screen app with a sign-in guard, tab shell, modal sheet form and toast works on every target; back/escape returns focus correctly.

### Phase 3 — Pointer, gestures and scrolling

- Generalize pointer binding to every host; desktop scene hover/press/click/drag and cursor styles.
- `ScrollView`/`Virtual` drag-to-scroll with Flutter-style device rules, momentum, keyboard scrolling, scroll indicators and `scrollTo`.
- `RefreshControl`, `Swipeable`, `Reorderable`, drag-and-drop files on desktop/web.
- Acceptance: a mouse-only desktop user can navigate, scroll and drag; a touch user can fling; a TV remote never depends on pointer input.

### Phase 4 — Data, state and offline

- Resource helper (loading/error/refetch), global store contract, persistence adapter, offline queue and retry.
- Acceptance: the reference app survives reload/backgrounding, retries a failed request and renders empty/loading/error states.

### Phase 5 — Device and app services

- First-class wrappers for clipboard, share, haptics, file system, picker, biometrics, geolocation, camera, notifications/push, background jobs, device/power info, in-app browser, update check and crash-reporting hook.
- Status/navigation bar background colour and edge-to-edge drawing.
- Acceptance: a profile screen can change avatar (camera/picker), share a link, copy text, receive a notification and persist a token securely on phone and desktop where supported.

### Phase 6 — Lists and media UX

- SectionList, infinite scroll, pull-to-refresh, sticky headers, swipe actions, reorder, selection, empty/loading/error components.
- Audio-only playback, resume/bookmarks, fullscreen/PiP, media session, thumbnails, capability/DRM probes.
- Acceptance: a catalog screen with 1,000+ items scrolls at target FPS and resumes video at the saved position.

### Phase 7 — Platform polish

- Android TV: ambient-mode policy, media keys API, deep links.
- Roku: deep linking/roInputEvent, voice keyboard matrix, certification budget checks.
- Desktop: native menus/tray, file dialogs, drag-drop, window state, single instance, deep links, updater, shortcuts.
- Web: URL router, PWA/offline, file input/download, share/clipboard/notifications.
- Acceptance: per-target checklist in the qualification matrix is green or explicitly preview.

### Phase 8 — Accessibility and i18n

- Full semantics roles/values/actions, modal isolation, announcements, touch-target and text-scale signals, RTL, translation catalogs, pluralization and locale formatting.
- Acceptance: VoiceOver/TalkBack pass on the reference flows; RTL mirroring verified; no clipped text at 200% font scale.

### Phase 9 — Quality and release gates

- Automated per-target smoke, visual regression, accessibility audit, performance traces, bundle/asset budgets.
- Acceptance: releases are generated from CI with published checksums and per-target evidence.

## 13. Cross-cutting invariants

- TV frame pacing must remain at zero missed presentation deadlines; new features must not add idle frame scheduling.
- No feature may require platform-specific code in an application screen; differences belong in hosts or adapters.
- Every platform-specific capability returns `available`/`unavailable` and `granted`/`denied`/`prompt` separately.
- Every interactive element must be reachable by the target's primary input and expose accessible semantics.
- Text, spacing and targets must scale with the platform's accessibility settings.
- Feature code is opt-in: idle TV scenes must not pay for mobile/desktop services.
