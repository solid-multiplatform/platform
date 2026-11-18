export async function getAppMemoryMonitor() {
  return null;
}
/** A Roku that draws the Effect node: Roku OS 16 on OpenGL. */
export function getDeviceInfo() {
  return { osVersion: { major: '16', minor: '0' }, graphicsPlatform: 'opengl' };
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
