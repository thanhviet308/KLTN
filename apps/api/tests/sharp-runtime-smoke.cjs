const assert = require('node:assert/strict');
const sharp = require('sharp');

async function main() {
  if (process.argv.includes('--source')) {
    const addons = Object.keys(require.cache).filter((path) =>
      path.endsWith('.node'),
    );
    assert(
      addons.some((path) =>
        /sharp[\\/]src[\\/]build[\\/]Release[\\/]sharp-linux-x64-/.test(path),
      ),
      'Sharp must load the locally compiled addon',
    );
    assert(
      !addons.some((path) => /@img[\\/]sharp-/.test(path)),
      'Prebuilt Sharp must not load',
    );
    assert.equal(sharp.versions.vips, '8.18.7');
  }
  sharp.concurrency(1);
  const raw = Buffer.alloc(96 * 64 * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = i % 251;
  for (const format of ['jpeg', 'png', 'webp']) {
    assert(sharp.format[format].input.buffer, `${format} decoder missing`);
    assert(sharp.format[format].output.buffer, `${format} encoder missing`);
    const encoded = await sharp(raw, {
      raw: { width: 96, height: 64, channels: 3 },
    })
      .toFormat(format)
      .toBuffer();
    const metadata = await sharp(encoded).metadata();
    assert.equal(metadata.format, format);
    assert.equal(metadata.width, 96);
    assert.equal(metadata.height, 64);
    // Exercise the avatar pipeline, including EXIF autorotation.
    const oriented =
      format === 'jpeg'
        ? await sharp(encoded)
            .withMetadata({ orientation: 6 })
            .jpeg()
            .toBuffer()
        : encoded;
    const output = await sharp(oriented, { limitInputPixels: 16000000 })
      .rotate()
      .resize(32, 32, { fit: 'cover' })
      .webp({ quality: 80 })
      .toBuffer();
    const result = await sharp(output).metadata();
    assert.equal(result.format, 'webp');
    assert.equal(result.width, 32);
    assert.equal(result.height, 32);
    const decoded = await sharp(output).raw().toBuffer();
    assert.equal(decoded.length, 32 * 32 * 3);
    const chat = await sharp(encoded)
      .rotate()
      .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    assert.equal((await sharp(chat).metadata()).width, 96);
    console.log(`${format}: encode, decode, rotate, avatar and chat resize OK`);
  }
  await assert.rejects(sharp(Buffer.from('invalid image')).webp().toBuffer());
  console.log(
    JSON.stringify({
      node: process.version,
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
    }),
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
