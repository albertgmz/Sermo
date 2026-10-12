import assert from "node:assert/strict";
import { test } from "node:test";
import { blocksImageRequest, normalizeImagePath } from "./lite-images";
import {
  blocks,
  LITE_CATEGORIES,
  parseLiteCookie,
  parseLiteCookieHeader,
  serializeLiteCookie,
  updateLiteState,
} from "./lite-preferences";

test("master toggles remember the custom selection", () => {
  const custom = parseLiteCookie("frames.postImages");
  const on = updateLiteState(custom, "all", []);
  assert.ok(on);
  assert.equal(serializeLiteCookie(on), "all.frames.postImages");
  assert.deepEqual(parseLiteCookie(serializeLiteCookie(on)), on);
  const off = updateLiteState(on, "off", []);
  assert.deepEqual(off, custom);
  assert.deepEqual(updateLiteState(on, "custom", ["avatars", "unknown"]), {
    master: false,
    blocked: ["avatars"],
  });
});

test("invalid modes do not produce a mutation", () => {
  for (const mode of [null, "", "ALL", "unknown", new File([], "all")]) {
    assert.equal(updateLiteState(parseLiteCookie("frames"), mode, []), null);
  }
});

test("cookie parsing decodes safely and duplicate cookies use the last value", () => {
  assert.deepEqual(parseLiteCookie("%61ll"), parseLiteCookie("all"));
  assert.deepEqual(
    parseLiteCookie("avatars%2Eframes"),
    parseLiteCookie("frames.avatars"),
  );
  assert.doesNotThrow(() => parseLiteCookie("%broken"));
  assert.deepEqual(
    parseLiteCookieHeader("forum_lite=avatars; other=x; forum_lite=%61ll"),
    parseLiteCookie("all"),
  );
  assert.deepEqual(
    parseLiteCookieHeader("forum_lite=all; forum_lite="),
    parseLiteCookie(),
  );
  assert.deepEqual(
    parseLiteCookieHeader("forum_lite=all; forum_lite=%broken"),
    parseLiteCookie("all"),
  );
  assert.deepEqual(
    parseLiteCookieHeader("forum_lite=all; forum_lite"),
    parseLiteCookie(),
  );
});

test("all states have one canonical serialization", () => {
  for (const master of [false, true]) {
    for (let mask = 0; mask < 2 ** LITE_CATEGORIES.length; mask++) {
      const blocked = LITE_CATEGORIES.filter((_, i) => mask & (1 << i)).map(
        ({ key }) => key,
      );
      const state = { master, blocked };
      const value = serializeLiteCookie(state);
      assert.deepEqual(parseLiteCookie(value), state);
      assert.equal(
        serializeLiteCookie({
          master,
          blocked: [...blocked].reverse().concat(blocked),
        }),
        value,
      );
    }
  }
});

test("master overrides every category, including the legacy cookie", () => {
  for (const value of ["all", "1"]) {
    const state = parseLiteCookie(value);
    assert.equal(serializeLiteCookie(state), "all");
    for (const { key } of LITE_CATEGORIES)
      assert.equal(blocks(state, key), true);
  }
});

test("custom preferences ignore unknowns and serialize in registry order", () => {
  const state = parseLiteCookie("frames.unknown.avatars.frames");
  assert.equal(serializeLiteCookie(state), "avatars.frames");
  for (const { key } of LITE_CATEGORIES) {
    assert.equal(blocks(state, key), key === "avatars" || key === "frames");
  }
  for (const value of [undefined, "", "unknown"]) {
    assert.equal(serializeLiteCookie(parseLiteCookie(value)), "");
  }
});

test("every category combination blocks exactly its selected categories", () => {
  for (let mask = 0; mask < 2 ** LITE_CATEGORIES.length; mask++) {
    const selected = LITE_CATEGORIES.filter((_, i) => mask & (1 << i));
    const state = parseLiteCookie(selected.map(({ key }) => key).join("."));
    for (const { key } of LITE_CATEGORIES) {
      assert.equal(
        blocks(state, key),
        selected.some((item) => item.key === key),
      );
    }
    assert.deepEqual(parseLiteCookie(serializeLiteCookie(state)), state);
  }
});

test("Windows file aliases normalize before image classification", () => {
  const paths = [
    ["/avatars%5Ctobi.jpg", "/avatars/tobi.jpg", "avatars"],
    ["/avatars/tobi.jpg%2F", "/avatars/tobi.jpg", "avatars"],
    ["/%2favatars/tobi.jpg", "/avatars/tobi.jpg", "avatars"],
    ["/x%2F..%2Flogo.svg", "/logo.svg", "brand"],
    ["/LOGO.svg", "/logo.svg", "brand"],
    ["/icon.SVG", "/icon.svg", "brand"],
  ];
  for (const [path, normalized, category] of paths) {
    assert.equal(normalizeImagePath(path), normalized);
    assert.equal(blocksImageRequest(parseLiteCookie("all"), path), true);
    assert.equal(blocksImageRequest(parseLiteCookie(category), path), true);
    assert.equal(blocksImageRequest(parseLiteCookie("shop"), path), false);
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false);
  }
});

test("registry folders, root files, extensions, and unregistered images", () => {
  const extensions =
    "avif apng bmp gif heic heif ico jfif jpeg jpg png svg tif tiff webp".split(
      " ",
    );
  for (const category of LITE_CATEGORIES) {
    const state = parseLiteCookie(category.key);
    for (const folder of category.folders) {
      for (const ext of extensions) {
        assert.equal(
          blocksImageRequest(state, `/${folder}/picture.${ext.toUpperCase()}`),
          true,
        );
      }
      assert.equal(
        blocksImageRequest(state, `/${folder}-other/picture.png`),
        true,
      );
    }
    for (const file of category.files) {
      assert.equal(blocksImageRequest(state, `/${file.toUpperCase()}`), true);
    }
  }
  assert.equal(
    blocksImageRequest(parseLiteCookie("all"), "/elsewhere/a.png"),
    true,
  );
  assert.equal(
    blocksImageRequest(parseLiteCookie("avatars"), "/elsewhere/a.png"),
    true,
  );
  assert.equal(blocksImageRequest(parseLiteCookie("all"), "/app.js"), false);
  assert.equal(
    blocksImageRequest(parseLiteCookie("postImages"), "/_next/image"),
    true,
  );
  assert.equal(blocksImageRequest(parseLiteCookie(), "/_next/image"), false);
  assert.doesNotThrow(() => normalizeImagePath("/broken%/image.png"));
  assert.equal(
    blocksImageRequest(parseLiteCookie("all"), "/broken%/image.png"),
    true,
  );
});
