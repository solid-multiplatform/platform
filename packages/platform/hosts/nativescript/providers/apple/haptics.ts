import type { HapticsPort } from '@solid-multiplatform/platform/device';

// UIImpactFeedbackStyle
const styles = { light: 0, medium: 1, heavy: 2 } as const;
const kSystemSoundID_Vibrate = 4095;

/** iOS only: the Taptic Engine. */
export function haptics(): HapticsPort {
  return {
    async impact(style) {
      UIImpactFeedbackGenerator.alloc()
        .initWithStyle(styles[style])
        .impactOccurred();
    },
    async selection() {
      UISelectionFeedbackGenerator.alloc().init().selectionChanged();
    },
    async notification(type) {
      UINotificationFeedbackGenerator.alloc()
        .init()
        .notificationOccurred(
          type === 'error' ? 2 : type === 'warning' ? 1 : 0,
        );
    },
    // iOS has one system vibration of fixed length: the duration is not used.
    async vibrate() {
      AudioServicesPlaySystemSound(kSystemSoundID_Vibrate);
    },
  };
}
