import type { Metadata } from "next";
import { canonicalUrlOf } from "./addresses";

export type Seo = {
  title: string;
  description: string;
  canonical: string;
  robots: "index,follow" | "noindex,follow";
  jsonLd: unknown[];
};

// The head of a public page as the backend says it: title (already built from the site's
// template, so it replaces the layout's), description, canonical address and robots.
export function seoMetadata(seo: Seo): Metadata {
  return {
    title: { absolute: seo.title },
    description: seo.description || undefined,
    alternates: { canonical: canonicalUrlOf(seo.canonical) },
    robots: { index: seo.robots.startsWith("index"), follow: true },
  };
}

// A view the backend has no address for (a cursor, a prefix filter) is a copy of the one it has:
// it points there and stays out of the index.
export function copyOf(seo: Seo): Seo {
  return { ...seo, robots: "noindex,follow", jsonLd: [] };
}

// The properties that carry a picture's address in structured data.
const PICTURE_KEYS = new Set([
  "image",
  "images",
  "logo",
  "photo",
  "thumbnail",
  "thumbnailUrl",
  "contentUrl",
  "embedUrl",
  "primaryImageOfPage",
  "associatedMedia",
]);

// Pictures inside a text: Markdown images, any HTML tag (an image among them) and any address of
// a stored file.
const PICTURE_IN_TEXT: RegExp[] = [
  /!\[[^\]]*\]\([^)]*\)/g,
  /<[a-z][^>]*>/gi,
  /(?:https?:\/\/[^\s"'<>)\]]*)?\/api\/v1\/files\/[^\s"'<>)\]]*/g,
];

// Structured data without a picture's address anywhere in it. With LITE blocking anything, the
// page must not hand the browser the address of a picture the visitor chose not to load, and
// structured data is as much the browser's as the page is.
export function withoutPictures(value: unknown): unknown {
  if (typeof value === "string") {
    return PICTURE_IN_TEXT.reduce(
      (text, pattern) => text.replace(pattern, ""),
      value,
    );
  }
  if (Array.isArray(value)) return value.map(withoutPictures);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !PICTURE_KEYS.has(key))
        .map(([key, item]) => [key, withoutPictures(item)]),
    );
  }
  return value;
}

// JSON for a `<script>`: nothing in the text can close the element or open a comment.
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
