// Preload beside the extracted launcher. Observe a whole composed frame before swap.
import { channel } from 'node:diagnostics_channel';
import sharp from 'sharp';
let finished = false;
channel('solid.desktop.present').subscribe((gl) => {
  if (finished) return;
  const width = gl.drawingBufferWidth,
    height = gl.drawingBufferHeight;
  const data = Buffer.alloc(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  let glyph = 0,
    panel = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) glyph++;
    if (data[i] === 20 && data[i + 1] === 34 && data[i + 2] === 53) panel++;
  }
  if (glyph < 16 || panel < 100) return;
  finished = true;
  console.log(
    JSON.stringify({
      proof: 'composed text and panel',
      width,
      height,
      processMs: Math.round(process.uptime() * 1000),
      rssBytes: process.memoryUsage().rss,
    }),
  );
  const write = process.env.SOLID_DESKTOP_PNG
    ? sharp(data, { raw: { width, height, channels: 4 } })
        .flip()
        .png()
        .toFile(process.env.SOLID_DESKTOP_PNG)
    : Promise.resolve();
  write.then(
    () => setTimeout(() => process.emit('SIGTERM'), 0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
});
const timeout = setTimeout(() => {
  if (!finished) {
    console.error('No complete text frame');
    process.exit(1);
  }
}, 30000);
timeout.unref();
