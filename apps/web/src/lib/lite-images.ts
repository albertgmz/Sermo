import { blocks, type LiteState } from "./lite-preferences";

const IMAGE_EXTENSION =
  /\.(?:avif|apng|bmp|gif|heic|heif|ico|jfif|jpeg|jpg|png|svg|tif|tiff|webp)$/;

// These are page namespaces; an image suffix does not turn them into assets.
const PAGE_PATH =
  /^\/(?:admin|moderation|account|members|notifications|conversations|threads|forums|awards|ui|search|credits|upgrade|login|register|lite|terms|privacy|contact|legal|pages)(?:\/|$)/;
const UNSAFE_ASSET_PATH = /:|~\d+(?:\.|\/|$)/;

function isPagePath(path: string) {
  return PAGE_PATH.test(path) || path.split("/")[3] === "new";
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
  for (const raw of pathname.replace(/\\/g, "/").split("/")) {
    // Win32 drops trailing dots and spaces from every name.
    const segment = raw.replace(/ +$/, "");
    if (segment === "..") segments.pop();
    else if (segment && segment !== ".") {
      const name = segment.replace(/[. ]+$/, "");
      if (name) segments.push(name);
    }
  }
  return `/${segments.join("/")}`.toLowerCase();
}

export function isImageRequest(pathname: string): boolean {
  const path = normalizeImagePath(pathname);
  if (path === "/_next/image" || path.startsWith("/_next/image/")) return true;
  const image = IMAGE_EXTENSION.test(path.split(":")[0]);
  if (isPagePath(path)) return false;
  return image;
}

// A path with a stream or short-name syntax that is neither a picture request
// nor a page path names nothing the site serves.
export function isUnknownUnsafePath(pathname: string): boolean {
  const path = normalizeImagePath(pathname);
  return (
    UNSAFE_ASSET_PATH.test(path) &&
    !isPagePath(path) &&
    !isImageRequest(pathname)
  );
}

export function blocksImageRequest(
  state: LiteState,
  pathname: string,
): boolean {
  const path = normalizeImagePath(pathname);
  if (!isImageRequest(pathname)) return false;
  if (path === "/_next/image" || path.startsWith("/_next/image/")) {
    return state.master || state.blocked.length > 0;
  }
  // The backend serves every picture, so none belongs to a category by its path: any selection
  // blocks it.
  return state.master || state.blocked.length > 0;
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
