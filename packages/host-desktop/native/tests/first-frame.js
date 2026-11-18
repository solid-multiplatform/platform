// Draws three red frames, checks the pixel that reached the back buffer, then
// leaves the scene idle for two seconds. While idle the loop may wake only for
// the timer that ends the test, and must run no frame.
var gl = __solid.gl;
var frames = 0;
function draw(time) {
  gl.clearColor(1, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  frames++;
  if (frames < 3) return requestAnimationFrame(draw);
  var rgba = new Uint8Array(4);
  gl.readPixels(10, 10, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  var pixel =
    ((rgba[0] << 24) | (rgba[1] << 16) | (rgba[2] << 8) | rgba[3]) >>> 0;
  setTimeout(function () {
    var before = __solid.stats();
    setTimeout(function () {
      var after = __solid.stats();
      var wakeups = after.wakeups - before.wakeups;
      var idleFrames = after.frames - before.frames;
      print(
        'pixel',
        pixel.toString(16),
        'frames',
        frames,
        'idle wakeups',
        wakeups,
        'idle frames',
        idleFrames,
      );
      var ok =
        pixel === 0xff0000ff &&
        typeof time === 'number' &&
        wakeups <= 1 &&
        idleFrames === 0;
      __solid.exit(ok ? 0 : 4);
    }, 2000);
  }, 0);
}
requestAnimationFrame(draw);
