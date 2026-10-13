import assert from "node:assert/strict";
import { test } from "node:test";
import {
  blocksImageRequest,
  isImageRequest,
  isUnknownUnsafePath,
  normalizeImagePath,
} from "./lite-images";
import { LITE_CATEGORIES, parseLiteCookie } from "./lite-preferences";

test("image-looking page paths still run their access and id rules", () => {
  const paths = [
    "/admin/missing.svg",
    "/moderation/reports/5.png",
    "/%6Doderation/reports/5.png",
    "/MODERATION/reports/5.png",
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
    "/pages/rules.png",
    "/pages/rules/photo.jpg",
    "/elsewhere/123/new/missing.svg",
    "/elsewhere%2F123%2Fnew%2Fmissing.svg",
    // A page namespace holds no pictures: such a path is a missing page, not a placeholder.
    "/forums/abc.gif",
    "/AWARDS/1.SVG",
    "/forums/1.gif.",
    "/forums/1.gif::$DATA",
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

test("a picture path belongs to no category, so any selection blocks it and page paths stay out", () => {
  // The backend serves every picture; nothing in `public` is owned by a category.
  for (const path of ["/pictures/photo.jpg", "/mark.svg", "/media/ring.png"]) {
    assert.equal(isImageRequest(path), true, path);
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false, path);
    for (const { key } of LITE_CATEGORIES) {
      assert.equal(blocksImageRequest(parseLiteCookie(key), path), true, path);
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
    "/pictures-other/picture.jpg",
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

test("NTFS streams and short-name aliases of a picture are blocked whenever LITE blocks anything", () => {
  for (const path of [
    "/THREAD~1/vinyl.jpg",
    "/THREAD%7E1/vinyl.jpg",
    "/pictures/TOBI~1.JPG",
    "/pictures/tobi.jpg::$DATA",
    "/pictures/tobi.jpg%3A%3A%24DATA",
    "/pictures%5Ctobi.jpg%3A%3A%24DATA",
    "/pictures/tobi.jpg:preview.jpg",
  ]) {
    assert.equal(isImageRequest(path), true, path);
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false, path);
    for (const cookie of ["all", "avatars", "threadCovers"]) {
      assert.equal(
        blocksImageRequest(parseLiteCookie(cookie), path),
        true,
        path,
      );
    }
  }
});

test("encoded separators and dot segments normalize to one picture path", () => {
  const paths = [
    "/pictures%2Fring.png",
    "/pictures%5Cring.png",
    "/PICTURES/RING.PNG",
    "/pictures/./ring.png",
    "/pictures/other/../ring.png",
    "/elsewhere%2F..%2Fpictures%2Fring.png",
    "/elsewhere/%2E%2E/pictures/ring.png",
    "/%2Fpictures//ring.png/",
  ];
  for (const path of paths) {
    assert.equal(normalizeImagePath(path), "/pictures/ring.png", path);
    assert.equal(isImageRequest(path), true, path);
    assert.equal(
      blocksImageRequest(parseLiteCookie("frames"), path),
      true,
      path,
    );
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false, path);
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

test("trailing dots and spaces are dropped from every segment", () => {
  const paths = [
    "/pictures/tobi.jpg.",
    "/pictures/tobi.jpg..",
    "/pictures/tobi.jpg%20",
    "/pictures/tobi.jpg. .",
    "/pictures./tobi.jpg",
    "/pictures%20/tobi.jpg",
    "/pictures/x/.. /tobi.jpg",
  ];
  for (const path of paths) {
    assert.equal(normalizeImagePath(path), "/pictures/tobi.jpg", path);
    assert.equal(isImageRequest(path), true, path);
    assert.equal(blocksImageRequest(parseLiteCookie("all"), path), true, path);
    assert.equal(
      blocksImageRequest(parseLiteCookie("avatars"), path),
      true,
      path,
    );
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false, path);
  }
  assert.equal(normalizeImagePath("/a/.../b"), "/a/b");
});

test("unsafe paths that are not pictures are unknown", () => {
  for (const path of ["/foo:bar", "/foo~1/bar", "/foo/bar~2", "/a:b/c.html"]) {
    assert.equal(isUnknownUnsafePath(path), true, path);
    assert.equal(isImageRequest(path), false, path);
    for (const cookie of [undefined, "all", "avatars"]) {
      assert.equal(
        blocksImageRequest(parseLiteCookie(cookie), path),
        false,
        path,
      );
    }
  }
  // With a picture suffix (also through an alias) they stay pictures, and page namespaces keep
  // their own rules.
  for (const path of [
    "/pictures/tobi.jpg::$DATA",
    "/THREAD~1/vinyl.jpg",
    "/mark.svg::$DATA",
    "/members/1:x",
    "/elsewhere/1/new/x:y",
  ]) {
    assert.equal(isUnknownUnsafePath(path), false, path);
  }
  assert.equal(isUnknownUnsafePath("/pictures/tobi.jpg"), false);
});
