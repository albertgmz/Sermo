import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksImageRequest,
  isImageRequest,
  normalizeImagePath,
} from "./lite-images";
import { LITE_CATEGORIES, parseLiteCookie } from "./lite-preferences";

test("image-looking page paths still run their access and id rules", () => {
  const paths = [
    "/admin/missing.svg",
    "/account/missing.svg",
    "/members/999999.jpg",
    "/%61dmin/missing.svg",
    "/%61ccount/missing.svg",
    "/%6dembers/999999.jpg",
    "/admin%2Fmissing.svg",
    "/account%2Fmissing.svg",
    "/members%2F999999.jpg",
    "/notifications/missing.svg",
    "/conversations/999999.jpg",
    "/threads/999999.jpg",
    "/admin/missing.svg::$DATA",
    "/forums/123/missing.svg",
    "/elsewhere/123/new/missing.svg",
    "/elsewhere%2F123%2Fnew%2Fmissing.svg",
  ];
  for (const path of paths) {
    assert.equal(isImageRequest(path), false, path);
    for (const cookie of [undefined, "all", "avatars"]) {
      assert.equal(
        blocksImageRequest(parseLiteCookie(cookie), path),
        false,
        path,
      );
    }
  }
});

test("registered assets keep their category even when a folder also has pages", () => {
  const paths = [
    ["/avatars/tobi.jpg", "avatars"],
    ["/frames/619.png", "frames"],
    ["/covers/forest.jpg", "profileCovers"],
    ["/thread-covers/vinyl.jpg", "threadCovers"],
    ["/forums/1.webp", "forumArt"],
    ["/awards/1.svg", "awards"],
    ["/shop/color-sky.svg", "shop"],
    ["/logo.svg", "brand"],
    ["/icon.svg", "brand"],
  ];
  for (const [path, selected] of paths) {
    assert.equal(isImageRequest(path), true, path);
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false, path);
    for (const { key } of LITE_CATEGORIES) {
      assert.equal(
        blocksImageRequest(parseLiteCookie(key), path),
        key === selected,
        `${path}: ${key}`,
      );
    }
  }
  for (const path of ["/forums/1", "/awards/1", "/shop", "/app.js"]) {
    assert.equal(isImageRequest(path), false, path);
    assert.equal(blocksImageRequest(parseLiteCookie("all"), path), false, path);
  }
});

test("unknown image locations fail closed with any selected category", () => {
  for (const path of [
    "/elsewhere/a.png",
    "/avatars-other/picture.jpg",
    "/unknown.svg",
    "/broken%/image.png",
  ]) {
    assert.equal(isImageRequest(path), true, path);
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false, path);
    assert.equal(blocksImageRequest(parseLiteCookie("all"), path), true, path);
    for (const { key } of LITE_CATEGORIES) {
      assert.equal(blocksImageRequest(parseLiteCookie(key), path), true, path);
    }
  }
});

test("NTFS streams and short-name asset aliases are rejected even with LITE off", () => {
  for (const path of [
    "/THREAD~1/vinyl.jpg",
    "/THREAD%7E1/vinyl.jpg",
    "/avatars/TOBI~1.JPG",
    "/avatars/tobi.jpg::$DATA",
    "/avatars/tobi.jpg%3A%3A%24DATA",
    "/avatars%5Ctobi.jpg%3A%3A%24DATA",
    "/avatars/tobi.jpg:preview.jpg",
  ]) {
    assert.equal(isImageRequest(path), true, path);
    for (const cookie of [undefined, "all", "avatars", "threadCovers"]) {
      assert.equal(
        blocksImageRequest(parseLiteCookie(cookie), path),
        true,
        path,
      );
    }
  }
});

test("encoded separators and dot segments retain local asset categories", () => {
  const paths = [
    "/frames%2F619.png",
    "/frames%5C619.png",
    "/FRAMES/619.PNG",
    "/frames/./619.png",
    "/frames/other/../619.png",
    "/elsewhere%2F..%2Fframes%2F619.png",
    "/elsewhere/%2E%2E/frames/619.png",
    "/%2Fframes//619.png/",
  ];
  for (const path of paths) {
    assert.equal(normalizeImagePath(path), "/frames/619.png", path);
    assert.equal(isImageRequest(path), true, path);
    assert.equal(
      blocksImageRequest(parseLiteCookie("frames"), path),
      true,
      path,
    );
    assert.equal(
      blocksImageRequest(parseLiteCookie("avatars"), path),
      false,
      path,
    );
  }
});

test("the image optimizer fails closed for every selected category", () => {
  for (const path of ["/_next/image", "/_next%2Fimage"]) {
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false, path);
    for (const { key } of LITE_CATEGORIES) {
      assert.equal(blocksImageRequest(parseLiteCookie(key), path), true, path);
    }
  }
});
