const PROFILE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);

export const MAX_PROFILE_PHOTOS = 12;
export const MAX_PROFILE_PHOTO_BYTES = 8 * 1024 * 1024;

export function profileImageType(mediaType: string) {
  const normalized = mediaType.toLowerCase() === "image/jpg" ? "image/jpeg" : mediaType.toLowerCase();
  return PROFILE_IMAGE_TYPES.has(normalized) ? normalized : null;
}
