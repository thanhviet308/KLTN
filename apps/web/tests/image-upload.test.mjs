import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOptimizedImageName,
  classifyChatUpload,
  fitImageDimensions,
  prepareChatUploadFile,
} from '../src/features/chat/image-upload.ts';

test('classifyChatUpload accepts standard, jpg-alias, and extension-fallback images', () => {
  assert.equal(
    classifyChatUpload({ name: 'photo.jpg', type: 'image/jpeg' }),
    'image',
  );
  assert.equal(
    classifyChatUpload({ name: 'photo.jpg', type: 'image/jpg' }),
    'image',
  );
  assert.equal(
    classifyChatUpload({ name: 'PHOTO.PNG', type: ' IMAGE/PNG ' }),
    'image',
  );
  assert.equal(
    classifyChatUpload({
      name: 'shot.webp',
      type: 'image/webp; charset=binary',
    }),
    'image',
  );
  assert.equal(
    classifyChatUpload({ name: 'inbound123.jpg', type: '' }),
    'image',
  );
  assert.equal(
    classifyChatUpload({
      name: 'camera.jpeg',
      type: 'application/octet-stream',
    }),
    'image',
  );
  assert.equal(
    classifyChatUpload({ name: 'anim.gif', type: 'image/gif' }),
    'file',
  );
  assert.equal(
    classifyChatUpload({ name: 'notes.pdf', type: 'application/pdf' }),
    'file',
  );
  assert.equal(classifyChatUpload({ name: 'archive.zip', type: '' }), 'file');
});

test('fitImageDimensions preserves aspect ratio within 2048px bounds', () => {
  assert.deepEqual(fitImageDimensions(1280, 720), { width: 1280, height: 720 });
  assert.deepEqual(fitImageDimensions(4096, 3072), {
    width: 2048,
    height: 1536,
  });
  assert.deepEqual(fitImageDimensions(3024, 4032), {
    width: 1536,
    height: 2048,
  });
  assert.deepEqual(fitImageDimensions(6000, 100), { width: 2048, height: 34 });
  assert.deepEqual(fitImageDimensions(0, 100), { width: 0, height: 0 });
  assert.deepEqual(fitImageDimensions(-10, 100), { width: 0, height: 0 });
});

test('buildOptimizedImageName replaces extensions and stays DTO-safe within 255 chars', () => {
  assert.equal(
    buildOptimizedImageName('inbound4723976052364938124.jpg', 'image/webp'),
    'inbound4723976052364938124.webp',
  );
  assert.equal(
    buildOptimizedImageName('dir/sub\\shot.png', 'image/jpeg'),
    'dir_sub_shot.jpg',
  );
  assert.equal(buildOptimizedImageName('', 'image/webp'), 'image.webp');

  const veryLong = `${'a'.repeat(300)}.jpeg`;
  const truncated = buildOptimizedImageName(veryLong, 'image/webp');
  assert.equal(truncated.length, 255);
  assert.ok(truncated.endsWith('.webp'));
  assert.match(truncated, /^[^\x00-\x1f\x7f/\\]+$/);
});

test('prepareChatUploadFile falls back safely when canvas APIs are unavailable', async () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'inbound123.jpg', {
    type: 'image/jpg',
  });
  const result = await prepareChatUploadFile(file);
  assert.equal(result.type, 'image');
  assert.equal(result.file, file);
});
