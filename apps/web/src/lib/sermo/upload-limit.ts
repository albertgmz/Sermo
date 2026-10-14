// The size a file may have, as the pages and the upload routes both say it. No server-only module
// is imported here: the forms read it too.

// The purposes of the site's catalogs and identity, whose pictures keep this size whatever the
// site allows members; the backend states it in `site.get`. A test compares this list with the
// backend's.
export const CATALOG_PURPOSES: readonly string[] = [
  "frame",
  "cover_preset",
  "thread_cover",
  "award_image",
  "shop_image",
  "site_logo",
  "site_icon",
  "site_backdrop",
  "reaction_image",
];
export const CATALOG_UPLOAD_BYTES = 25 * 1024 * 1024;

// The most a file for this purpose may have, or null when the site's limit is not known.
export function uploadLimit(
  purpose: string,
  siteBytes: number | null,
): number | null {
  return CATALOG_PURPOSES.includes(purpose) ? CATALOG_UPLOAD_BYTES : siteBytes;
}

// A size in megabytes as a plain number of at most one decimal, rounded down so the number shown
// is never above the limit.
export function megabytes(bytes: number): string {
  return String(Math.floor((bytes / 1024 ** 2) * 10) / 10);
}
