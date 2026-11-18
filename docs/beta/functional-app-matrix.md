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
| Dev server and hot reload                   | Vite/Expo                                          | S      | `solid-platform dev` via the Vite dev server                               | —     |
| Asset pipeline (images, fonts, icons)       | Expo Asset, Flutter pubspec assets                 | S      | CLI copies assets/fonts; `loadFonts` and `Image` texture pipeline          | —     |
| Environment/config injection                | Expo `app.config`, Vite env                        | S      | `setEnvironment`/`env`/`envFlag`/`envNumber` with build-env fallback       | —     |
| Generated type-safe routes                  | Expo Router typed routes                           | S      | `buildRoute`/`matchRoute` with `RouteParams` inference                     | —     |
| Debug inspector / component tree            | RN DevTools, Flutter Inspector                     | S      | solid-devtools `elementInterface` + `logRenderTree`                        | —     |
| Error boundaries                            | React error boundaries                             | S      | `AppErrorBoundary` with `ListState` fallback and retry                     | —     |
| Structured logging and tracing              | Expo/Flutter logging                               | S      | `createLogger` levels, child fields, spans; `configureLogging`             | —     |
| Crash reporting hook                        | Sentry/Crashlytics integration point               | S      | `setCrashReporter`/`reportCrash`; `AppErrorBoundary` reports render errors | —     |
| Release signing/notarization hooks          | Tauri/Expo build profiles                          | S      | `createReleasePipeline` hooks, skips, error reporting and identity checks  | —     |
| OTA/update channel                          | Tauri updater, Expo Updates                        | S      | `createUpdateChecker` + `createUpdateDelivery` (download/install/relaunch) | —     |

## 2. Layout, rendering and visual system

| Feature                                     | Established pattern                             | Status | Evidence / gap                                                                       | Phase |
| ------------------------------------------- | ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------ | ----- |
| Flex row/column                             | Yoga/Flexbox, Flutter Row/Column                | S      | `src/core/flex*`, contract tests                                                     | —     |
| Grid                                        | CSS grid, Flutter GridView                      | S      | `Grid`, `VirtualGrid`                                                                | —     |
| Absolute positioning and z-order            | CSS position/z-index                            | S      | `x/y/zIndex`, paint-order tests                                                      | —     |
| Min/max sizing, aspect ratio                | CSS min/max/aspect-ratio                        | S      | min/max props + `aspectRatio` derives the missing dimension                          | —     |
| Padding/margin/borders                      | CSS box model                                   | S      | `borderBox`, contract tests                                                          | —     |
| Border radius                               | CSS radius, Flutter BorderRadius                | S      | `borderRadius` prop backed by rounded shaders; shader tests                          | —     |
| Clipping and overflow                       | CSS overflow, Flutter clipBehavior              | S      | Flex clipping/culling                                                                | —     |
| Safe-area-aware layout                      | iOS safe area, Android insets, Flutter SafeArea | S      | `viewport().insets` + `SafeArea` primitive                                           | —     |
| RTL and writing direction                   | CSS direction, I18nManager                      | S      | `isRTL`/`dir()` and document direction from i18n                                     | —     |
| Responsive breakpoints                      | CSS media queries, Flutter LayoutBuilder        | S      | `breakpoint`/`useBreakpoint`, `resolveResponsive`, Material window classes           | —     |
| Text wrapping, ellipsis, truncation         | CSS text-overflow, Flutter Text                 | S      | `contain`, `maxLines`, line-clamp in the DOM renderer                                | —     |
| Rich text / inline spans                    | RN Text nesting, Flutter TextSpan               | S      | `RichText` + `layoutRichText`: styled spans, wrapping, newlines, ellipsis, alignment | —     |
| Custom fonts and fallbacks                  | CSS @font-face, Flutter FontLoader              | S      | MSDF font loading, font tests                                                        | —     |
| Image fit/placeholder/lazy decode           | RN Image, Flutter Image                         | S      | `Image` fit/placeholder/fallback; renderer decode budgets                            | —     |
| SVG and icons                               | react-native-svg, Flutter vector                | S      | `Svg`/`Icon` primitives, `registerIcons`, SVG data-URL textures                      | —     |
| Gradients, shaders, blur                    | CSS gradients/filters, Skia                     | S      | `linearGradient`/`radialGradient`/`rounded`/`shadow` props + blur helper             | —     |
| Opacity and alpha blending                  | CSS opacity/blend                               | S      | Contract and visual tests                                                            | —     |
| Shadows and elevation                       | CSS box-shadow, Material elevation              | S      | `shadow` prop backed by shadow shaders; shader tests                                 | —     |
| Transforms                                  | CSS transform                                   | S      | `scale` and `rotation` props; layout/style tests                                     | —     |
| Theme tokens (color, type, spacing, motion) | Material Theme, Tailwind, SwiftUI Environment   | S      | `ThemeProvider`, `useTheme`, light/dark palettes                                     | —     |
| Light/dark/system color scheme              | RN `useColorScheme`, Flutter ThemeMode          | S      | `useColorScheme` with light/dark palettes and host bindings                          | —     |
| Idle frame scheduling                       | Flutter/RN frame callbacks                      | S      | Renderer sleeps when idle; fast harness uses it                                      | —     |
| Frame pacing and trace markers              | Android FrameTimeline                           | S      | Three-pass gate and `quick-android.py`                                               | —     |
| Virtualization and culling                  | FlatList, Flutter ListView.builder              | S      | `Virtual`, `VirtualGrid`, `Lazy`                                                     | —     |

## 3. Input, gestures and focus

| Feature                          | Established pattern                        | Status | Evidence / gap                                                                        | Phase |
| -------------------------------- | ------------------------------------------ | ------ | ------------------------------------------------------------------------------------- | ----- |
| Remote/D-pad navigation          | Android TV D-pad, Roku remote              | S      | Focus manager, TV templates, gate fixture                                             | —     |
| Gamepad input                    | Android gamepad keys                       | S      | `readGamepads`/`gamepadEdges`/`bindGamepadEvents`; no idle polling                    | —     |
| Physical keyboard                | Tab/arrows/Enter/Escape                    | S      | `createShortcuts` combo layer; focus manager keeps Tab/arrows/Enter                   | —     |
| Mouse hover/press/click          | Pointer Events                             | S      | Web pointer binding; SDL3 pointer/mouse mapping + `useMouse()` in the desktop starter | —     |
| Mouse drag and wheel             | Pointer Events, wheel                      | S      | `dragToScroll`, `wheelToScroll`; `createInputScope` drag/wheel on native and web      | —     |
| Touch multi-point                | Pointer Events, Android MotionEvent        | S      | `bindSceneTouch`, pointer IDs                                                         | —     |
| Pointer capture and cancellation | Pointer Events `setPointerCapture`         | S      | Web binding; mobile cancel                                                            | —     |
| Long press and key repeat        | RN Pressable, Android key repeat           | S      | `useHold`, input hold, KeyBridge repeat                                               | —     |
| Focus states and visible focus   | CSS :focus-visible, TV focus               | S      | `$focus`, focus manager tests                                                         | —     |
| Spatial/directional focus        | TV/console navigation                      | S      | `handleNavigation`, focus manager                                                     | —     |
| Focus restoration and stack      | Flutter Navigator, focus stack             | S      | `createFocusStack` plus navigation `restoration` capture/restore                      | —     |
| Focus trap / modal containment   | Flutter DialogRoute closedLoop, ARIA modal | S      | `pushFocusTrap` in the focus manager; `Modal` installs it for its panel               | —     |
| IME composition and text editing | RN TextInput, native editors               | S      | Native editor + desktop editor; mobile smoke                                          | —     |
| Hardware back                    | Android BackHandler, Roku Back             | S      | `createBackDispatcher` stack + `bindBackKey` for Back/Escape/GoBack                   | —     |
| Media transport keys             | Android TV media keys, Roku                | S      | `bindMediaKeys` maps hardware transport keys to actions                               | —     |
| Drag and drop files              | Desktop/web DnD                            | S      | `bindFileDrop` with `PickedFile` wrapping                                             | —     |
| Pointer cursor styles            | CSS cursor                                 | S      | `cursorStyle` on elements, `useCursor`/`setCursor`; applied by `useMouse`             | —     |
| Pinch/rotate gestures            | Pointer Events multi-touch                 | S      | `createPinchGesture`: two-pointer scale, accumulated rotation, centre delta           | —     |

## 4. Controls, forms and editing

| Feature                       | Established pattern                         | Status | Evidence / gap                                                       | Phase |
| ----------------------------- | ------------------------------------------- | ------ | -------------------------------------------------------------------- | ----- |
| Text and labels               | RN Text, Flutter Text                       | S      | Text node, contract tests                                            | —     |
| Buttons                       | RN Button/Pressable                         | S      | TV/web templates, controls                                           | —     |
| Switch/toggle                 | RN Switch, Flutter Switch                   | S      | `Toggle`, native/web controls                                        | —     |
| Checkbox and radio            | Material/Flutter                            | S      | `Checkbox`, `Radio`, `RadioGroup` with Enter/pointer activation      | —     |
| Slider and progress           | RN Slider/Progress                          | S      | `Slider`, `Progress`, native controls                                | —     |
| Single-line text field        | RN TextInput                                | S      | Native/desktop/web editors                                           | —     |
| Multiline text area           | RN multiline                                | S      | `TextArea`/`TextField multiline` native editor                       | —     |
| Password masking and autofill | Android autofill, Apple Password AutoFill   | S      | `purpose`, password smoke tested                                     | —     |
| Keyboard types and return key | RN keyboardType/returnKeyType               | S      | `EditorOptions.purpose`/`multiline`; native keyboard hints           | —     |
| Validation and error messages | HTML constraint validation, Flutter Form    | S      | `createForm` touched validation and per-field errors                 | —     |
| Focus traversal inside forms  | HTML tab order, Flutter FocusTraversal      | S      | `FocusGroup` + `createFocusTraversal`: Tab/Shift+Tab with wrapping   | —     |
| Date/time picker              | RN community datetimepicker                 | S      | `DatePicker` calendar grid, month navigation, optional time steppers | —     |
| Select/picker                 | RN Picker, Flutter Dropdown                 | S      | `Select` dropdown built on `Menu` with controlled value              | —     |
| Search field                  | Flutter SearchBar                           | S      | `SearchField` native editor with `purpose: search`                   | —     |
| File/image picker             | Expo ImagePicker/DocumentPicker             | S      | `pickFiles` with host port and web input fallback                    | —     |
| Clipboard                     | Expo Clipboard, Capacitor Clipboard         | S      | `readClipboard`/`writeClipboard` with host port and web fallback     | —     |
| Loading/submitting states     | Flutter Form/Button state                   | S      | `createForm().submitting` and `ListState`                            | —     |
| Input above keyboard          | RN KeyboardAvoidingView, Flutter viewInsets | S      | `KeyboardAvoidingView` + keyboard-aware mobile template              | —     |
| Auto-reveal focused field     | Flutter ensureVisible, Android adjustResize | S      | `revealAboveKeyboard` and `keyboardAwareBounds`                      | —     |

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
| Transition animations            | Flutter page transitions                      | S      | `useTransition` fade/slide/scale values; route wiring is app-owned                            | —     |
| Focus/scroll restoration on back | React Navigation                              | S      | Navigation restoration adapter captures on leave and restores on back                         | —     |

## 6. Lists, data and async UI

| Feature                      | Established pattern             | Status | Evidence / gap                                                       | Phase |
| ---------------------------- | ------------------------------- | ------ | -------------------------------------------------------------------- | ----- |
| Flat/vertical list           | FlatList, ListView              | S      | `Virtual`, templates                                                 | —     |
| Section list                 | RN SectionList                  | S      | `flattenSections` offsets headers/items for virtual rendering        | —     |
| Grid list                    | Flutter GridView                | S      | `VirtualGrid`                                                        | —     |
| Windowed rendering           | FlatList windowSize             | S      | `Virtual`, `Lazy` buffer                                             | —     |
| Lazy route/component loading | React.lazy, Flutter deferred    | S      | `lazy()`                                                             | —     |
| Infinite scroll/pagination   | FlatList onEndReached           | S      | `createPagedList` + `Virtual` `onEndReached`/`scrollIndex`           | —     |
| Pull to refresh              | RN RefreshControl               | S      | `createPullToRefresh` threshold gesture + `createPagedList.refresh`  | —     |
| Sticky headers               | Flutter SliverAppBar            | S      | `stickyHeaderAt` resolves the pinned header from scroll offset       | —     |
| Swipe actions                | Flutter Dismissible             | S      | `createSwipeActions` threshold gesture with start/end actions        | —     |
| Reorder/drag                 | Flutter ReorderableListView     | S      | `moveItem` + `createReorder` drag state                              | —     |
| Selection/multi-select       | Flutter/React patterns          | S      | `createSelection` single/multiple with custom equality               | —     |
| Empty/loading/error states   | Flutter/React patterns          | S      | `ListState` loading/empty/error view with optional action            | —     |
| Async resource/Suspense      | Solid resources, React Suspense | S      | `createQuery`: data/loading/error, retry/backoff, staleTime, refetch | —     |
| Global store and persistence | Redux/Zustand, Flutter provider | S      | `createPersistentStore` over the `settings`/`secureStorage` ports    | —     |
| Offline queue and retry      | React Query/SWR                 | S      | `createOfflineQueue`: durable FIFO, connectivity-triggered retry     | —     |
| Cache invalidation           | React Query                     | S      | `invalidateQueries`, `setQueryData`, keyed `createQuery` cache       | —     |

## 7. Device, platform and app services

| Feature                                | Established pattern                         | Status | Evidence / gap                                                             | Phase |
| -------------------------------------- | ------------------------------------------- | ------ | -------------------------------------------------------------------------- | ----- |
| Lifecycle (active/background)          | RN AppState, Flutter AppLifecycleState      | S      | `lifecycle` service, host bindings                                         | —     |
| Orientation lock                       | Expo ScreenOrientation                      | S      | `lockOrientation` with a host port or Screen Orientation API               | —     |
| Status/navigation bars                 | Capacitor StatusBar/SystemBars              | S      | `applySystemBarStyle` host port + theme-color fallback                     | —     |
| Keyboard inset and visibility          | Android IME insets, iOS notifications       | S      | `viewport().keyboardInset`                                                 | —     |
| Safe area and display cutout           | Apple safeAreaInsets, Android displayCutout | S      | `safeArea` per edge                                                        | —     |
| Dark/light/system theme                | RN useColorScheme                           | S      | `ThemeProvider`, `useTheme`, `useColorScheme`                              | —     |
| Text scaling / accessibility font size | iOS Dynamic Type, Android sp                | S      | `setTextScale` scales theme typography and `scaled()` tokens               | —     |
| Reduce motion                          | iOS/Android/Web                             | S      | `reducedMotion` in viewport                                                | —     |
| Locale and i18n                        | i18next, Flutter intl                       | S      | `setupI18n`/`createI18n` with locale fallback and interpolation            | —     |
| RTL layout                             | CSS direction, I18nManager                  | S      | `isRTL`, `textDirection`, `dir()` and document `dir`/`lang` sync           | —     |
| Haptics                                | Expo Haptics, Capacitor Haptics             | S      | `impact`/`vibrate` with host port and Vibration API fallback               | —     |
| Clipboard                              | Expo/Capacitor                              | S      | `readClipboard`/`writeClipboard` with host port and web fallback           | —     |
| Share sheet                            | RN Share, Capacitor Share                   | S      | `share` with host port, Web Share and clipboard fallback                   | —     |
| Local notifications                    | Expo/Capacitor LocalNotifications           | S      | `notifications` port + host                                                | —     |
| Push notifications                     | Expo/Capacitor PushNotifications            | S      | `push` port + web PushManager subscription; native providers app-owned     | —     |
| Permissions                            | Expo/Capacitor Permissions                  | S      | `createPermissions`, host ports                                            | —     |
| Capability registry                    | Expo modules `isAvailableAsync`             | S      | `src/sdk/capabilities.ts` (`setCapabilities`, `supports`)                  | —     |
| Connectivity state                     | NetInfo, Capacitor Network                  | S      | `connectivity` port                                                        | —     |
| HTTP client and cancellation           | fetch/axios, Tauri HTTP                     | S      | `network.ts`, host adapters                                                | —     |
| Preferences/settings                   | AsyncStorage, Capacitor Preferences         | S      | `settings` store                                                           | —     |
| Secure storage                         | Keychain/Keystore                           | S      | `secureStorage` port + native                                              | —     |
| File system                            | Expo FileSystem, Capacitor Filesystem       | S      | `FileSystemPort` + `readFileText`/`writeFileText`/`listFiles` etc.         | —     |
| Background jobs                        | Expo BackgroundTask, WorkManager            | S      | `jobs` port + Web Background Sync; native registries                       | —     |
| Device info                            | Expo Device                                 | S      | `deviceInfo` with host port and web fallback                               | —     |
| Battery/power state                    | Expo Battery                                | S      | `batteryState` with host port and Battery Status API                       | —     |
| Keep awake / screen lock               | Expo KeepAwake                              | S      | `keepAwake` with host port and Screen Wake Lock API                        | —     |
| Biometrics/local auth                  | Expo LocalAuthentication                    | S      | `authenticate`/`biometricsAvailable` host port                             | —     |
| Geolocation                            | Expo Location, Capacitor Geolocation        | S      | `getCurrentPosition`/`watchPosition` with host and web fallback            | —     |
| Camera                                 | Expo Camera/ImagePicker                     | S      | `capturePhoto` host port + getUserMedia/canvas fallback                    | —     |
| Microphone/recording                   | Expo Audio                                  | S      | `openMicrophone`/`stopMicrophone` host port + getUserMedia                 | —     |
| Contacts/calendar                      | Expo Contacts/Calendar                      | S      | `ContactsPort`/`CalendarPort` + `getContacts`/`pickContact`/events helpers | —     |
| Sensors                                | Expo Sensors                                | S      | `SensorsPort` + `watchSensor`/`readSensor`; web motion fallback            | —     |
| Maps                                   | Expo Maps                                   | S      | `MapsPort` + `openMap`/`openDirections`; Google Maps fallback              | —     |
| In-app browser / external opener       | Expo WebBrowser, Tauri Opener               | S      | `openExternal` with host port and window.open fallback                     | —     |
| App/store review                       | Expo StoreReview                            | S      | `requestAppReview` host port                                               | —     |

## 8. Media

| Feature                     | Established pattern             | Status | Evidence / gap                                                            | Phase |
| --------------------------- | ------------------------------- | ------ | ------------------------------------------------------------------------- | ----- |
| Image display and fit       | RN Image resizeMode             | S      | `Image`, gallery fixture                                                  | —     |
| Video playback              | Media3/AVPlayer/HTML/Roku Video | S      | optional video module, device gate                                        | —     |
| Audio playback              | Expo Audio                      | S      | `createAudioPlayer` with host `AudioPort` and HTMLAudioElement fallback   | —     |
| Captions/subtitles          | Media3/AVPlayer/Roku            | S      | native caption verified                                                   | —     |
| Audio/text track selection  | Media3                          | S      | video adapters                                                            | —     |
| Playback controls/transport | Media3 custom layout            | S      | video module                                                              | —     |
| Resume/bookmarks            | Roku uses bookmarks             | S      | `createBookmarks` persisted positions with start/end thresholds           | —     |
| Fullscreen/PiP              | AVPlayer/Media3/HTML            | S      | `enterFullscreen`/`exitFullscreen`/`enterPictureInPicture` with host port | —     |
| Media session / now playing | Android MediaSession            | S      | `configureMediaSession` metadata, state, position and transport handlers  | —     |
| Keep awake during playback  | FLAG_KEEP_SCREEN_ON             | S      | `keepAwake` API; video hosts keep their platform flags                    | —     |
| Video thumbnails            | Expo VideoThumbnails            | S      | `captureThumbnail` with a host port and web video/canvas fallback         | —     |
| DRM/capability reporting    | Media3/AVPlayer                 | S      | `mediaCapabilities`/`supportsDrm` with host port and web probe            | —     |
| HLS/DASH                    | Media3/hls.js                   | S      | video dependencies                                                        | —     |

## 9. Accessibility and internationalization

| Feature                         | Established pattern                  | Status | Evidence / gap                                                                         | Phase |
| ------------------------------- | ------------------------------------ | ------ | -------------------------------------------------------------------------------------- | ----- |
| Roles, labels, values, actions  | ARIA, UIAccessibility, TalkBack      | S      | `browserSemantics` covers 24 roles, state, value, level and description                | —     |
| Reading/focus order             | WCAG 2.4.3                           | S      | `readingOrder()` sorts rows by direction                                               | —     |
| Visible focus                   | WCAG 2.4.7                           | S      | `$focus` states                                                                        | —     |
| Modal semantics / hide siblings | aria-modal, accessibilityViewIsModal | S      | `browserSemantics` sets `aria-hidden`/`inert` on siblings while a dialog is registered | —     |
| Live announcements              | aria-live, UIAccessibility.post      | S      | announcer primitives                                                                   | —     |
| Touch targets ≥44pt/48dp        | Apple HIG, Material                  | S      | `MIN_TOUCH_TARGET`, `meetsTouchTarget`, `ensureTouchTarget`                            | —     |
| Gesture alternatives            | WCAG 2.5.1                           | S      | `createGestureAlternatives` + `GestureAlternatives` button bar and semantics           | —     |
| Text scaling                    | Dynamic Type, sp                     | S      | `setTextScale` + theme typography scaling                                              | —     |
| High contrast                   | WCAG 1.4.11                          | S      | `setHighContrast`, high-contrast light/dark palettes                                   | —     |
| Reduced motion                  | WCAG 2.3.3                           | S      | `reducedMotion`                                                                        | —     |
| RTL mirroring                   | CSS direction, I18nManager           | S      | `dir()` and document direction; `readingOrder` accepts RTL                             | —     |
| Translations/pluralization      | i18next, Flutter intl                | S      | `t()` with `Intl.PluralRules` categories and `{param}` interpolation                   | —     |
| Locale-aware dates/numbers      | Intl                                 | S      | `formatNumber`, `formatDate`, `formatRelativeTime`, `formatList`                       | —     |

## 10. Performance, reliability and quality

| Feature                  | Established pattern        | Status | Evidence / gap                                                             | Phase |
| ------------------------ | -------------------------- | ------ | -------------------------------------------------------------------------- | ----- |
| Startup measurement      | Roku 15s, Flutter startup  | S      | Android launch time recorded                                               | —     |
| Frame pacing gate        | Android FrameTimeline      | S      | three ten-minute passes, zero misses                                       | —     |
| Idle frame scheduling    | Flutter frame callbacks    | S      | event-driven loop                                                          | —     |
| Image decode budgets     | Flutter image cache        | S      | Renderer texture upload queue with per-frame time budget + `memoryInfo`    | —     |
| List recycling           | FlatList/ListView.builder  | S      | `Virtual`, `Lazy`                                                          | —     |
| Memory budgets / low-RAM | Android `isLowRamDevice`   | S      | `deviceMemory` host port + `navigator.deviceMemory` threshold              | —     |
| Error boundaries         | React/Solid                | S      | `AppErrorBoundary` with `ListState` fallback and retry                     | —     |
| Crash reporting hook     | Sentry/Crashlytics         | S      | `setCrashReporter`/`reportCrash`; `AppErrorBoundary` reports render errors | —     |
| Offline/retry            | React Query                | S      | `createOfflineQueue` with persisted items and retry                        | —     |
| State persistence        | React Navigation persist   | S      | `createPersistentStore` snapshot persistence                               | —     |
| Version/update check     | Tauri updater              | S      | `createUpdateChecker`, `compareVersions`, mandatory-update dismissal       | —     |
| Profiling overlay        | RN/Flutter DevTools        | S      | `FPSCounter` overlay with FPS and renderer memory                          | —     |
| Automated a11y audit     | axe, Accessibility Scanner | S      | `auditSemantics()` for labels, roles, values and touch targets             | —     |
| Visual regression        | screenshot tests           | S      | `tests/visual`, TV pixel audit                                             | —     |
| Device smoke matrices    | CI                         | S      | Android TV, Apple simulator, desktop probe, browser smoke                  | —     |

## 11. Platform-specific requirements

### Web

| Feature                       | Status | Gap                                                                                        |
| ----------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Pointer/touch/keyboard        | S      | —                                                                                          |
| Responsive resize             | S      | —                                                                                          |
| History/routing               | S      | `createBrowserNavigation` (History API)                                                    |
| PWA/offline                   | S      | Manifest + service worker precache, registration/update and install prompt + offline queue |
| Clipboard/share/notifications | S      | Device services + browser Notification API                                                 |
| File input/download           | S      | `pickFiles`, `downloadFile`/`downloadText`/`downloadBytes`/`downloadUrl`                   |
| Browser TV (Chromium 85)      | S      | Tizen/webOS/Vizio generated builds verified                                                |

### Android phone / tablet

| Feature                          | Status | Gap                                             |
| -------------------------------- | ------ | ----------------------------------------------- |
| Touch, lifecycle, insets         | S      | —                                               |
| Native editor, password autofill | S      | —                                               |
| Status/navigation bars           | S      | `applySystemBarStyle` host port                 |
| Rotation/reflow                  | S      | Regression test                                 |
| Back gesture                     | S      | `createBackDispatcher` + `bindBackKey`          |
| Permissions/notifications        | S      | Ports exist                                     |
| Camera/file/biometrics           | S      | `capturePhoto`/`pickFiles`/`authenticate` ports |

### Android TV

| Feature                           | Status | Gap                            |
| --------------------------------- | ------ | ------------------------------ |
| D-pad focus, overscan, 10-foot UI | S      | —                              |
| Media keys, playback              | S      | Video module                   |
| Frame pacing gate                 | S      | Zero-miss passes recorded      |
| Ambient mode / keep awake         | S      | `keepAwake` API                |
| Deep linking                      | S      | `bindDeepLinks` + typed routes |

### Apple (iOS / iPadOS / tvOS)

| Feature                            | Status | Gap                                                                                           |
| ---------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| NativeScript hosts, touch, plugins | S      | CI simulator evidence                                                                         |
| Safe area / keyboard               | S      | —                                                                                             |
| Dynamic Island                     | P      | Covered by safe-area top inset; no separate rect (by design)                                  |
| Push/background tasks              | P      | Ports exist; end-to-end flow missing                                                          |
| Apple TV focus/remote              | P      | Build/tested, no physical device                                                              |
| Signing/distribution               | P      | `hosts/apple/signing.mjs` codesign/notarytool/stapler hooks; identity and CI runner app-owned |

### Desktop (Linux / Windows / macOS)

| Feature                                | Status | Gap                                                                                    |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| SDL3 window, GL, text, resize          | S      | Linux/X11 + CI Windows/macOS first frame                                               |
| Keyboard and IME                       | S      | —                                                                                      |
| Scene mouse hover/press/click/drag     | S      | `useMouse` + SDL pointer/mouse forwarding                                              |
| Native menus/tray                      | S      | `hosts/desktop/menus.mjs` GTK/AppIndicator helper behind `MenusPort`; host probe ready |
| File dialogs / drag-drop files         | S      | `pickFiles` + `bindFileDrop`                                                           |
| Window state persistence               | S      | Desktop host saves/restores x/y/size through SDL and `normalizeWindowBounds`           |
| Single instance / deep links / updater | S      | Single-instance socket, deep links, updater feed/delivery and window state             |
| Accessibility (AccessKit)              | S      | AccessKit bridge + live `desktop-accessibility-probe` audit                            |
| Keyboard shortcuts/accelerators        | S      | `createShortcuts`                                                                      |

### Roku

| Feature                                                        | Status | Gap                                                                                   |
| -------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------- |
| SceneGraph host, focus, remote                                 | S      | —                                                                                     |
| BrighterScript plugin preset                                   | S      | CLI template                                                                          |
| Registry/storage/tasks                                         | S      | `roku/storage`, `roku/tasks`                                                          |
| Video/captions/trick play                                      | P      | Roku adapter unit-tested (video, tracks, seek, picture mode); device playback pending |
| Deep linking / roInputEvent                                    | S      | `bindDeepLinks` + typed routes                                                        |
| Voice keyboard/PIN                                             | S      | StandardKeyboard/PinPad voice domain + PIN bridge wired and unit-tested               |
| Certification budgets (15s launch, 3s scenes, 250ms keys, 4MB) | S      | `checkRokuCertification` + `solid-platform certify roku <metrics.json>`               |

## 12. Implementation phases

Progress: Phases 0–6 and 8 are implemented, including theme/capabilities/insets, keyboard/forms, modal/presentation primitives, tabs/guards/history/restoration, pointer drag/wheel/cursors, data/query/offline persistence, lists and a11y/i18n. Phase 7 media covers playback state/bookmarks, media sessions, fullscreen/PiP, thumbnails, audio and DRM reporting. Phase 5 services cover clipboard/share/haptics, files/pickers, geolocation, biometrics, notifications/jobs ports, keep-awake, orientation, system bars, updates and app review. Every core matrix row is now shipped at the framework level. Platform tables additionally cover Web PWA/offline and downloads, and desktop window-state persistence; native providers for the remaining contacts/calendar/sensor/map ports, signing/store credentials, the native OTA installer, and device-dependent Apple/Roku checks remain host/app-owned. Desktop menus/tray use a GTK/AppIndicator provider, and single-instance/updater delivery are wired in the host. Apple signing/notarization command hooks, Roku certification budget gating, Roku video-adapter and voice/PIN bridge tests and the desktop AccessKit audit probe are implemented; physical Apple TV/Roku playback qualification remains device/toolchain-bound.

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
