import assert from "node:assert/strict";
import { test } from "node:test";
import {
  copyOf,
  type Seo,
  type Share,
  seoMetadata,
  serializeJsonLd,
  shareMetadata,
  websiteJsonLd,
  withoutPictures,
} from "./seo";

const SEO: Seo = {
  title: "General | Sermo",
  description: "Talk about anything.",
  canonical: "http://site.example/forums/3-general",
  robots: "index,follow",
  jsonLd: [{ "@type": "BreadcrumbList" }],
};

test("the head of a page is what the backend says, under this app's address for forums", () => {
  assert.deepEqual(seoMetadata(SEO), {
    title: { absolute: "General | Sermo" },
    description: "Talk about anything.",
    alternates: { canonical: "http://site.example/forums/3-general" },
    robots: { index: true, follow: true },
  });
});

test("a page the backend keeps out of the index is noindex, and an empty description is left out", () => {
  const metadata = seoMetadata({
    ...SEO,
    description: "",
    robots: "noindex,follow",
  });
  assert.deepEqual(metadata.robots, { index: false, follow: true });
  assert.equal(metadata.description, undefined);
});

test("a copy of a view keeps its address, leaves the index and carries no structured data", () => {
  const copy = copyOf(SEO);
  assert.equal(copy.canonical, SEO.canonical);
  assert.equal(copy.robots, "noindex,follow");
  assert.deepEqual(copy.jsonLd, []);
});

test("structured data never closes its script", () => {
  const text = serializeJsonLd({
    text: "</script><script>alert(1)</script><!--",
  });
  assert.ok(!text.includes("<"));
  assert.deepEqual(JSON.parse(text), {
    text: "</script><script>alert(1)</script><!--",
  });
});

test("structured data without pictures has no picture property and no picture address in a text", () => {
  const input = {
    "@type": "DiscussionForumPosting",
    image: "http://site.example/api/v1/files/9",
    author: { name: "wren", image: { url: "/api/v1/files/3" } },
    text: 'Look [IMG]/api/v1/files/12[/IMG] and <img src="/api/v1/files/13"> and http://site.example/api/v1/files/14 here',
    comment: [{ text: "see /api/v1/files/15 ok", thumbnailUrl: "x" }],
  };
  const out = JSON.stringify(withoutPictures(input));
  assert.ok(!out.includes("/api/v1/files/"), out);
  assert.ok(!out.includes("image"), out);
  assert.ok(out.includes("Look"));
  assert.ok(out.includes("wren"));
});

const SHARE: Share = {
  title: "General",
  description: "Talk about anything.",
  url: "http://site.example/forums/3-general",
  siteName: "Sermo",
  locale: "es",
  kind: { type: "website" },
};

test("a public page shares its own title, description, canonical address, site and language", () => {
  const { openGraph, twitter } = shareMetadata(SHARE);
  assert.deepEqual(openGraph, {
    type: "website",
    title: "General",
    description: "Talk about anything.",
    url: "http://site.example/forums/3-general",
    siteName: "Sermo",
    locale: "es_ES",
    images: undefined,
  });
  assert.deepEqual(twitter, {
    card: "summary",
    title: "General",
    description: "Talk about anything.",
    images: undefined,
  });
  assert.equal(
    shareMetadata({ ...SHARE, locale: "en" }).openGraph?.locale,
    "en_US",
  );
});

test("a thread is an article with its dates, author, forum and tags", () => {
  const { openGraph } = shareMetadata({
    ...SHARE,
    title: "Hello",
    kind: {
      type: "article",
      publishedTime: "2026-01-01T00:00:00.000Z",
      modifiedTime: "2026-01-02T00:00:00.000Z",
      author: "http://site.example/members/4",
      section: "General",
      tags: ["rust"],
    },
  });
  assert.deepEqual(openGraph, {
    type: "article",
    title: "Hello",
    description: "Talk about anything.",
    url: "http://site.example/forums/3-general",
    siteName: "Sermo",
    locale: "es_ES",
    images: undefined,
    publishedTime: "2026-01-01T00:00:00.000Z",
    modifiedTime: "2026-01-02T00:00:00.000Z",
    authors: ["http://site.example/members/4"],
    section: "General",
    tags: ["rust"],
  });
});

test("a member's page is a profile under their name", () => {
  const { openGraph } = shareMetadata({
    ...SHARE,
    title: "wren",
    kind: { type: "profile", username: "wren" },
  });
  assert.equal(openGraph && "type" in openGraph && openGraph.type, "profile");
  assert.equal(
    openGraph && "username" in openGraph && openGraph.username,
    "wren",
  );
});

test("a picture makes the card the large one, with its size and text; an empty description is left out", () => {
  const image = {
    url: "http://site.example/card.png",
    type: "image/png",
    width: 1200,
    height: 630,
    alt: "General",
  };
  const { openGraph, twitter } = shareMetadata({
    ...SHARE,
    description: "",
    image,
  });
  assert.deepEqual(openGraph?.images, [image]);
  assert.equal(openGraph?.description, undefined);
  assert.deepEqual(twitter, {
    card: "summary_large_image",
    title: "General",
    description: undefined,
    images: [image],
  });
});

test("the site's structured data names it and the search its results page answers", () => {
  assert.deepEqual(
    websiteJsonLd({
      name: "Sermo",
      description: "",
      origin: "http://site.example",
    }),
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": "http://site.example/#website",
      url: "http://site.example/",
      name: "Sermo",
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: "http://site.example/search?q={search_term_string}",
        },
        "query-input": "required name=search_term_string",
      },
    },
  );
  assert.equal(
    websiteJsonLd({
      name: "Sermo",
      description: "A forum.",
      origin: "http://site.example",
    }).description,
    "A forum.",
  );
});
