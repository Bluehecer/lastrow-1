import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadMediaToCloudinary } from '../cloudinary-upload.mjs';

const config = { cloudName: 'lastrow-demo', uploadPreset: 'lastrow_unsigned' };

test('uploads supported media to Cloudinary and returns fields for Firestore', async () => {
  let request;
  const file = new Blob(['image bytes'], { type: 'image/jpeg' });
  const result = await uploadMediaToCloudinary(file, config, async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        secure_url: 'https://res.cloudinary.com/lastrow-demo/image/upload/photo.jpg',
        resource_type: 'image',
        format: 'jpg',
        public_id: 'lastrow/photo'
      })
    };
  });

  assert.equal(request.url, 'https://api.cloudinary.com/v1_1/lastrow-demo/auto/upload');
  assert.equal(request.options.method, 'POST');
  const uploadedFile = request.options.body.get('file');
  assert.equal(uploadedFile.type, file.type);
  assert.equal(uploadedFile.size, file.size);
  assert.equal(request.options.body.get('upload_preset'), 'lastrow_unsigned');
  assert.deepEqual(result, {
    mediaUrl: 'https://res.cloudinary.com/lastrow-demo/image/upload/photo.jpg',
    mediaType: 'image/jpg',
    mediaPublicId: 'lastrow/photo',
    mediaResourceType: 'image'
  });
});

test('supports video uploads through Cloudinary auto resource type', async () => {
  const file = new Blob(['video bytes'], { type: 'video/mp4' });
  const result = await uploadMediaToCloudinary(file, config, async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      secure_url: 'https://res.cloudinary.com/lastrow-demo/video/upload/clip.mp4',
      resource_type: 'video',
      format: 'mp4',
      public_id: 'lastrow/clip'
    })
  }));

  assert.equal(result.mediaType, 'video/mp4');
});

test('rejects upload when Cloudinary configuration is missing', async () => {
  const file = new Blob(['image bytes'], { type: 'image/jpeg' });
  await assert.rejects(
    uploadMediaToCloudinary(file, { cloudName: '', uploadPreset: '' }, async () => {}),
    /cloud name and unsigned upload preset/
  );
});

test('reports Cloudinary errors without pretending an upload succeeded', async () => {
  const file = new Blob(['image bytes'], { type: 'image/jpeg' });
  await assert.rejects(
    uploadMediaToCloudinary(file, config, async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Upload preset is invalid' } })
    })),
    { message: 'Upload preset is invalid' }
  );
});
