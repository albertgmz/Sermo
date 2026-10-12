import { blocks, LITE_CATEGORIES, type LiteState } from "./lite-preferences";

const IMAGE_EXTENSION =
  /\.(?:avif|apng|bmp|gif|heic|heif|ico|jfif|jpeg|jpg|png|svg|tif|tiff|webp)$/;

// These are page namespaces; an image suffix does not turn them into assets.
const PAGE_PATH =
  /^\/(?:admin|account|members|notifications|conversations|threads|forums|awards|ui|search|credits|upgrade|login|register|lite|terms|privacy|contact|legal)(?:\/|$)/;
const UNSAFE_ASSET_PATH = /:|~\d+(?:\.|\/|$)/;

// A short name (THREAD~1) or a stream (logo.svg::$DATA) can address a
// registered folder or file without spelling its name.
function aliasCategory(path: string) {
  const first = path.split("/")[1]?.split(":")[0] ?? "";
  const stem = /^([^~]+)~\d+(?:\.|$)/.exec(first)?.[1];
  return LITE_CATEGORIES.find(
    ({ folders, files }) =>
      folders.some(
        (folder) =>
          folder === first ||
          (stem && folder.replace(/[^a-z\d]/g, "").slice(0, 6) === stem),
      ) || files.some((file) => file === first),
  );
}

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

function categoryOf(path: string) {
  return (
    imageCategory(path) ??
    (UNSAFE_ASSET_PATH.test(path) ? aliasCategory(path) : undefined)
  );
}

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
  if (categoryOf(path) && (image || UNSAFE_ASSET_PATH.test(path))) return true;
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

// "forums" and "awards" are page namespaces and picture folders at once. For a
// picture-looking path directly inside one, returns [folder, file name] so the
// caller can tell a real public file from a page path with a stray suffix.
export function pictureInPageFolder(
  pathname: string,
): [folder: string, name: string] | null {
  const path = normalizeImagePath(pathname);
  const [, folder, name, ...rest] = path.split(":")[0].split("/");
  if (!folder || !name || rest.length) return null;
  const owned = LITE_CATEGORIES.some(({ folders }) =>
    (folders as readonly string[]).includes(folder),
  );
  const image = IMAGE_EXTENSION.test(path.split(":")[0]);
  return owned &&
    PAGE_PATH.test(`/${folder}/`) &&
    (image || UNSAFE_ASSET_PATH.test(path))
    ? [folder, name]
    : null;
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
  const category = categoryOf(path);
  // An alias inside a registered folder cannot be tied to one file, so it is
  // answered with the placeholder whatever is selected.
  if (category && UNSAFE_ASSET_PATH.test(path)) return true;
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
