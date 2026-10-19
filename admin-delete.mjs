export async function deletePublishedContent(deleteRecord, mediaPath, deleteMedia) {
  await deleteRecord();
  if (!mediaPath) return null;

  try {
    await deleteMedia(mediaPath);
    return null;
  } catch (error) {
    return error;
  }
}
