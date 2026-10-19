export const escapeDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

export function validatePublishingDate(collectionName, date) {
  if ((collectionName === 'events' || collectionName === 'news') && !escapeDate(date)) {
    throw new Error('Choose a valid date.');
  }
}
