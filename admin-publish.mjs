export async function publishRecordWithOptionalMedia(
  saveRecord,
  hasMedia,
  uploadMedia,
  attachMedia,
  cleanupMedia
) {
  const record = await saveRecord();
  if (!hasMedia) return { record, mediaError: null, cleanupError: null };

  let uploaded;
  try {
    uploaded = await uploadMedia();
    await attachMedia(record, uploaded);
    return { record, mediaError: null, cleanupError: null };
  } catch (mediaError) {
    let cleanupError = null;
    if (uploaded) {
      try {
        await cleanupMedia(uploaded);
      } catch (error) {
        cleanupError = error;
      }
    }
    return { record, mediaError, cleanupError };
  }
}
