import { blocks, LITE_CATEGORIES, type LiteState } from "./lite-preferences";

const IMAGE_EXTENSION =
  /\.(?:avif|apng|bmp|gif|heic|heif|ico|jfif|jpeg|jpg|png|svg|tif|tiff|webp)$/;

export function normalizeImagePath(pathname: string): string {
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    pathname = pathname.replace(/(?:%[\da-f]{2})+/gi, (encoded) => {
      try {
        return decodeURIComponent(encoded);
      } catch {
        return encoded;
      }
    });
  }
  const segments: string[] = [];
  for (const segment of pathname.replace(/\\/g, "/").split("/")) {
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") segments.push(segment);
  }
  return `/${segments.join("/")}`.toLowerCase();
}

export function isImageRequest(pathname: string): boolean {
  return IMAGE_EXTENSION.test(normalizeImagePath(pathname));
}

export function blocksImageRequest(
  state: LiteState,
  pathname: string,
): boolean {
  const path = normalizeImagePath(pathname);
  if (path === "/_next/image" || path.startsWith("/_next/image/")) {
    return state.master || state.blocked.length > 0;
  }
  if (!IMAGE_EXTENSION.test(path)) return false;
  const category = LITE_CATEGORIES.find(
    ({ folders, files }) =>
      folders.some((folder) => path.startsWith(`/${folder}/`)) ||
      files.some((file) => path === `/${file}`),
  );
  return category ? blocks(state, category.key) : state.master;
}
