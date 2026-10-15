import assert from "node:assert/strict";
import { test } from "node:test";
import { FileMetadata } from "@sermo/core/contracts";
import { blocksImageRequest, normalizeImagePath } from "./lite-images";
import {
  blocks,
  LITE_CATEGORIES,
  type LiteState,
  liteCategoryOfPurpose,
  parseLiteCookie,
  parseLiteCookieHeader,
  serializeLiteCookie,
  updateLiteState,
} from "./lite-preferences";

test("the master switch keeps the submitted selection, and off keeps the stored one", () => {
  const custom = parseLiteCookie("frames.postImages");
  const on = updateLiteState(custom, "all", ["frames", "postImages"]);
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
    ["/pictures%5Ctobi.jpg", "/pictures/tobi.jpg"],
    ["/pictures/tobi.jpg%2F", "/pictures/tobi.jpg"],
    ["/%2fpictures/tobi.jpg", "/pictures/tobi.jpg"],
    ["/x%2F..%2Fmark.svg", "/mark.svg"],
    ["/MARK.svg", "/mark.svg"],
    ["/mark.SVG", "/mark.svg"],
  ];
  for (const [path, normalized] of paths) {
    assert.equal(normalizeImagePath(path), normalized);
    assert.equal(blocksImageRequest(parseLiteCookie("all"), path), true);
    assert.equal(blocksImageRequest(parseLiteCookie("brand"), path), true);
    assert.equal(blocksImageRequest(parseLiteCookie("shop"), path), true);
    assert.equal(blocksImageRequest(parseLiteCookie(), path), false);
  }
});

test("every picture suffix is blocked under any selection", () => {
  const extensions =
    "avif apng bmp gif heic heif ico jfif jpeg jpg png svg tif tiff webp".split(
      " ",
    );
  for (const category of LITE_CATEGORIES) {
    const state = parseLiteCookie(category.key);
    for (const ext of extensions) {
      assert.equal(
        blocksImageRequest(state, `/pictures/picture.${ext.toUpperCase()}`),
        true,
      );
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

test("a settings save with the master on stores the submitted categories", () => {
  const empty = parseLiteCookie();
  const both = updateLiteState(empty, "all", ["frames", "avatars"]);
  assert.ok(both);
  assert.equal(serializeLiteCookie(both), "all.avatars.frames");

  // Unticking every category must be able to clear a stored selection.
  const stored = parseLiteCookie("avatars.frames");
  const cleared = updateLiteState(stored, "all", []);
  assert.deepEqual(cleared, { master: true, blocked: [] });
  assert.equal(serializeLiteCookie(cleared as LiteState), "all");

  // Unknown tokens are dropped, as for custom.
  assert.deepEqual(updateLiteState(empty, "all", ["avatars", "nope"]), {
    master: true,
    blocked: ["avatars"],
  });
});

test("turning the mode off keeps the stored selection", () => {
  assert.deepEqual(updateLiteState(parseLiteCookie("all.frames"), "off", []), {
    master: false,
    blocked: ["frames"],
  });
});

test("custom saves and invalid modes", () => {
  const stored = parseLiteCookie("frames");
  assert.deepEqual(updateLiteState(stored, "custom", ["avatars"]), {
    master: false,
    blocked: ["avatars"],
  });
  assert.deepEqual(updateLiteState(stored, "custom", []), {
    master: false,
    blocked: [],
  });
  for (const mode of [null, "", "ALL", "unknown"]) {
    assert.equal(updateLiteState(stored, mode, ["avatars"]), null);
  }
});

test("every backend file purpose belongs to exactly one LITE category", () => {
  for (const purpose of FileMetadata.shape.purpose.options) {
    const owners = LITE_CATEGORIES.filter((category) =>
      (category.purposes as readonly string[]).includes(purpose),
    );
    assert.equal(
      owners.length,
      1,
      `${purpose}: register this file purpose in exactly one LITE category (found ${owners.length})`,
    );
    assert.equal(liteCategoryOfPurpose(purpose), owners[0].key);
  }
  for (const category of LITE_CATEGORIES)
    for (const purpose of category.purposes)
      assert.ok(
        (FileMetadata.shape.purpose.options as readonly string[]).includes(
          purpose,
        ),
        `${category.key}: "${purpose}" is not a backend file purpose`,
      );
});

test("the identity pictures are brand", () => {
  for (const purpose of ["site_logo", "site_icon", "site_backdrop"] as const)
    assert.equal(liteCategoryOfPurpose(purpose), "brand");
});
