// The hex-colour source transform of @lightningtv/vite-hex-transform as a
// webpack loader: every quoted "#RGB", "#RGBA", "#RRGGBB" or "#RRGGBBAA"
// string literal becomes the 0xRRGGBBAA number the renderer takes, so a
// source written against the vite plugin compiles the same way here.
const HEX_COLOR =
  /["']#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3}|[A-Fa-f0-9]{8}|[A-Fa-f0-9]{4})["']/g;

function expand(hex) {
  if (hex.length === 3 || hex.length === 4) {
    let out = '';
    for (let i = 0; i < hex.length; i++) {
      out += hex[i] + hex[i];
    }
    return out.length === 6 ? out + 'FF' : out;
  }
  return hex.length === 6 ? hex + 'FF' : hex;
}

function hexColorLoader(source, map) {
  // The source map of the loaders before this one goes on as it came: a
  // loader that returns only its code drops it, and the bundle then maps to
  // Babel's output rather than the app's source. A colour changes length but
  // never a line, so lines hold and a column after a colour on its line is
  // off by the difference. The third loader argument, `meta`, stays behind:
  // an AST in it would be the old source's.
  this.callback(
    null,
    source.replace(
      HEX_COLOR,
      (_match, hex) => '0x' + expand(hex).toUpperCase(),
    ),
    map,
  );
}

module.exports = hexColorLoader;
module.exports.HEX_COLOR = HEX_COLOR;
