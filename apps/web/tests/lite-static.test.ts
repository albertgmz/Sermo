import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LITE_CATEGORIES } from "../src/lib/lite-preferences";
import {
  artCategoryErrors,
  emissionHits,
  IMAGE_EXTENSIONS,
  publicImages,
  ROOT,
  read,
  sourceFiles,
} from "./lite-scan";
import { LOCALE_DIRS, MESSAGES } from "./locales";

// Full emission permission is limited to reviewed gates and their primitive.
const EMISSION_GATES: Record<string, string> = {
  "src/components/forum/art.tsx":
    "Checks the caller's category before emitting a background URL.",
  "src/components/forum/user-avatar.tsx":
    "Checks avatars and frames independently before passing src to AvatarImage.",
  "src/components/forum/markdown.tsx":
    "Checks postImages on the server before emitting Markdown images.",
  "src/lib/attachment-tags.ts":
    "Draws the attachments a text places inline only when HtmlContent found postImages allowed (liteImages); a blocked picture becomes the placeholder and its address is never written.",
  "src/components/layout/site-icon.tsx":
    "Checks brand before emitting the favicon link.",
  "src/lib/pwa.ts":
    "Names the icons of the web app manifest; src/app/manifest.ts checks the category before asking for them and leaves them out when it is blocked.",
  "src/components/layout/logo.tsx":
    "Checks brand before emitting the site logo picture.",
  "src/components/layout/page-backdrop.tsx":
    "Checks brand before emitting the site backdrop picture.",
  "src/components/forum/reaction-picture.tsx":
    "Draws the reaction picture that src/lib/sermo/reactions.ts left in the data: the address is dropped there when the reactions category is blocked, so there is nothing to emit.",
  "src/components/ui/avatar.tsx":
    "Low-level image primitive, used only by the reviewed UserAvatar gate.",
};

// These modules may name paths; they may NOT acquire an image-emitting construct.
const PATH_ONLY: Record<string, string> = {
  "src/lib/lite-images.ts": "Classifies and normalizes requests for the proxy.",
  "src/lib/lite-preferences.test.ts":
    "Existing pure helper fixtures name image paths but never render them.",
  "src/proxy.ts":
    "Returns a text-only SVG placeholder, never the requested artwork.",
};

// Filters that name picture attributes in order to remove them from member text.
const FILTER_ONLY: Record<string, string> = {
  "src/lib/lite-markdown.ts":
    "Removes picture attributes from Markdown HTML; emits none.",
};

const INLINE_ART: Record<string, { category: string; reason: string }> = {
  "src/components/forum/award-icon.tsx": {
    category: "awards",
    reason: "Award glyphs are artwork even when provided by lucide.",
  },
  "src/components/forum/shop-icon.tsx": {
    category: "shop",
    reason: "Shop glyphs are artwork even when provided by lucide.",
  },
  "src/components/layout/logo.tsx": {
    category: "brand",
    reason: "The inline logo is brand artwork.",
  },
  "src/components/layout/page-backdrop.tsx": {
    category: "brand",
    reason: "The decorative SVG grid is brand artwork.",
  },
};

// Sample pictures of the styleguide are data, generated as SVG text: they are handed to the gates
// (`Art`, `UserAvatar`, `CoverBackdrop`), which check the category before drawing anything.
const SAMPLE_PICTURES: Record<string, string> = {
  "src/app/[locale]/(main)/ui/samples.ts":
    "Generates the data URLs of the styleguide's sample pictures; draws nothing.",
};

const INTERFACE_ICONS: Record<string, string> = {
  "src/components/forum/forum-icon.tsx": "Owner-exempt forum navigation icons.",
  "src/components/forum/permission-icon.tsx":
    "Owner-exempt permission interface icons.",
  "src/components/forum/client-icons.tsx":
    "Owner-exempt browser and operating-system interface icons.",
  "src/components/forum/social-icon.tsx":
    "Owner-exempt social link interface icons.",
  "src/proxy.ts":
    "Text-only LITE status SVG; runtime tests forbid artwork in this placeholder.",
};
// Imported lucide interface icons are exempt; award/shop uses remain in INLINE_ART.

test("only reviewed LITE gates emit pictures", () => {
  const errors = sourceFiles().flatMap((path) =>
    emissionHits(path, read(path))
      .filter(
        ({ kind }) =>
          !EMISSION_GATES[path] &&
          !(PATH_ONLY[path] && kind === "picture file path") &&
          !(FILTER_ONLY[path] && kind === "image attribute"),
      )
      .map(
        ({ line, kind }) =>
          `${path}:${line}: ${kind}; render the picture through a gate with a category. Do not add a page to the emission allowlist.`,
      ),
  );
  expect(errors, errors.join("\n")).toEqual([]);
});

test("inline SVG artwork is classified and consults its LITE category", () => {
  const errors: string[] = [];
  for (const path of sourceFiles()) {
    const source = read(path);
    if (
      /<svg\b[\s\S]*?<(?:path|circle|ellipse|rect|line|polyline|polygon|text|image|use)\b/.test(
        source,
      ) &&
      !INLINE_ART[path] &&
      !SAMPLE_PICTURES[path] &&
      !INTERFACE_ICONS[path]
    )
      errors.push(
        `${path}: classify this inline SVG in INLINE_ART with a LITE category or in the owner-reviewed INTERFACE_ICONS list.`,
      );
  }
  for (const [path, { category }] of Object.entries(INLINE_ART)) {
    const source = read(path);
    if (
      !LITE_CATEGORIES.some(({ key }) => key === category) ||
      !new RegExp(`await\\s+liteBlocks\\(\\s*["']${category}["']\\s*\\)`).test(
        source,
      ) ||
      /^["']use client["']/m.test(source)
    )
      errors.push(
        `${path}: consult liteBlocks("${category}") on the server before drawing artwork.`,
      );
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

// Pictures served by the backend are addressed by id: the category comes from the file's purpose.
const BACKEND_PICTURE_GATES: Record<string, string> = {
  "src/components/layout/logo.tsx": "site_logo",
  "src/components/layout/site-icon.tsx": "site_icon",
  "src/app/manifest.ts": "site_icon",
  "src/components/layout/page-backdrop.tsx": "site_backdrop",
  // Where the pictures reach the data the reaction gate draws from.
  "src/lib/sermo/reactions.ts": "reaction_image",
};

test("backend pictures consult the category of their file purpose on the server", () => {
  const errors = Object.entries(BACKEND_PICTURE_GATES).flatMap(
    ([path, purpose]) => {
      const source = read(path);
      const consulted = new RegExp(
        `await\\s+liteBlocks\\([^;]*liteCategoryOfPurpose\\(\\s*["']${purpose}["']\\s*\\)`,
      ).test(source);
      return consulted && !/^["']use client["']/m.test(source)
        ? []
        : [
            `${path}: call liteBlocks(liteCategoryOfPurpose("${purpose}")) on the server before emitting the picture.`,
          ];
    },
  );
  expect(errors, errors.join("\n")).toEqual([]);
});

test("public holds no picture: the backend serves them, each under the category of its file purpose", () => {
  const errors = publicImages().map(
    (path) =>
      `${path}: store this picture in the backend instead; a file of public belongs to no LITE category.`,
  );
  expect(errors, errors.join("\n")).toEqual([]);
});

test("registry labels and descriptions remain valid", () => {
  expect(new Set(LITE_CATEGORIES.map(({ key }) => key)).size).toBe(
    LITE_CATEGORIES.length,
  );
  for (const locale of LOCALE_DIRS) {
    const { categories } = JSON.parse(
      readFileSync(join(MESSAGES, locale, "lite.json"), "utf8"),
    ) as {
      categories: Record<string, { label: string; description: string }>;
    };
    for (const category of LITE_CATEGORIES) {
      const text = categories[category.key];
      expect(
        text?.label.trim().length ?? 0,
        `${category.key}: add a label to messages/${locale}/lite.json`,
      ).toBeGreaterThan(0);
      expect(
        text?.description.trim().length ?? 0,
        `${category.key}: add a description to messages/${locale}/lite.json`,
      ).toBeGreaterThan(0);
    }
  }
  for (const path of [
    ...Object.keys(EMISSION_GATES),
    ...Object.keys(PATH_ONLY),
    ...Object.keys(INLINE_ART),
    ...Object.keys(SAMPLE_PICTURES),
    ...Object.keys(INTERFACE_ICONS),
  ])
    expect(
      existsSync(join(ROOT, path)),
      `${path}: remove or update the stale allowlist entry`,
    ).toBe(true);
  expect(IMAGE_EXTENSIONS).toEqual(
    "avif apng bmp gif heic heif ico jfif jpeg jpg png svg tif tiff webp".split(
      " ",
    ),
  );
});

test("every Art use explicitly supplies a registered category", () => {
  const errors = sourceFiles().flatMap((path) =>
    artCategoryErrors(path, read(path)),
  );
  expect(errors, errors.join("\n")).toEqual([]);
});

// Browser-only behaviour has no DOM test here; pin the pieces it relies on.
test("tab sync broadcasts committed changes and the member card resets with them", () => {
  const sync = read("src/components/layout/lite-mode-sync.tsx");
  expect(sync).toContain("new BroadcastChannel(");
  expect(sync).toContain("channel?.postMessage(");
  expect(sync).toContain('addEventListener("focus", check)');
  const card = read("src/components/forum/member-card-trigger.tsx");
  expect(card).toContain("useSyncExternalStore(");
  expect(card).toMatch(/<MemberCardWithPreference\s+key=\{preference\}/);
});
