// Decodes each supported format on the worker pool and checks the pixels;
// then the crop, the premultiply option, and the two ways a load fails.
// Runs without a window: decoding needs none.
var failures = [];
var pending = 0;
function check(name, ok, detail) {
  if (!ok) failures.push(name + (detail === undefined ? '' : ': ' + detail));
}
function finish() {
  if (--pending !== 0) return;
  for (var i = 0; i < failures.length; i++) print('FAILED', failures[i]);
  print('images:', failures.length === 0 ? 'ok' : failures.length + ' failed');
  __solid.exit(failures.length === 0 ? 0 : 6);
}
function rgba(image, x, y) {
  var at = (y * image.width + x) * 4;
  return [
    image.data[at],
    image.data[at + 1],
    image.data[at + 2],
    image.data[at + 3],
  ];
}
function expect(name, image, x, y, expected, tolerance) {
  var actual = rgba(image, x, y);
  var ok = true;
  for (var i = 0; i < 4; i++)
    if (Math.abs(actual[i] - expected[i]) > (tolerance || 0)) ok = false;
  check(name, ok, actual.join(',') + ' != ' + expected.join(','));
}
function load(file, crop, premultiply, done) {
  pending++;
  __solid.readFile(
    __solid.appDir + '/fixtures/' + file,
    function (error, encoded) {
      if (error) throw error;
      __solid.decodeImage(
        encoded,
        crop[0],
        crop[1],
        crop[2],
        crop[3],
        premultiply,
        function (error, image) {
          done(error, image);
          finish();
        },
      );
    },
  );
}

// colours.png and colours.webp hold the same 4x2 pixels: red, green, blue,
// half-transparent red; white, black, yellow, transparent.
['colours.png', 'colours.webp'].forEach(function (file) {
  load(file, [], false, function (error, image) {
    check(file + ' decodes', error === null, error);
    check(
      file + ' size',
      image.width === 4 && image.height === 2 && image.data.length === 32,
    );
    check(file + ' is a Uint8Array', image.data instanceof Uint8Array);
    expect(file + ' red', image, 0, 0, [255, 0, 0, 255]);
    expect(file + ' blue', image, 2, 0, [0, 0, 255, 255]);
    expect(file + ' straight alpha', image, 3, 0, [255, 0, 0, 128]);
    expect(file + ' yellow', image, 2, 1, [255, 255, 0, 255]);
    image.close();
    check(file + ' closes', image.data.length === 0);
  });
  load(file, [], true, function (error, image) {
    expect(file + ' premultiplied', image, 3, 0, [128, 0, 0, 128]);
    expect(file + ' opaque unchanged', image, 0, 0, [255, 0, 0, 255]);
  });
});
// The rectangle starts one pixel in and runs one past the right edge and one
// below the bottom: what lies outside the image is transparent.
load('colours.png', [1, 1, 4, 2], false, function (error, image) {
  check('crop size', image.width === 4 && image.height === 2);
  expect('crop, first pixel', image, 0, 0, [0, 0, 0, 255]);
  expect('crop, yellow', image, 1, 0, [255, 255, 0, 255]);
  expect('crop, past the right edge', image, 3, 0, [0, 0, 0, 0]);
  expect('crop, below the image', image, 0, 1, [0, 0, 0, 0]);
});
load('blocks.jpg', [], true, function (error, image) {
  check('jpeg decodes', error === null, error);
  check('jpeg size', image.width === 16 && image.height === 8);
  expect('jpeg, left block', image, 3, 3, [200, 40, 40, 255], 6);
  expect('jpeg, right block', image, 12, 3, [40, 40, 200, 255], 6);
});

pending++;
__solid.decodeImage(
  new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
  undefined,
  undefined,
  undefined,
  undefined,
  false,
  function (error, image) {
    check(
      'bytes that are no image fail',
      error instanceof Error &&
        /Cannot decode the image/.test(error.message) &&
        image === undefined,
      error,
    );
    finish();
  },
);
pending++;
__solid.readFile(
  __solid.appDir + '/fixtures/missing.png',
  function (error, data) {
    check(
      'a missing file fails',
      error instanceof Error &&
        /Cannot read .*missing\.png/.test(error.message) &&
        data === undefined,
      error,
    );
    finish();
  },
);
