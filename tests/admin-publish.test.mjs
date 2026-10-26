import assert from 'node:assert/strict';
import test from 'node:test';
import { publishRecordWithOptionalMedia } from '../admin-publish.mjs';

test('uploads media before saving one record with the returned media fields', async () => {
  const calls = [];
  const media = { mediaUrl: 'https://res.cloudinary.com/demo/image/upload/photo.jpg' };
  const record = { id: 'product-1' };
  const result = await publishRecordWithOptionalMedia(
    async (savedMedia) => {
      calls.push(['save', savedMedia]);
      return record;
    },
    true,
    async () => {
      calls.push(['upload']);
      return media;
    }
  );

  assert.deepEqual(calls, [['upload'], ['save', media]]);
  assert.equal(result.record, record);
  assert.equal(result.media, media);
});

test('does not create a Firestore record when the media upload fails', async () => {
  const calls = [];
  const uploadError = new Error('Cloudinary upload failed');

  await assert.rejects(
    publishRecordWithOptionalMedia(
      async () => {
        calls.push('save');
      },
      true,
      async () => {
        calls.push('upload');
        throw uploadError;
      }
    ),
    uploadError
  );
  assert.deepEqual(calls, ['upload']);
});

test('saves a record without media when no file was selected', async () => {
  const calls = [];
  const record = { id: 'product-1' };
  const result = await publishRecordWithOptionalMedia(
    async (media) => {
      calls.push(['save', media]);
      return record;
    },
    false,
    async () => calls.push(['upload'])
  );

  assert.deepEqual(calls, [['save', {}]]);
  assert.equal(result.record, record);
  assert.deepEqual(result.media, {});
});
