export async function getAppMemoryMonitor() {
  return null;
}
export function getFontMeasure() {
  return {
    getOneLineWidth: (_ref: unknown, text: string) => text.length * 16,
    getOneLineHeight: () => 32,
    getAscent: () => 24,
    getDescent: () => 8,
  };
}
export async function whenFontReady() {}
