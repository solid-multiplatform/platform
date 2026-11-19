import type { SharePort } from '@solid-multiplatform/platform/device';

/** iOS only: tvOS has no share sheet. */
export function share(): SharePort {
  return {
    share: (options) =>
      new Promise((resolve, reject) => {
        const presenter =
          UIApplication.sharedApplication.keyWindow?.rootViewController;
        if (!presenter) {
          reject(new Error('No window to present the share sheet from'));
          return;
        }
        const items: unknown[] = [];
        const text = [options.title, options.text].filter(Boolean).join('\n');
        if (text) items.push(text);
        const url = options.url ? NSURL.URLWithString(options.url) : null;
        if (url) items.push(url);
        const sheet =
          UIActivityViewController.alloc().initWithActivityItemsApplicationActivities(
            items,
            null,
          );
        sheet.completionWithItemsHandler = (_activity, completed) =>
          resolve(completed ? 'shared' : 'dismissed');
        // An iPad shows the sheet as a popover, which needs an anchor.
        const popover = sheet.popoverPresentationController;
        if (popover) {
          popover.sourceView = presenter.view;
          popover.sourceRect = presenter.view.bounds;
        }
        presenter.presentViewControllerAnimatedCompletion(
          sheet,
          true,
          () => {},
        );
      }),
  };
}
