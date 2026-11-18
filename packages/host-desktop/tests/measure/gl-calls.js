// The cost of one call through the binding, for a call with no arguments to
// convert beyond numbers and one that reads a typed array in place.
var gl = __solid.gl;
var N = 1000000;
function time(name, body) {
  body(1000);
  var start = performance.now();
  body(N);
  var ns = ((performance.now() - start) * 1e6) / N;
  return name + ' ' + ns.toFixed(0) + ' ns';
}
var values = new Float32Array(4);
var empty = time('empty loop', function (n) {
  for (var i = 0; i < n; i++) {
    // The loop itself: what the other two times include.
  }
});
var scissor = time('gl.scissor(x, y, w, h)', function (n) {
  for (var i = 0; i < n; i++) gl.scissor(0, 0, 16, 16);
});
var uniform = time('gl.uniform4fv(null, Float32Array)', function (n) {
  for (var i = 0; i < n; i++) gl.uniform4fv(null, values);
});
print([empty, scissor, uniform].join('; '));
__solid.exit(0);
