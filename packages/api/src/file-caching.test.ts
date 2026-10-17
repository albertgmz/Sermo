import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "@sermo/core";
import { closeContext, localDriver } from "@sermo/core";
import { createTestContext, insertNode } from "@sermo/core/testing";
import { createApp } from "./app";

const contexts: Ctx[] = [];
const dirs: string[] = [];
let nextIp = 1;
afterEach(async () => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const origin = "http://localhost:3000";
const year = "public, max-age=31536000, immutable";
const redPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==",
  "base64",
);
const clearPixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "sermo-file-caching-"));
  dirs.push(dir);
  const ctx = createTestContext();
  contexts.push(ctx);
  const forum = insertNode(ctx, { type: "forum" });
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") },
  });
  const ip = `10.1.0.${nextIp++}`;
  const env = { requestIP: () => ({ address: ip, family: "IPv4" as const, port: 1 }) };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      name: "owner",
      username: "owner",
      email: "owner@example.test",
      password: "Password123!",
    }),
  });
  expect(signUp.status).toBe(200);
  const cookies = signUp.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);
  const cookie = cookies.join("; ");
  // The session token alone: the answer carries a refreshed session cookie.
  const tokenOnly = cookies.find((part) => part.startsWith("sermo.session_token="))!;
  const userId = ((await signUp.json()) as { user: { id: string } }).user.id;
  const upload = async (purpose: string, blob: Blob, name: string) => {
    const form = new FormData();
    form.append("file", blob, name);
    const response = await request(`/api/v1/files?purpose=${purpose}`, {
      method: "POST",
      headers: { cookie, origin },
      body: form,
    });
    expect(response.status).toBe(201);
    return (await response.json()) as { id: number; url: string };
  };
  const json = (method: string, path: string, body: unknown) =>
    request(path, {
      method,
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  return { ctx, forum, request, cookie, tokenOnly, userId, upload, json };
}

async function setAvatar(app: Awaited<ReturnType<typeof setup>>, pixel: typeof redPixel) {
  const file = await app.upload("avatar", new Blob([pixel], { type: "image/png" }), "a.png");
  expect((await app.json("PUT", "/api/v1/profile/avatar", { fileId: file.id })).status).toBe(200);
  const profile = await app.request(`/api/v1/users/${app.userId}`);
  return ((await profile.json()) as { avatar: { fileId: number; url: string } }).avatar;
}

/** The caching headers of an answer, which a 304 repeats from the 200. */
const caching = (response: Response) => ({
  cacheControl: response.headers.get("cache-control"),
  etag: response.headers.get("etag"),
  lastModified: response.headers.get("last-modified"),
});

test("a picture anyone may see is kept a year by any cache, and a kept copy is answered 304", async () => {
  const app = await setup();
  const avatar = await setAvatar(app, redPixel);
  const served = await app.request(avatar.url);
  expect(served.status).toBe(200);
  const headers = caching(served);
  expect(headers.cacheControl).toBe(year);
  // A strong validator: the hash of the stored bytes.
  expect(headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
  expect(new Date(headers.lastModified!).toUTCString()).toBe(headers.lastModified!);
  const body = new Uint8Array(await served.arrayBuffer());
  expect(body.byteLength).toBeGreaterThan(0);

  for (const ifNoneMatch of [headers.etag!, `W/${headers.etag}`, `"other", ${headers.etag}`, "*"]) {
    const cached = await app.request(avatar.url, { headers: { "if-none-match": ifNoneMatch } });
    expect(cached.status, ifNoneMatch).toBe(304);
    expect(caching(cached), ifNoneMatch).toEqual(headers);
    expect(await cached.text()).toBe("");
  }
  const changed = await app.request(avatar.url, { headers: { "if-none-match": '"other"' } });
  expect(changed.status).toBe(200);
  expect(new Uint8Array(await changed.arrayBuffer())).toEqual(body);

  const since = (value: string, extra: Record<string, string> = {}) =>
    app.request(avatar.url, { headers: { "if-modified-since": value, ...extra } });
  const notModified = await since(headers.lastModified!);
  expect(notModified.status).toBe(304);
  expect(caching(notModified)).toEqual(headers);
  expect((await since("Thu, 01 Jan 1970 00:00:00 GMT")).status).toBe(200);
  expect((await since("not a date")).status).toBe(200);
  // When both are sent, If-None-Match decides.
  expect((await since(headers.lastModified!, { "if-none-match": '"other"' })).status).toBe(200);

  const head = await app.request(avatar.url, { method: "HEAD" });
  expect(head.status).toBe(200);
  expect(caching(head)).toEqual(headers);
  expect(head.headers.get("content-length")).toBe(String(body.byteLength));
  expect(await head.text()).toBe("");
  const headCached = await app.request(avatar.url, {
    method: "HEAD",
    headers: { "if-none-match": headers.etag! },
  });
  expect(headCached.status).toBe(304);
  expect(caching(headCached)).toEqual(headers);

  const part = await app.request(avatar.url, { headers: { range: "bytes=0-3" } });
  expect(part.status).toBe(206);
  expect(caching(part)).toEqual(headers);
  expect(new Uint8Array(await part.arrayBuffer())).toEqual(body.subarray(0, 4));

  // A new picture is a new upload: a new address, so a kept copy of the old one is never wrong.
  const replaced = await setAvatar(app, clearPixel);
  expect(replaced.url).not.toBe(avatar.url);
  const next = await app.request(replaced.url, { headers: { "if-none-match": headers.etag! } });
  expect(next.status).toBe(200);
  expect(next.headers.get("etag")).not.toBe(headers.etag);
  expect(next.headers.get("cache-control")).toBe(year);
});

test("an answer that refreshes the session cookie is kept by the browser alone", async () => {
  const app = await setup();
  const avatar = await setAvatar(app, redPixel);
  const etag = (await app.request(avatar.url)).headers.get("etag")!;
  for (const headers of <Record<string, string>[]>[{}, { "if-none-match": etag }]) {
    const served = await app.request(avatar.url, {
      headers: { cookie: app.tokenOnly, ...headers },
    });
    expect(served.status).toBe(Object.keys(headers).length ? 304 : 200);
    expect(
      served.headers.getSetCookie().some((value) => value.startsWith("sermo.session_data=")),
    ).toBe(true);
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  }
});

test("a file that depends on the viewer is never public, in any answer", async () => {
  const app = await setup();
  const note = await app.upload(
    "attachment",
    new Blob(["a note of twenty bytes"], { type: "text/plain" }),
    "n.txt",
  );
  const picture = await app.upload(
    "attachment",
    new Blob([redPixel], { type: "image/png" }),
    "p.png",
  );
  const thread = await app.json("POST", `/api/v1/nodes/${app.forum.id}/threads`, {
    title: "Pictures",
    body: "One attached",
    attachmentIds: [picture.id],
  });
  expect(thread.status).toBe(201);
  // Attached to a post the file is public in storage, yet who may see the post decides.
  expect(
    app.ctx.sqlite
      .prepare<{ visibility: string }, [number]>("SELECT visibility FROM files WHERE id = ?1")
      .get(picture.id)!.visibility,
  ).toBe("public");

  for (const file of [note, picture]) {
    const ask = (headers: Record<string, string> = {}, method = "GET") =>
      app.request(file.url, { method, headers: { cookie: app.cookie, ...headers } });
    const served = await ask();
    expect(served.status).toBe(200);
    const headers = caching(served);
    expect(headers.cacheControl).toBe("private, no-cache");
    expect(headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    const answers = [
      served,
      await ask({ "if-none-match": headers.etag! }),
      await ask({ "if-modified-since": headers.lastModified! }),
      await ask({ "if-none-match": headers.etag! }, "HEAD"),
      await ask({}, "HEAD"),
      await ask({ range: "bytes=0-1" }),
      await ask({ range: "bytes=999999-" }),
      await ask({ cookie: app.tokenOnly }),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([
      200, 304, 304, 304, 200, 206, 416, 200,
    ]);
    for (const answer of answers) {
      expect(answer.headers.get("cache-control")).toStartWith("private, no-");
      expect(answer.headers.get("cache-control")).not.toContain("public");
    }
    expect(caching(answers[1]!)).toEqual(headers);
    expect(await answers[1]!.text()).toBe("");
    // A range that cannot be sent is never kept.
    expect(answers[6]!.headers.get("cache-control")).toBe("private, no-store");
  }

  // A visitor who may not see the file is not told that a copy is current.
  const note304 = await app.request(note.url, { headers: { "if-none-match": "*" } });
  expect(note304.status).toBe(404);
  expect(note304.headers.get("etag")).toBeNull();
});
