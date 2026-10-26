export async function publishRecordWithOptionalMedia(saveRecord, hasMedia, uploadMedia) {
  const media = hasMedia ? await uploadMedia() : {};
  const record = await saveRecord(media);
  return { record, media };
}
