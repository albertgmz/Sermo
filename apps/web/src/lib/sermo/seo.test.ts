import assert from "node:assert/strict";
import { test } from "node:test";
import {
  copyOf,
  type Seo,
  seoMetadata,
  serializeJsonLd,
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
