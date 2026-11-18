// The platform adapter on its own, in the runtime without a window: local
// files in each form the renderer asks for, the image paths, and what must
// fail. run.mjs puts the fixtures next to the bundle.
import { DesktopPlatform } from '../../src/platform';

const platform = new DesktopPlatform();
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: unknown): void {
  if (!ok)
    failures.push(detail === undefined ? name : `${name}: ${String(detail)}`);
}

async function rejects(
  name: string,
  pattern: RegExp,
  action: () => Promise<unknown>,
): Promise<void> {
  try {
    await action();
    failures.push(`${name}: did not reject`);
  } catch (error) {
    check(
      name,
      pattern.test(String((error as Error).message)),
      (error as Error).message,
    );
  }
}

interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}
const rgba = (image: Pixels, x: number, y: number): string =>
  Array.from(
    image.data.subarray(
      (y * image.width + x) * 4,
      (y * image.width + x) * 4 + 4,
    ),
  ).join();

async function run(): Promise<void> {
  // Files: a path relative to the app, an absolute path and a file: URL
  // name the same file.
  const expected = JSON.stringify({ greeting: 'héllo wörld', list: [1, 2, 3] });
  const relative = await platform.fetch('fixtures/data.json', 'json');
  check(
    'json, relative path',
    JSON.stringify(relative) === expected,
    JSON.stringify(relative),
  );
  const absolute = await platform.fetch(
    `${__solid.appDir}/fixtures/data.json`,
    'json',
  );
  check('json, absolute path', JSON.stringify(absolute) === expected);
  const url = await platform.fetch(
    `file://${__solid.appDir}/fixtures/with%20space.json`,
    'json',
  );
  check('json, file: URL with an escape', JSON.stringify(url) === expected);

  const buffer = (await platform.fetch(
    'fixtures/colours.png',
    'arraybuffer',
  )) as ArrayBuffer;
  check(
    'arraybuffer',
    buffer instanceof ArrayBuffer && buffer.byteLength === 87,
    buffer.byteLength,
  );
  const blob = (await platform.fetch('fixtures/colours.png', 'blob')) as Blob;
  check(
    'blob is a Blob',
    blob instanceof Blob && blob.size === 87 && blob.type === 'image/png',
    `${blob.size} ${blob.type}`,
  );
  const copy = await blob.arrayBuffer();
  check(
    'blob.arrayBuffer',
    copy.byteLength === 87 && new Uint8Array(copy)[1] === 0x50,
  );

  await rejects('a missing file', /Cannot read .*missing\.png/, () =>
    platform.fetch('fixtures/missing.png', 'blob'),
  );
  await rejects('a missing JSON file', /Cannot read/, () =>
    platform.fetch('fixtures/missing.json', 'json'),
  );
  await rejects('JSON that is not JSON', /JSON/, () =>
    platform.fetch('fixtures/colours.webp.txt', 'json'),
  );
  await rejects('a network URL', /only local files are implemented/, () =>
    platform.fetch('https://example.com/a.png', 'blob'),
  );

  // Images: colours.png is 4 x 2; its fourth pixel is half-transparent red.
  const premultiplied = (await platform.createImageBitmap(
    blob,
  )) as unknown as Pixels;
  check('decode size', premultiplied.width === 4 && premultiplied.height === 2);
  check(
    'decode premultiplies by default',
    rgba(premultiplied, 3, 0) === '128,0,0,128',
    rgba(premultiplied, 3, 0),
  );
  const straight = (await platform.createImageBitmap(blob, {
    premultiplyAlpha: 'none',
  })) as unknown as Pixels;
  check(
    'decode, straight alpha',
    rgba(straight, 3, 0) === '255,0,0,128',
    rgba(straight, 3, 0),
  );
  const cropped = (await platform.createImageBitmap(blob, 1, 0, 2, 1, {
    premultiplyAlpha: 'none',
  })) as unknown as Pixels;
  check(
    'decode, cropped',
    cropped.width === 2 &&
      cropped.height === 1 &&
      rgba(cropped, 0, 0) === '0,255,0,255' &&
      rgba(cropped, 1, 0) === '0,0,255,255',
  );
  const webp = (await platform.createImageBitmap(
    (await platform.fetch('fixtures/colours.webp', 'blob')) as Blob,
  )) as unknown as Pixels;
  check('decode, WebP', rgba(webp, 2, 1) === '255,255,0,255', rgba(webp, 2, 1));
  const jpeg = (await platform.createImageBitmap(
    (await platform.fetch('fixtures/blocks.jpg', 'blob')) as Blob,
  )) as unknown as Pixels;
  check('decode, JPEG', jpeg.width === 16 && jpeg.height === 8);
  await rejects(
    'a source that is no Blob',
    /only a Blob source is implemented/,
    () => platform.createImageBitmap({} as ImageBitmapSource),
  );
  await rejects('an option that is not implemented', /not implemented/, () =>
    platform.createImageBitmap(blob, { imageOrientation: 'flipY' }),
  );
  await rejects('bytes that are no image', /Cannot decode the image/, () =>
    platform.createImageBitmap(new Blob([new Uint8Array(16)])),
  );

  // The <img> path: loads its src, then is an image source with straight alpha.
  const image = platform.createImage() as unknown as Pixels & HTMLImageElement;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('the image failed to load'));
    image.src = 'fixtures/colours.png';
  });
  check(
    'image element',
    image.width === 4 &&
      image.height === 2 &&
      rgba(image, 3, 0) === '255,0,0,128',
  );
  const broken = platform.createImage();
  const failed = await new Promise<boolean>((resolve) => {
    broken.onload = () => resolve(false);
    broken.onerror = () => resolve(true);
    broken.src = 'fixtures/missing.png';
  });
  check('image element reports a failed load', failed);

  // The Blob the renderer builds from a data URI.
  const joined = new Blob(
    [new Uint8Array([1, 2]), new Uint8Array([3]).buffer],
    { type: 'x/y' },
  );
  check(
    'Blob from parts',
    joined.size === 3 &&
      joined.type === 'x/y' &&
      new Uint8Array(await joined.arrayBuffer())[2] === 3,
  );
  try {
    new Blob(['text']);
    failures.push('Blob from text: did not throw');
  } catch (error) {
    check(
      'Blob from text',
      /only ArrayBuffer, typed array and Blob parts/.test(
        (error as Error).message,
      ),
      (error as Error).message,
    );
  }

  check('no script workers', platform.createWorker('') === null);
  check('never hidden', platform.hidden() === false);
}

run()
  .catch((error) => failures.push(`threw: ${(error as Error).stack}`))
  .then(() => {
    for (const failure of failures) console.log('FAILED', failure);
    console.log(
      'adapter:',
      failures.length === 0 ? 'ok' : `${failures.length} failed`,
    );
    __solid.exit(failures.length === 0 ? 0 : 1);
  });
