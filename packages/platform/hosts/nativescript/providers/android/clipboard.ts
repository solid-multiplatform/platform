import type { ClipboardPort } from '../../../../src/sdk/device.js';
import type { AndroidApp } from './runtime.js';

/**
 * `ClipboardManager`. Android lets an app read the clipboard only while it
 * has input focus; elsewhere `readText` resolves with an empty string.
 */
export function clipboard(app: AndroidApp): ClipboardPort {
  const manager = (): android.content.ClipboardManager =>
    app.context.getSystemService(android.content.Context.CLIPBOARD_SERVICE);
  return {
    async readText() {
      const clip = manager().getPrimaryClip();
      if (!clip || clip.getItemCount() === 0) return '';
      return String(clip.getItemAt(0).coerceToText(app.context) ?? '');
    },
    async writeText(text) {
      manager().setPrimaryClip(android.content.ClipData.newPlainText('', text));
    },
  };
}
