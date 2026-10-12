import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { LITE_CATEGORIES } from "../src/lib/lite-preferences";
import {
  artCategoryErrors,
  emissionHits,
  IMAGE_EXTENSIONS,
  owners,
  publicImages,
  ROOT,
  read,
  sourceFiles,
} from "./lite-scan";

// Full emission permission is limited to reviewed gates and their primitive.
const EMISSION_GATES: Record<string, string> = {
  "src/components/forum/art.tsx":
    "Checks the caller's category before emitting a background URL.",
  "src/components/forum/user-avatar.tsx":
    "Checks avatars and frames independently before passing src to AvatarImage.",
  "src/components/forum/markdown.tsx":
    "Checks postImages on the server before emitting Markdown images.",
  "src/components/layout/site-icon.tsx":
    "Checks brand before emitting the favicon link.",
  "src/components/ui/avatar.tsx":
    "Low-level image primitive, used only by the reviewed UserAvatar gate.",
};

// These modules may name paths; they may NOT acquire an image-emitting construct.
const PATH_ONLY: Record<string, string> = {
  "src/lib/appearance.ts":
    "Builds profile/thread cover paths consumed by Art with a category.",
  "src/lib/frames.ts":
    "Builds frame paths consumed by UserAvatar after its frames check.",
  "src/lib/lite-preferences.ts": "Owns the category-to-public-path registry.",
  "src/lib/lite-images.ts": "Classifies and normalizes requests for the proxy.",
  "src/lib/lite-preferences.test.ts":
    "Existing pure helper fixtures name image paths but never render them.",
  "src/proxy.ts":
    "Returns a text-only SVG placeholder, never the requested artwork.",
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

const INTERFACE_ICONS: Record<string, string> = {
  "src/components/forum/forum-icon.tsx": "Owner-exempt forum navigation icons.",
  "src/components/forum/permission-icon.tsx":
    "Owner-exempt permission interface icons.",
  "src/components/forum/client-icons.tsx":
    "Owner-exempt browser and operating-system interface icons.",
  "src/components/forum/social-icon.tsx":
    "Owner-exempt social link interface icons.",
  "src/app/(auth)/google-icon.tsx": "Owner-exempt sign-in interface icon.",
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
          !(PATH_ONLY[path] && kind === "registered picture path"),
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

test("public pictures all belong to exactly one registered LITE category", () => {
  const pictures = publicImages();
  expect(pictures.length).toBeGreaterThan(0);
  const errors = pictures.flatMap((path) =>
    owners(path).length === 1
      ? []
      : [
          `${path}: register this picture's folder or root file in LITE_CATEGORIES with exactly one category.`,
        ],
  );
  expect(errors, errors.join("\n")).toEqual([]);
});

test("registry labels, descriptions, folders and root files remain valid", () => {
  expect(new Set(LITE_CATEGORIES.map(({ key }) => key)).size).toBe(
    LITE_CATEGORIES.length,
  );
  for (const category of LITE_CATEGORIES) {
    expect(
      category.label.trim().length,
      `${category.key}: add a label`,
    ).toBeGreaterThan(0);
    expect(
      category.description.trim().length,
      `${category.key}: add a description`,
    ).toBeGreaterThan(0);
    for (const folder of category.folders) {
      const path = join(ROOT, "public", folder);
      expect(
        existsSync(path),
        `${path}: registered picture folder must exist`,
      ).toBe(true);
      expect(statSync(path).isDirectory()).toBe(true);
    }
    for (const file of category.files)
      expect(
        existsSync(join(ROOT, "public", file)),
        `public/${file}: registered picture must exist`,
      ).toBe(true);
  }
  for (const path of [
    ...Object.keys(EMISSION_GATES),
    ...Object.keys(PATH_ONLY),
    ...Object.keys(INLINE_ART),
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
