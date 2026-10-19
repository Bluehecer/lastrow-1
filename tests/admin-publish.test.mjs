import assert from 'node:assert/strict';
import test from 'node:test';
import { publishRecordWithOptionalMedia } from '../admin-publish.mjs';

test('publishes the record even when an optional photo upload fails', async () => {
  const calls = [];
  const record = { id: 'product-1' };
  const result = await publishRecordWithOptionalMedia(
    async () => {
      calls.push('save');
      return record;
    },
    true,
    async () => {
      calls.push('upload');
      throw new Error('Storage permission denied');
    },
    async () => calls.push('attach'),
    async () => calls.push('cleanup')
  );

  assert.deepEqual(calls, ['save', 'upload']);
  assert.equal(result.record, record);
  assert.equal(result.mediaError.message, 'Storage permission denied');
  assert.equal(result.cleanupError, null);
});

test('publishes without optional media without trying an upload', async () => {
  const calls = [];
  const record = { id: 'product-1' };
  const result = await publishRecordWithOptionalMedia(
    async () => {
      calls.push('save');
      return record;
    },
    false,
    async () => calls.push('upload'),
    async () => calls.push('attach'),
    async () => calls.push('cleanup')
  );

  assert.deepEqual(calls, ['save']);
  assert.equal(result.record, record);
  assert.equal(result.mediaError, null);
  assert.equal(result.cleanupError, null);
});

test('cleans up an uploaded file if attaching it to the published record fails', async () => {
  const calls = [];
  const attachmentError = new Error('Could not attach media');
  const uploaded = { mediaPath: 'uploads/admin/photo.png' };
  const result = await publishRecordWithOptionalMedia(
    async () => ({ id: 'product-1' }),
    true,
    async () => {
      calls.push('upload');
      return uploaded;
    },
    async () => {
      calls.push('attach');
      throw attachmentError;
    },
    async (media) => calls.push(`cleanup:${media.mediaPath}`)
  );

  assert.deepEqual(calls, ['upload', 'attach', 'cleanup:uploads/admin/photo.png']);
  assert.equal(result.mediaError, attachmentError);
});

test('does not upload media if saving the published record fails', async () => {
  const calls = [];
  const saveError = new Error('Firestore unavailable');

  await assert.rejects(
    publishRecordWithOptionalMedia(
      async () => {
        calls.push('save');
        throw saveError;
      },
      true,
      async () => calls.push('upload'),
      async () => calls.push('attach'),
      async () => calls.push('cleanup')
    ),
    saveError
  );
  assert.deepEqual(calls, ['save']);
});
