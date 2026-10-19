import assert from 'node:assert/strict';
import test from 'node:test';
import { deletePublishedContent } from '../admin-delete.mjs';

test('deletes the published record before attempting media cleanup', async () => {
  const operations = [];
  const cleanupError = await deletePublishedContent(
    async () => operations.push('record'),
    'uploads/admin/item.jpg',
    async (path) => operations.push(`media:${path}`)
  );

  assert.equal(cleanupError, null);
  assert.deepEqual(operations, ['record', 'media:uploads/admin/item.jpg']);
});

test('keeps deletion successful when media cleanup fails and exposes the cleanup error', async () => {
  const operations = [];
  const mediaError = new Error('Storage permission denied');
  const cleanupError = await deletePublishedContent(
    async () => operations.push('record'),
    'uploads/admin/item.jpg',
    async () => {
      operations.push('media');
      throw mediaError;
    }
  );

  assert.deepEqual(operations, ['record', 'media']);
  assert.equal(cleanupError, mediaError);
});

test('does not try media cleanup if deleting the published record fails', async () => {
  const operations = [];
  const recordError = new Error('Firestore permission denied');

  await assert.rejects(
    deletePublishedContent(
      async () => {
        operations.push('record');
        throw recordError;
      },
      'uploads/admin/item.jpg',
      async () => operations.push('media')
    ),
    recordError
  );
  assert.deepEqual(operations, ['record']);
});
