// The GL binding without the renderer: a shader program end to end, texture
// uploads in each form WebGL has, the unpack settings GL lacks, extensions,
// and the errors a caller must be able to see. Draws in one animation frame
// and reads the pixels back before the frame is presented.
var gl = __solid.gl;
var failures = [];
function check(name, ok, detail) {
  if (!ok) failures.push(name + (detail === undefined ? '' : ': ' + detail));
}
function throws(name, pattern, action) {
  try {
    action();
    failures.push(name + ': did not throw');
  } catch (error) {
    check(name, pattern.test(String(error.message)), error.message);
  }
}
function near(actual, expected) {
  for (var i = 0; i < expected.length; i++)
    if (Math.abs(actual[i] - expected[i]) > 2) return false;
  return true;
}
function pixel(x, y) {
  var rgba = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  return [rgba[0], rgba[1], rgba[2], rgba[3]];
}
function expectPixel(name, x, y, expected) {
  var actual = pixel(x, y);
  check(
    name,
    near(actual, expected),
    actual.join(',') + ' != ' + expected.join(','),
  );
}

function shader(type, source) {
  var object = gl.createShader(type);
  gl.shaderSource(object, source);
  gl.compileShader(object);
  return object;
}
function program(vertex, fragment, attributes) {
  var object = gl.createProgram();
  var vs = shader(gl.VERTEX_SHADER, vertex);
  var fs = shader(gl.FRAGMENT_SHADER, fragment);
  check(
    'vertex shader compiles',
    gl.getShaderParameter(vs, gl.COMPILE_STATUS) === true,
    gl.getShaderInfoLog(vs),
  );
  check(
    'fragment shader compiles',
    gl.getShaderParameter(fs, gl.COMPILE_STATUS) === true,
    gl.getShaderInfoLog(fs),
  );
  gl.attachShader(object, vs);
  gl.attachShader(object, fs);
  for (var i = 0; i < attributes.length; i++)
    gl.bindAttribLocation(object, i, attributes[i]);
  gl.linkProgram(object);
  check(
    'program links',
    gl.getProgramParameter(object, gl.LINK_STATUS) === true,
    gl.getProgramInfoLog(object),
  );
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return object;
}

// WebGL 1 shaders, as the renderer writes them: no #version, attribute and
// varying, gl_FragColor.
var VERTEX =
  'attribute vec2 a_position;attribute vec2 a_uv;uniform vec4 u_rect;varying vec2 v_uv;' +
  'void main(){v_uv=a_uv;gl_Position=vec4(u_rect.xy+a_position*u_rect.zw,0.0,1.0);}';
var COLOUR =
  'precision mediump float;uniform vec4 u_colour;void main(){gl_FragColor=u_colour;}';
var TEXTURED =
  'precision mediump float;uniform sampler2D u_texture;varying vec2 v_uv;' +
  'void main(){gl_FragColor=texture2D(u_texture,v_uv);}';

function draw() {
  var width = gl.drawingBufferWidth;
  var height = gl.drawingBufferHeight;
  check(
    'drawing buffer size',
    width === 1280 && height === 720,
    width + 'x' + height,
  );
  check('context is not lost', gl.isContextLost() === false);
  check(
    'constants',
    gl.TRIANGLES === 4 &&
      gl.RGBA === 0x1908 &&
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL === 0x9241,
  );
  check(
    'limits',
    gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 2048 &&
      gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) >= 8,
  );
  print('GL', gl.getParameter(gl.VERSION), '|', gl.getParameter(gl.RENDERER));

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // One unit quad for everything, in a vertex array object: positions and
  // texture coordinates interleaved, drawn with indices.
  var vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  var vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  var indices = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2, 2, 1, 3]),
    gl.STATIC_DRAW,
  );
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);

  // 1. A coloured quad over the left half of clip space's lower-left
  // quarter, through each way of setting a uniform.
  var colour = program(VERTEX, COLOUR, ['a_position', 'a_uv']);
  check('attribute location', gl.getAttribLocation(colour, 'a_position') === 0);
  check('missing attribute', gl.getAttribLocation(colour, 'a_nothing') === -1);
  check(
    'missing uniform is null',
    gl.getUniformLocation(colour, 'u_nothing') === null,
  );
  gl.useProgram(colour);
  var rect = gl.getUniformLocation(colour, 'u_rect');
  var tint = gl.getUniformLocation(colour, 'u_colour');
  gl.uniform4f(rect, -1, -1, 0.5, 1);
  gl.uniform4f(tint, 1, 0.5, 0, 1);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  expectPixel('quad, uniform4f', 100, 100, [255, 128, 0, 255]);
  expectPixel('outside the quad', 400, 100, [0, 0, 0, 255]);
  gl.uniform4fv(tint, new Float32Array([0, 1, 0, 1]));
  gl.drawElements(gl.TRIANGLES, 3, gl.UNSIGNED_SHORT, 6);
  expectPixel('second triangle, uniform4fv', 300, 340, [0, 255, 0, 255]);
  expectPixel('first triangle untouched', 20, 20, [255, 128, 0, 255]);
  // WebGL ignores a uniform set through a null location.
  gl.uniform4f(null, 1, 1, 1, 1);
  gl.uniform4fv(null, new Float32Array(4));
  check('null location is ignored', gl.getError() === gl.NO_ERROR);

  // 2. A texture from bytes, drawn; then the same texture read back through
  // a framebuffer, which is how the uploads below are checked exactly.
  var textured = program(VERTEX, TEXTURED, ['a_position', 'a_uv']);
  gl.useProgram(textured);
  gl.uniform4f(gl.getUniformLocation(textured, 'u_rect'), 0, 0, 1, 1);
  function texture() {
    var object = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, object);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return object;
  }
  var framebuffer = gl.createFramebuffer();
  function texel(object, x, y) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      object,
      0,
    );
    check(
      'framebuffer complete',
      gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE,
    );
    var value = pixel(x, y);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return value;
  }
  function expectTexel(name, object, x, y, expected) {
    var actual = texel(object, x, y);
    check(
      name,
      near(actual, expected),
      actual.join(',') + ' != ' + expected.join(','),
    );
  }

  var two = texture();
  // Row 0: red, half-transparent green. Row 1: blue, white.
  var bytes = new Uint8Array([
    255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 255, 255, 255, 255,
  ]);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    2,
    2,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bytes,
  );
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  expectPixel('textured quad, first texel', 700, 400, [255, 0, 0, 255]);
  expectPixel('textured quad, last texel', 1200, 700, [255, 255, 255, 255]);
  expectTexel('bytes upload as written', two, 1, 0, [0, 255, 0, 128]);

  // 3. The settings GL does not have.
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    2,
    2,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bytes,
  );
  expectTexel('premultiplied on upload', two, 1, 0, [0, 128, 0, 128]);
  check('the source is not modified', bytes[5] === 255);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    2,
    2,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    bytes,
  );
  expectTexel('flipped on upload', two, 0, 0, [0, 0, 255, 255]);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  // 4. The other upload forms.
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    4,
    4,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  expectTexel(
    'allocation without pixels is transparent',
    two,
    3,
    3,
    [0, 0, 0, 0],
  );
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    2,
    2,
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([9, 8, 7, 6]),
  );
  expectTexel('sub-image from bytes', two, 2, 2, [9, 8, 7, 6]);
  expectTexel('sub-image leaves the rest', two, 1, 2, [0, 0, 0, 0]);
  var imageData = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([10, 20, 30, 40]),
  };
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    imageData,
  );
  expectTexel('ImageData-shaped source', two, 0, 0, [10, 20, 30, 40]);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([1, 2, 3, 4]),
  });
  expectTexel('sub-image from a source', two, 0, 0, [1, 2, 3, 4]);

  // 5. A compressed texture: ETC2 is part of OpenGL ES 3. One 4x4 block of
  // one colour (base colour 0xF,0,0 plus the smallest modifier).
  var etc = gl.getExtension('WEBGL_compressed_texture_etc');
  check(
    'ETC2 is available',
    etc !== null && etc.COMPRESSED_RGB8_ETC2 === 0x9274,
  );
  check(
    'an extension is one object',
    gl.getExtension('WEBGL_compressed_texture_etc') === etc,
  );
  var compressed = texture();
  gl.compressedTexImage2D(
    gl.TEXTURE_2D,
    0,
    etc.COMPRESSED_RGB8_ETC2,
    4,
    4,
    0,
    new Uint8Array([0xff, 0, 0, 0, 0, 0, 0, 0]),
  );
  check('compressed upload accepted', gl.getError() === gl.NO_ERROR);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  var red = pixel(900, 500);
  check(
    'compressed texture draws',
    red[0] > 250 && red[1] < 8 && red[2] < 8,
    red.join(','),
  );

  // 6. Extensions: null for one nobody has, and a shader using one that is
  // there compiles as WebGL 1 writes it.
  check('unknown extension', gl.getExtension('WEBGL_no_such_thing') === null);
  check(
    'context loss cannot be forced',
    gl.getExtension('WEBGL_lose_context') === null,
  );
  if (gl.getExtension('OES_standard_derivatives') !== null) {
    program(
      VERTEX,
      '#extension GL_OES_standard_derivatives : enable\nprecision mediump float;varying vec2 v_uv;' +
        'void main(){gl_FragColor=vec4(fwidth(v_uv),0.0,1.0);}',
      ['a_position', 'a_uv'],
    );
  } else {
    print('note: no OES_standard_derivatives on this driver');
  }

  // 7. What must be loud.
  var broken = shader(gl.FRAGMENT_SHADER, 'void main(){ this is not GLSL }');
  check(
    'a bad shader reports',
    gl.getShaderParameter(broken, gl.COMPILE_STATUS) === false &&
      gl.getShaderInfoLog(broken).length > 0,
  );
  throws(
    'unimplemented call names itself',
    /gl\.stencilFunc is not implemented/,
    function () {
      gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    },
  );
  throws('short pixel buffer', /need 16 bytes, the source has 15/, function () {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      2,
      2,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(15),
    );
  });
  throws('short read buffer', /gl\.readPixels/, function () {
    gl.readPixels(0, 0, 2, 2, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(15));
  });
  throws('other pixel formats', /only RGBA with UNSIGNED_BYTE/, function () {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGB,
      1,
      1,
      0,
      gl.RGB,
      gl.UNSIGNED_BYTE,
      new Uint8Array(3),
    );
  });
  throws(
    'uniform from a plain array',
    /gl\.uniform4fv: expected a Float32Array/,
    function () {
      gl.uniform4fv(tint, [1, 1, 1, 1]);
    },
  );
  throws(
    'unknown parameter',
    /gl\.getParameter: parameter 0x0d3a/,
    function () {
      gl.getParameter(gl.MAX_VIEWPORT_DIMS);
    },
  );
  throws(
    'unknown pixel store',
    /gl\.pixelStorei: parameter 0x9243/,
    function () {
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    },
  );
  throws(
    'source that is no image',
    /gl\.texImage2D: the source must be/,
    function () {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, {
        width: 1,
        height: 1,
      });
    },
  );

  gl.deleteTexture(two);
  gl.deleteTexture(compressed);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteBuffer(vertices);
  gl.deleteBuffer(indices);
  gl.deleteVertexArray(vao);
  gl.deleteProgram(colour);
  gl.deleteProgram(textured);
  check('no GL error', gl.getError() === gl.NO_ERROR);
}

// A decoded image uploads without a copy and ignores the unpack settings,
// as an ImageBitmap does; closed, it cannot be uploaded.
function decoded(done) {
  __solid.readFile(
    __solid.appDir + '/fixtures/colours.png',
    function (error, encoded) {
      if (error) throw error;
      __solid.decodeImage(
        encoded,
        undefined,
        undefined,
        undefined,
        undefined,
        true,
        function (error, image) {
          if (error) throw error;
          requestAnimationFrame(function () {
            var object = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, object);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              gl.RGBA,
              gl.RGBA,
              gl.UNSIGNED_BYTE,
              image,
            );
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            var framebuffer = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(
              gl.FRAMEBUFFER,
              gl.COLOR_ATTACHMENT0,
              gl.TEXTURE_2D,
              object,
              0,
            );
            // Premultiplied once, by the decoder: twice would read 64.
            expectPixel(
              'decoded image uploads as decoded',
              3,
              0,
              [128, 0, 0, 128],
            );
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            image.close();
            throws(
              'closed image',
              /gl\.texImage2D: .* need 32 bytes, the source has 0/,
              function () {
                gl.texImage2D(
                  gl.TEXTURE_2D,
                  0,
                  gl.RGBA,
                  gl.RGBA,
                  gl.UNSIGNED_BYTE,
                  image,
                );
              },
            );
            check('no GL error after the image', gl.getError() === gl.NO_ERROR);
            done();
          });
        },
      );
    },
  );
}

requestAnimationFrame(function () {
  draw();
  var before = __solid.stats().presents;
  decoded(function () {
    // The frame that drew was presented; the one that only filled a
    // texture and a framebuffer of its own was not.
    setTimeout(function () {
      check(
        'only the drawn frame was presented',
        __solid.stats().presents === before + 1,
        __solid.stats().presents - before,
      );
      for (var i = 0; i < failures.length; i++) print('FAILED', failures[i]);
      print(
        'gl binding:',
        failures.length === 0 ? 'ok' : failures.length + ' failed',
      );
      __solid.exit(failures.length === 0 ? 0 : 5);
    }, 0);
  });
});
