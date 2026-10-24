import type { Metadata } from "next";
import type { Locale } from "@/i18n/locales";
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

// Pictures inside a text: BB code images, any HTML tag (an image among them) and any address of
// a stored file.
const PICTURE_IN_TEXT: RegExp[] = [
  /\[IMG\][^[]*\[\/IMG\]/gi,
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

// For a page that is nobody's to find through a search engine: the sign-in pages, a member's own
// account, their messages and notifications, and the settings of the viewing mode.
export const NOINDEX: Metadata["robots"] = { index: false, follow: false };

// What a page is to a share preview (Open Graph `og:type`): a thread is an article by the member
// who started it, a member's page is a profile, anything else is the site's.
export type ShareKind =
  | { type: "website" }
  | {
      type: "article";
      publishedTime: string;
      modifiedTime: string;
      // The address of the author's page, which is a profile in turn; none for a guest.
      author: string | undefined;
      // The forum the thread is in, and the thread's tags.
      section: string;
      tags: string[];
    }
  | { type: "profile"; username: string };

// The picture of a share card: an absolute address, its type and size, and a text for it.
export type ShareImage = {
  url: string;
  type: string;
  width: number;
  height: number;
  alt: string;
};

export type Share = {
  // The page's own title, without the site's name: the preview shows the site apart.
  title: string;
  description: string;
  // The page's absolute canonical address.
  url: string;
  siteName: string;
  locale: Locale;
  kind: ShareKind;
  image?: ShareImage;
};

// Open Graph names a language with its territory.
const OG_LOCALE: Record<Locale, string> = { en: "en_US", es: "es_ES" };

// The Open Graph and Twitter card tags of a page anyone may open. The picture, when there is one,
// goes to both and makes the card the large one.
export function shareMetadata(share: Share): Metadata {
  const { kind, image } = share;
  const images = image ? [image] : undefined;
  const common = {
    title: share.title,
    description: share.description || undefined,
    url: share.url,
    siteName: share.siteName,
    locale: OG_LOCALE[share.locale],
    images,
  };
  return {
    openGraph:
      kind.type === "article"
        ? {
            ...common,
            type: "article",
            publishedTime: kind.publishedTime,
            modifiedTime: kind.modifiedTime,
            authors: kind.author === undefined ? [] : [kind.author],
            section: kind.section,
            tags: kind.tags,
          }
        : kind.type === "profile"
          ? { ...common, type: "profile", username: kind.username }
          : { ...common, type: "website" },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: share.title,
      description: share.description || undefined,
      images,
    },
  };
}

// The site as a whole, for the home page: its name, address and the search box that results
// pages answer (`/search?q=`).
export function websiteJsonLd(site: {
  name: string;
  description: string;
  origin: string;
}) {
  const home = new URL("/", site.origin).href;
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${home}#website`,
    url: home,
    name: site.name,
    ...(site.description ? { description: site.description } : {}),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${new URL("/search", site.origin).href}?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}
