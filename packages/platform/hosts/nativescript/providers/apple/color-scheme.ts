import type { ColorSchemePort } from '@solid-multiplatform/platform/theme';

const UIUserInterfaceStyleDark = 2;

/**
 * The system appearance. The screen's traits are read, not the scene's: the
 * iOS host pins its own root view to dark for the native controls it overlays.
 */
export function colorScheme(): ColorSchemePort {
  const read = (traits: UITraitCollection) =>
    traits.userInterfaceStyle === UIUserInterfaceStyleDark ? 'dark' : 'light';
  return {
    current: () => read(UIScreen.mainScreen.traitCollection),
    subscribe(listener) {
      // Trait registrations need iOS/tvOS 17. Before that only a view
      // subclass hears the change, which this host does not have.
      const window = UIApplication.sharedApplication.keyWindow;
      if (
        !window ||
        typeof window.registerForTraitChangesWithHandler !== 'function'
      )
        return () => {};
      const registration = window.registerForTraitChangesWithHandler(
        [UITraitUserInterfaceStyle],
        () => listener(read(UIScreen.mainScreen.traitCollection)),
      );
      return () => window.unregisterForTraitChanges(registration);
    },
  };
}
