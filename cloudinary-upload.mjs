const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export async function uploadMediaToCloudinary(file, config, fetchImpl = fetch) {
  if (!file) throw new Error('Choose a photo or video to upload.');
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Please choose a photo or video smaller than 50 MB.');
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    throw new Error('Choose an image or video file.');
  }
  if (!config.cloudName || !config.uploadPreset) {
    throw new Error('Add your Cloudinary cloud name and unsigned upload preset to cloudinary-config.js.');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', config.uploadPreset);
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/auto/upload`;

  const response = await fetchImpl(endpoint, { method: 'POST', body: formData });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Cloudinary returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!result || typeof result !== 'object') {
    throw new Error('Cloudinary returned an invalid upload response.');
  }
  if (!response.ok) {
    throw new Error(result.error && result.error.message || `Cloudinary upload failed (HTTP ${response.status}).`);
  }
  if (!result.secure_url || !result.resource_type || !result.format || !result.public_id) {
    throw new Error('Cloudinary did not return a usable media URL.');
  }

  return {
    mediaUrl: result.secure_url,
    mediaType: `${result.resource_type}/${result.format}`,
    mediaPublicId: result.public_id,
    mediaResourceType: result.resource_type
  };
}
