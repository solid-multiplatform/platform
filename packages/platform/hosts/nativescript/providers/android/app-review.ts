import type { AppReviewPort } from '../../../../src/sdk/device.js';
import { activityOf, type AndroidApp } from './runtime.js';

/**
 * Google Play's in-app review flow. Play decides whether a dialog is shown
 * and does not say; `true` means the flow ran to its end.
 */
export function appReview(app: AndroidApp): AppReviewPort {
  const review = com.google.android.play.core.review;
  const tasks = com.google.android.gms.tasks;
  return {
    request() {
      return new Promise<boolean>((resolve) => {
        const manager = review.ReviewManagerFactory.create(app.context);
        manager.requestReviewFlow().addOnCompleteListener(
          new tasks.OnCompleteListener({
            onComplete(info) {
              if (!info.isSuccessful()) return resolve(false);
              manager
                .launchReviewFlow(activityOf(app), info.getResult())
                .addOnCompleteListener(
                  new tasks.OnCompleteListener({
                    onComplete: (flow) => resolve(flow.isSuccessful()),
                  }),
                );
            },
          }),
        );
      });
    },
  };
}
