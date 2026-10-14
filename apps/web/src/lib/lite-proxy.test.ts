import assert from "node:assert/strict";

import { test } from "node:test";

test("proxy preserves page access rules and varies allowed pictures by cookie", async () => {
  // Next compiles this marker to an empty module on the server.

  const testRunner = "bun:test";
  const { mock } = await import(testRunner);
  mock.module("server-only", () => ({}));
  const { NextRequest } = await import("next/server");
  const { proxy } = await import("../proxy");
  async function request(path: string, cookie = "") {
    const response = await proxy(
      new NextRequest(`http://localhost${path}`, {
        headers: { cookie: cookie ? `forum_lite=${cookie}` : "" },
      }),
    );
    assert.ok(response);
    return response;
  }
  for (const cookie of ["", "all", "avatars"]) {
    for (const path of [
      "/admin/missing.svg",
      "/%61dmin/missing.svg",
      "/members/999999.jpg",
      "/members%2F999999.jpg",
    ]) {
      const response = await request(path, cookie);
      assert.equal(response.status, 404, path);
      assert.equal(
        response.headers.get("x-middleware-rewrite"),
        "http://localhost/en/not-found",
      );
    }
    for (const path of [
      "/account/missing.svg",
      "/%61ccount/missing.svg",
      "/elsewhere/123/new/missing.svg",
    ]) {
      const response = await request(path, cookie);
      assert.equal(response.status, 307);
      assert.equal(
        response.headers.get("location"),
        `http://localhost/login?next=${encodeURIComponent(path)}`,
      );
    }
  }
  for (const cookie of ["", "all", "frames"]) {
    for (const path of ["/foo:bar", "/forums/abc.gif", "/awards/1.avif"]) {
      const response = await request(path, cookie);
      assert.equal(response.status, 404, path);
      assert.equal(
        response.headers.get("x-middleware-rewrite"),
        "http://localhost/en/not-found",
      );
    }
  }
  {
    const response = await request("/pictures/tobi.jpg");
    assert.equal(
      response.headers.get("x-middleware-rewrite"),
      "http://localhost/en/pictures/tobi.jpg",
    );
    assert.equal(response.headers.get("vary"), "Cookie");
    assert.equal(response.headers.get("cache-control"), null);
  }
  for (const [path, cookie] of [
    ["/pictures/ring.png", "all.frames"],
    ["/pictures/tobi.jpg", "frames"],
    ["/unknown.png", "frames"],
    ["/THREAD~1/vinyl.jpg", "all"],
    ["/pictures/tobi.jpg.", "avatars"],
    ["/pictures/tobi.jpg%3A%3A%24DATA", "avatars"],
  ]) {
    const response = await request(path, cookie);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.ok((await response.text()).includes("LITE MODE"));
  }
  const legacy = await request("/", "1");
  const migrated = legacy.headers.get("set-cookie");
  assert.ok(migrated);
  assert.ok(migrated.includes("forum_lite=all"));
  assert.ok(!migrated.toLowerCase().includes("httponly"));
});
