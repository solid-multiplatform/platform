// Copy beside the packaged entry and preload it for the graphical smoke check.
import gl from 'webgl-raub';
let finished = false;
const draw = gl.drawElements.bind(gl);
gl.drawElements = (...args) => {
  draw(...args);
  if (finished) return;
  const width = gl.drawingBufferWidth,
    height = gl.drawingBufferHeight;
  const data = Buffer.alloc(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  let glyph = false,
    panel = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) glyph = true;
    if (data[i] === 20 && data[i + 1] === 34 && data[i + 2] === 53)
      panel = true;
    if (glyph && panel) {
      finished = true;
      console.log(
        JSON.stringify({
          proof: 'text and panel drawn',
          width,
          height,
          processMs: Math.round(process.uptime() * 1000),
          rssBytes: process.memoryUsage().rss,
        }),
      );
      setTimeout(() => process.emit('SIGTERM'), 0);
      break;
    }
  }
};
const timeout = setTimeout(() => {
  if (!finished) {
    console.error('No rendered desktop text');
    process.exit(1);
  }
}, 30000);
timeout.unref();
