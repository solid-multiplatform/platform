import type { ClipboardPort } from '@solid-multiplatform/platform/device';

/** iOS only: tvOS has no pasteboard. */
export function clipboard(): ClipboardPort {
  return {
    async readText() {
      return UIPasteboard.generalPasteboard.string ?? '';
    },
    async writeText(text) {
      UIPasteboard.generalPasteboard.string = text;
    },
  };
}
