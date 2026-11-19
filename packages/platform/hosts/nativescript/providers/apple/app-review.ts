import type { AppReviewPort } from '@solid-multiplatform/platform/device';
import { windowScene } from './scene.js';

/**
 * iOS only: StoreKit's review prompt. The system decides whether the prompt
 * is shown (a few times a year at most) and never says: `true` means the
 * request was made.
 */
export function appReview(): AppReviewPort {
  return {
    async request() {
      const scene = windowScene();
      if (!scene) return false;
      SKStoreReviewController.requestReviewInScene(scene);
      return true;
    },
  };
}
