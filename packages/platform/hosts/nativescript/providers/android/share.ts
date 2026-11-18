import type {
  ShareOptions,
  SharePort,
  ShareResult,
} from '../../../../src/sdk/device.js';
import { shareableUri } from './content-uri.js';
import { confinePath } from './paths.js';
import { startForResult } from './results.js';
import { mainHandler, sdk, type AndroidApp } from './runtime.js';

/** Android can also share files from the app's own directories. */
export interface AndroidShareOptions extends ShareOptions {
  /** Paths inside the app's files or cache directory. */
  files?: readonly string[];
}

let Receiver: (new () => android.content.BroadcastReceiver) | undefined;
let chosen: (() => void) | undefined;

/**
 * `ACTION_SEND` through the system chooser. The chooser reports the app the
 * user picked through a broadcast, received only while a share is open:
 * `shared` when it arrived, `dismissed` when the chooser closed without one.
 */
export function share(app: AndroidApp): SharePort {
  const Intent = android.content.Intent;
  const context = app.context;
  const build = (options: AndroidShareOptions): android.content.Intent => {
    const text = [options.text, options.url].filter(Boolean).join('\n');
    const files = (options.files ?? []).map((path) => {
      const roots = [
        String(context.getFilesDir().getAbsolutePath()),
        String(context.getCacheDir().getAbsolutePath()),
      ];
      return new java.io.File(confinePath(path, roots, roots[0]!));
    });
    const intent = new Intent(
      files.length > 1 ? Intent.ACTION_SEND_MULTIPLE : Intent.ACTION_SEND,
    );
    intent.setType(files.length ? '*/*' : 'text/plain');
    if (text) intent.putExtra(Intent.EXTRA_TEXT, text);
    if (options.title) intent.putExtra(Intent.EXTRA_SUBJECT, options.title);
    if (files.length) {
      const uris = new java.util.ArrayList<android.net.Uri>();
      for (const file of files) uris.add(shareableUri(app, file));
      if (files.length === 1)
        intent.putExtra(
          Intent.EXTRA_STREAM,
          uris.get(0) as android.os.Parcelable,
        );
      else intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
      // The chooser passes the read grant on through the clip.
      const clip = android.content.ClipData.newRawUri('', uris.get(0));
      for (let i = 1; i < uris.size(); i++)
        clip.addItem(new android.content.ClipData.Item(uris.get(i)));
      intent.setClipData(clip);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
    }
    return intent;
  };
  return {
    async share(options: AndroidShareOptions): Promise<ShareResult> {
      const action = context.getPackageName() + '.solid.share.CHOSEN';
      Receiver ??= android.content.BroadcastReceiver.extend({
        onReceive: () => chosen?.(),
      });
      const receiver = new Receiver();
      let picked = false;
      let settle: (() => void) | undefined;
      chosen = () => {
        picked = true;
        settle?.();
      };
      const filter = new android.content.IntentFilter(action);
      if (sdk() >= 33)
        context.registerReceiver(
          receiver,
          filter,
          android.content.Context.RECEIVER_NOT_EXPORTED,
        );
      else context.registerReceiver(receiver, filter);
      try {
        const callback = android.app.PendingIntent.getBroadcast(
          context,
          0,
          new Intent(action).setPackage(context.getPackageName()),
          android.app.PendingIntent.FLAG_UPDATE_CURRENT |
            // The chooser adds the chosen component to the broadcast.
            (sdk() >= 31 ? android.app.PendingIntent.FLAG_MUTABLE : 0),
        );
        await startForResult(
          app,
          Intent.createChooser(
            build(options),
            options.title ?? '',
            callback.getIntentSender(),
          ),
        );
        // The choice is a broadcast and can land just after the chooser has
        // closed: give it one short wait before calling the share dismissed.
        if (!picked)
          await new Promise<void>((resolve) => {
            const timeout = new java.lang.Runnable({ run: resolve });
            settle = () => {
              mainHandler().removeCallbacks(timeout);
              resolve();
            };
            mainHandler().postDelayed(timeout, 300);
          });
        return picked ? 'shared' : 'dismissed';
      } finally {
        chosen = undefined;
        context.unregisterReceiver(receiver);
      }
    },
  };
}
