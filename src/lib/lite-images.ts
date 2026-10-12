import { blocks, LITE_CATEGORIES, type LiteState } from "./lite-preferences";

const IMAGE_EXTENSION =
  /\.(?:avif|apng|bmp|gif|heic|heif|ico|jfif|jpeg|jpg|png|svg|tif|tiff|webp)$/;

// These are page namespaces; an image suffix does not turn them into assets.
const PAGE_PATH =
  /^\/(?:admin|account|members|notifications|conversations|threads|forums|awards|ui|search|credits|upgrade|login|register|lite|terms|privacy|contact|legal)(?:\/|$)/;
const UNSAFE_ASSET_PATH = /:|~\d+(?:\.|\/|$)/;

function imageCategory(path: string) {
  return LITE_CATEGORIES.find(
    ({ folders, files }) =>
      folders.some(
        (folder) =>
          path.startsWith(`/${folder}/`) &&
          !path.slice(folder.length + 2).includes("/"),
      ) || files.some((file) => path === `/${file}`),
  );
}

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
  const path = normalizeImagePath(pathname);
  if (path === "/_next/image" || path.startsWith("/_next/image/")) return true;
  const image = IMAGE_EXTENSION.test(path.split(":")[0]);
  if (imageCategory(path) && (image || UNSAFE_ASSET_PATH.test(path)))
    return true;
  if (PAGE_PATH.test(path) || path.split("/")[3] === "new") return false;
  return image || UNSAFE_ASSET_PATH.test(path);
}

export function blocksImageRequest(
  state: LiteState,
  pathname: string,
): boolean {
  const path = normalizeImagePath(pathname);
  if (!isImageRequest(pathname)) return false;
  if (UNSAFE_ASSET_PATH.test(path)) return true;
  if (path === "/_next/image" || path.startsWith("/_next/image/")) {
    return state.master || state.blocked.length > 0;
  }
  const category = imageCategory(path);
  return category
    ? blocks(state, category.key)
    : state.master || state.blocked.length > 0;
}

export function blocksContentImage(
  state: LiteState,
  source: string,
  origin?: string,
): boolean {
  if (blocks(state, "postImages")) return true;
  // A base origin lets relative paths use the same URL normalization as requests.
  const base = origin || "https://local.invalid";
  try {
    const url = new URL(source, base);
    if (url.origin !== new URL(base).origin) return false;
    return blocksImageRequest(state, url.pathname);
  } catch {
    return false;
  }
}
