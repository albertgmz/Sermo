import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
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

/** A grey PNG of the given size, made by hand: this package has no image library. */
function greyPng(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(Bun.hash.crc32(body));
    return Buffer.concat([size, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const rows = Buffer.alloc((width + 1) * height, 0x80);
  for (let row = 0; row < height; row++) rows[row * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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
  // Addresses no other test file uses: the sign-up limit counts per address across the run.
  const from = (address: string) => ({
    requestIP: () => ({ address, family: "IPv4" as const, port: 1 }),
  });
  const env = from(`10.4.0.${nextIp++}`);
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const signUp = async (username: string) => {
    // Each member signs up from an address of their own.
    const response = await app.request(
      "/api/auth/sign-up/email",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({
          name: username,
          username,
          email: `${username}@example.test`,
          password: "Password123!",
        }),
      },
      from(`10.5.0.${nextIp++}`),
    );
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

test("a width copy of a picture has its own address, type and validator, and is kept as its picture is", async () => {
  const app = await setup();
  const recipient = await app.signUp("recipient");
  const wide = () => new Blob([greyPng(1400, 700)], { type: "image/png" });
  const posted = await app.upload("attachment", wide(), "wide.png");
  const sent = await app.upload("attachment", wide(), "sent.png");
  const avatar = await app.upload("avatar", wide(), "me.png");
  const thread = await app.json("POST", `/api/v1/nodes/${app.forum.id}/threads`, {
    title: "Wide",
    body: "A wide picture",
    attachmentIds: [posted.id],
  });
  expect(thread.status).toBe(201);
  const postId = ((await thread.json()) as { post: { id: number } }).post.id;
  expect(
    (
      await app.json("POST", "/api/v1/conversations", {
        title: "Private",
        recipientIds: [Number(recipient.userId)],
        body: "A wide picture",
        attachmentIds: [sent.id],
      })
    ).status,
  ).toBe(201);
  expect((await app.json("PUT", "/api/v1/profile/avatar", { fileId: avatar.id })).status).toBe(200);
  const copy = (source: number, variant: string) =>
    `/api/v1/files/${
      app.ctx.sqlite
        .prepare<{ id: number }, [number, string]>(
          "SELECT id FROM files WHERE parent_file_id = ?1 AND variant = ?2",
        )
        .get(source, variant)!.id
    }`;

  for (const [source, url, cacheControl] of [
    // Attachments depend on who may see their post or conversation, so their copies do too.
    [posted, copy(posted.id, "width_1280"), "private, no-store"],
    [posted, copy(posted.id, "width_640"), "private, no-store"],
    [sent, copy(sent.id, "width_640"), "private, no-store"],
    // An avatar is anyone's to see, and so are its smaller renditions.
    [avatar, copy(avatar.id, "square_128"), year],
  ] as const) {
    const original = await app.request(source.url, { headers: { cookie: app.cookie } });
    const served = await app.request(url, { headers: { cookie: app.cookie } });
    expect(served.status, url).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control"), url).toBe(cacheControl);
    const etag = served.headers.get("etag")!;
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    // Its own bytes: not its picture's validator.
    expect(etag).not.toBe(original.headers.get("etag"));
    const cached = await app.request(url, {
      headers: { cookie: app.cookie, "if-none-match": etag },
    });
    expect(cached.status).toBe(304);
    expect(cached.headers.get("cache-control")).toBe(cacheControl);
    expect(cached.headers.get("etag")).toBe(etag);
    // The picture's validator is not the copy's.
    const other = await app.request(url, {
      headers: { cookie: app.cookie, "if-none-match": original.headers.get("etag")! },
    });
    expect(other.status).toBe(200);
  }
  // Who may not see the picture is not served its copies, validator or not.
  const letterCopy = copy(sent.id, "width_640");
  expect((await app.request(letterCopy)).status).toBe(404);
  const refused = await app.request(letterCopy, { headers: { "if-none-match": "*" } });
  expect(refused.status).toBe(404);
  expect(refused.headers.get("etag")).toBeNull();
  expect(
    (await app.request(letterCopy, { headers: { cookie: recipient.cookie } })).headers.get(
      "cache-control",
    ),
  ).toBe("private, no-store");
  // Nor is a member who is not in the conversation.
  const stranger = await app.signUp("stranger");
  expect((await app.request(letterCopy, { headers: { cookie: stranger.cookie } })).status).toBe(
    404,
  );
  // A copy goes with its picture: once the picture is taken off its post, it is served to nobody.
  const postedCopy = copy(posted.id, "width_1280");
  expect((await app.request(postedCopy)).status).toBe(200);
  expect(
    (await app.json("PATCH", `/api/v1/posts/${postId}`, { body: "No picture", attachmentIds: [] }))
      .status,
  ).toBe(200);
  for (const viewer of [{}, { cookie: stranger.cookie }] as Record<string, string>[]) {
    const hidden = await app.request(postedCopy, { headers: viewer });
    expect(hidden.status).toBe(404);
    expect(hidden.headers.get("etag")).toBeNull();
  }
});

test("the site's public logo and icon may be embedded anywhere; every other file stays same-origin", async () => {
  const app = await setup();
  const policy = async (id: number, headers: Record<string, string> = {}) => {
    const response = await app.request(`/api/v1/files/${id}`, { headers });
    expect(response.status, String(id)).toBe(200);
    return response.headers.get("cross-origin-resource-policy");
  };
  const purpose = (id: number, value: string) =>
    app.ctx.sqlite.prepare("UPDATE files SET purpose = ?1 WHERE id = ?2").run(value, id);
  const variantOf = (id: number, visibility: string) =>
    app.ctx.sqlite
      .prepare<{ id: number }, [string, string, number]>(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, parent_file_id, variant, created_at) SELECT driver, ?1, byte_size, content_type, sha256, width, height, uploader_id, purpose, ?2, id, 'icon_192', created_at FROM files WHERE id = ?3 RETURNING id",
      )
      .get(crypto.randomUUID(), visibility, id)!.id;

  // A public avatar keeps the default.
  const avatar = await setAvatar(app, redPixel);
  expect(await policy(avatar.fileId)).toBe("same-origin");
  // As the site's logo or icon, the same public file, its variants and their 304s are cross-origin.
  purpose(avatar.fileId, "site_logo");
  expect(await policy(avatar.fileId)).toBe("cross-origin");
  purpose(avatar.fileId, "site_icon");
  expect(await policy(avatar.fileId)).toBe("cross-origin");
  const variant = variantOf(avatar.fileId, "public");
  expect(await policy(variant)).toBe("cross-origin");
  const etag = (await app.request(`/api/v1/files/${variant}`)).headers.get("etag")!;
  const kept = await app.request(`/api/v1/files/${variant}`, {
    headers: { "if-none-match": etag },
  });
  expect(kept.status).toBe(304);
  expect(kept.headers.get("cross-origin-resource-policy")).toBe("cross-origin");

  // A site picture not yet in use is its uploader's alone.
  const unused = await app.upload("avatar", new Blob([redPixel], { type: "image/png" }), "u.png");
  purpose(unused.id, "site_logo");
  expect(await policy(unused.id, { cookie: app.cookie })).toBe("same-origin");

  // A private file keeps the default whatever its row or a variant's row claims.
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
  purpose(letter.id, "site_icon");
  expect(await policy(letter.id, { cookie: recipient.cookie })).toBe("same-origin");
  expect(await policy(variantOf(letter.id, "public"), { cookie: recipient.cookie })).toBe(
    "same-origin",
  );
  // A refused file says nothing either.
  const refused = await app.request(`/api/v1/files/${letter.id}`);
  expect(refused.status).toBe(404);
  expect(refused.headers.get("cross-origin-resource-policy")).toBe("same-origin");
});
