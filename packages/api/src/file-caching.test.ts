import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "@sermo/core";
import { closeContext, invalidate, localDriver } from "@sermo/core";
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
  const signUp = async (username: string) => {
    const response = await request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({
        name: username,
        username,
        email: `${username}@example.test`,
        password: "Password123!",
      }),
    });
    expect(response.status).toBe(200);
    const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!);
    return {
      cookie: cookies.join("; "),
      // The session token alone: the answer carries a refreshed session cookie.
      tokenOnly: cookies.find((part) => part.startsWith("sermo.session_token="))!,
      userId: ((await response.json()) as { user: { id: string } }).user.id,
    };
  };
  const { cookie, tokenOnly, userId } = await signUp("owner");
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
  return { ctx, forum, request, signUp, cookie, tokenOnly, userId, upload, json };
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

test("a file that depends on the viewer is never kept by any cache, in any answer", async () => {
  const app = await setup();
  const recipient = await app.signUp("recipient");
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
  const letter = await app.upload(
    "attachment",
    new Blob(["only for the two of us"], { type: "text/plain" }),
    "l.txt",
  );
  const thread = await app.json("POST", `/api/v1/nodes/${app.forum.id}/threads`, {
    title: "Pictures",
    body: "One attached",
    attachmentIds: [picture.id],
  });
  expect(thread.status).toBe(201);
  const conversation = await app.json("POST", "/api/v1/conversations", {
    title: "Private",
    recipientIds: [Number(recipient.userId)],
    body: "A letter",
    attachmentIds: [letter.id],
  });
  expect(conversation.status).toBe(201);
  // Attached to a post the file is public in storage, yet who may see the post decides.
  expect(
    app.ctx.sqlite
      .prepare<{ visibility: string }, [number]>("SELECT visibility FROM files WHERE id = ?1")
      .get(picture.id)!.visibility,
  ).toBe("public");

  for (const file of [note, picture, letter]) {
    const ask = (headers: Record<string, string> = {}, method = "GET") =>
      app.request(file.url, { method, headers: { cookie: app.cookie, ...headers } });
    const served = await ask();
    expect(served.status).toBe(200);
    const headers = caching(served);
    expect(headers.cacheControl).toBe("private, no-store");
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
    for (const answer of answers)
      expect(answer.headers.get("cache-control"), file.url).toBe("private, no-store");
    expect(caching(answers[1]!)).toEqual(headers);
    expect(await answers[1]!.text()).toBe("");
  }
  // The other member of the conversation is served the letter the same way.
  const received = await app.request(letter.url, { headers: { cookie: recipient.cookie } });
  expect(received.status).toBe(200);
  expect(received.headers.get("cache-control")).toBe("private, no-store");

  // Whoever may not see a file learns nothing about it, a copy named or not: a guest, a stranger
  // to the conversation, and a member the forum is closed to.
  const stranger = await app.signUp("stranger");
  app.ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (group_id, user_id, node_id, permission_id, value) SELECT 0, ?1, ?2, id, -1 FROM permission_definitions WHERE key = 'node.view'",
    )
    .run(Number(stranger.userId), app.forum.id);
  invalidate(app.ctx, "permissions");
  const etags = new Map(
    await Promise.all(
      [note, picture, letter].map(
        async (file) =>
          [
            file.url,
            (await app.request(file.url, { headers: { cookie: app.cookie } })).headers.get("etag")!,
          ] as const,
      ),
    ),
  );
  for (const [file, viewer] of [
    [note, {}],
    [note, { cookie: stranger.cookie }],
    [picture, { cookie: stranger.cookie }],
    [letter, {}],
    [letter, { cookie: stranger.cookie }],
  ] as const) {
    for (const conditional of <Record<string, string>[]>[
      {},
      { "if-none-match": etags.get(file.url)! },
      { "if-none-match": "*" },
    ]) {
      const headers = { ...viewer, ...conditional };
      const refused = await app.request(file.url, { headers });
      expect(refused.status, file.url).toBe(404);
      expect(refused.headers.get("etag")).toBeNull();
      expect(refused.headers.get("cache-control") ?? "").not.toContain("public");
    }
  }
});

test("a variant is cached as its source is, whatever its own row says", async () => {
  const app = await setup();
  const recipient = await app.signUp("recipient");
  const letter = await app.upload(
    "attachment",
    new Blob([redPixel], { type: "image/png" }),
    "l.png",
  );
  expect(
    (
      await app.json("POST", "/api/v1/conversations", {
        title: "Private",
        recipientIds: [Number(recipient.userId)],
        body: "A picture",
        attachmentIds: [letter.id],
      })
    ).status,
  ).toBe(201);
  // A variant row that wrongly says public, as a careless backfill could write it.
  const variant = app.ctx.sqlite
    .prepare<{ id: number }, [string, number]>(
      "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, parent_file_id, variant, created_at) SELECT driver, ?1, byte_size, content_type, sha256, width, height, uploader_id, 'avatar', 'public', id, 'w640', created_at FROM files WHERE id = ?2 RETURNING id",
    )
    .get(crypto.randomUUID(), letter.id)!.id;
  const url = `/api/v1/files/${variant}`;
  const head = await app.request(url, { method: "HEAD", headers: { cookie: recipient.cookie } });
  expect(head.status).toBe(200);
  expect(head.headers.get("cache-control")).toBe("private, no-store");
  const etag = head.headers.get("etag")!;
  const cached = await app.request(url, {
    headers: { cookie: recipient.cookie, "if-none-match": etag },
  });
  expect(cached.status).toBe(304);
  expect(cached.headers.get("cache-control")).toBe("private, no-store");
  expect((await app.request(url)).status).toBe(404);
});
