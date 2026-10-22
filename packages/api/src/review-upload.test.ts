import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "@sermo/core";
import {
  closeContext,
  ForbiddenError,
  localDriver,
  readSiteSettings,
  ValidationError,
} from "@sermo/core";
import { createTestContext, userActor } from "@sermo/core/testing";
import { HTTPException } from "hono/http-exception";
import { invalidate } from "../../core/src/context";
import { createApp } from "./app";
import { createServerOptions } from "./server";
import { uploadMultipart } from "./upload";

const contexts: Ctx[] = [];
const dirs: string[] = [];
let nextIp = 1;

afterEach(async () => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function setup(storage = true) {
  const dir = await mkdtemp(join(tmpdir(), "sermo-review-upload-"));
  dirs.push(dir);
  const ctx = createTestContext();
  contexts.push(ctx);
  const app = createApp(ctx, {
    trustedProxyHeader: null,
    ...(storage
      ? { storage: { driver: localDriver(join(dir, "files")), tempDir: join(dir, "temp") } }
      : {}),
  });
  const env = {
    requestIP: () => ({ address: `10.1.0.${nextIp++}`, family: "IPv4" as const, port: 1 }),
  };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const signUp = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:3000",
      "x-forwarded-for": `198.51.100.${nextIp++}`,
    },
    body: JSON.stringify({
      name: "uploader",
      username: "uploader",
      email: "uploader@example.test",
      password: "Password123!",
    }),
  });
  expect(signUp.status).toBe(200);
  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const created = await request("/api/auth/api-key/create", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
    body: JSON.stringify({ name: "test", password: "Password123!" }),
  });
  expect(created.status).toBe(200);
  const { key } = (await created.json()) as { key: string };
  return { dir, ctx, app, request, cookie, key };
}

const boundary = "XBOUNDARYX";
function part(headers: string, body: string) {
  return `--${boundary}\r\n${headers}\r\n\r\n${body}\r\n`;
}
const filePart = part(
  'Content-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain',
  "hello world",
);
const fieldPart = part('Content-Disposition: form-data; name="extra"', "x");
const end = `--${boundary}--\r\n`;

function post(
  state: Awaited<ReturnType<typeof setup>>,
  body: BodyInit | null,
  contentType = `multipart/form-data; boundary=${boundary}`,
  query = "",
) {
  return state.request(`/api/v1/files${query}`, {
    method: "POST",
    headers: {
      cookie: state.cookie,
      origin: "http://localhost:3000",
      "content-type": contentType,
    },
    body,
  });
}

async function leftovers(dir: string) {
  const names: string[] = [];
  for (const sub of ["files", "temp"])
    names.push(...(await readdir(join(dir, sub)).catch(() => [] as string[])));
  return names;
}
function fileRows(ctx: Ctx): number {
  return ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM files").get()!.n;
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 400));
}

test.each([
  ["wrong field name", filePart.replace('name="file"', 'name="wrong"')],
  ["duplicate file", filePart + filePart],
  ["wrong field cut off in content", filePart.replace('name="file"', 'name="wrong"').slice(0, -8)],
  ["duplicate cut off in content", filePart + filePart.slice(0, -8)],
  [
    "wrong field cut off in boundary",
    filePart.replace('name="file"', 'name="wrong"') + end.slice(0, -6),
  ],
  ["duplicate cut off in boundary", filePart + filePart + end.slice(0, -6)],
])("a truncated rejected %s has no unhandled stream errors", async (_name, body) => {
  const state = await setup();
  const errors: unknown[] = [];
  const record = (error: unknown) => errors.push(error);
  process.on("uncaughtException", record);
  process.on("unhandledRejection", record);
  try {
    const response = await post(state, body);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation");
    await settle();
    expect(errors).toEqual([]);
    expect(fileRows(state.ctx)).toBe(0);
    expect(await leftovers(state.dir)).toEqual([]);
  } finally {
    process.off("uncaughtException", record);
    process.off("unhandledRejection", record);
  }
});

test.each(["wrong", "file"])(
  "a disconnected rejected %s stream has no unhandled errors",
  async (name) => {
    const state = await setup();
    const errors: unknown[] = [];
    const record = (error: unknown) => errors.push(error);
    process.on("uncaughtException", record);
    process.on("unhandledRejection", record);
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(
            new TextEncoder().encode(
              name === "file"
                ? filePart + filePart
                : filePart.replace('name="file"', 'name="wrong"'),
            ),
          );
        } else {
          await new Promise((resolve) => setTimeout(resolve, 10));
          controller.error(new Error("Client disconnected."));
        }
      },
    });
    try {
      const response = await post(state, body);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "validation",
      );
      await settle();
      expect(errors).toEqual([]);
      expect(fileRows(state.ctx)).toBe(0);
      expect(await leftovers(state.dir)).toEqual([]);
    } finally {
      process.off("uncaughtException", record);
      process.off("unhandledRejection", record);
    }
  },
);

test("a valid upload still succeeds", async () => {
  const state = await setup();
  const response = await post(state, filePart + end);
  expect(response.status).toBe(201);
  expect(fileRows(state.ctx)).toBe(1);
});

test("a file part followed by an extra field is rejected and nothing is stored", async () => {
  const state = await setup();
  const response = await post(state, filePart + fieldPart + end);
  expect(response.status).toBe(400);
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("a second file part is rejected and nothing is stored", async () => {
  const state = await setup();
  const second = part(
    'Content-Disposition: form-data; name="file"; filename="b.txt"\r\nContent-Type: text/plain',
    "again",
  );
  const response = await post(state, filePart + second + end);
  expect(response.status).toBe(400);
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test.each([
  ["extra field", fieldPart + end],
  ["duplicate file", filePart + end],
  ["truncated headers", `--${boundary}\r\nContent-Disposition:`],
])("a delayed %s cannot leave the first file stored", async (_name, trailingPart) => {
  const state = await setup();
  const prefix = `--${boundary}\r\n`;
  const release = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      // Finish the file part, but hold back the next part's headers and the form's ending.
      controller.enqueue(new TextEncoder().encode(filePart + prefix));
    },
    async pull(controller) {
      await release.promise;
      controller.enqueue(new TextEncoder().encode(trailingPart.slice(prefix.length)));
      controller.close();
    },
  });
  const pending = post(state, body);
  let storedBeforeEnd: number;
  try {
    await settle();
    storedBeforeEnd = fileRows(state.ctx);
  } finally {
    release.resolve();
  }
  const response = await pending;
  expect(response.status).toBe(400);
  expect(storedBeforeEnd).toBe(0);
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("a truncated multipart body is a 400 and nothing is stored", async () => {
  const state = await setup();
  const response = await post(
    state,
    filePart + part('Content-Disposition: form-data; name="x"', "").slice(0, 20),
  );
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation");
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("a file cut off inside its content is a 400 and nothing is stored", async () => {
  const state = await setup();
  const response = await post(state, filePart.slice(0, filePart.length - 8));
  expect(response.status).toBe(400);
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("multipart without a boundary is a 400 validation error", async () => {
  const state = await setup();
  const response = await post(state, "junk", "multipart/form-data; charset=utf-8");
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation");
});

test("a non-multipart content type is a 415 with the error envelope", async () => {
  const state = await setup();
  for (const type of ["application/x-www-form-urlencoded", "text/plain", "application/json"]) {
    const response = await state.request("/api/v1/files", {
      method: "POST",
      headers: { authorization: `Bearer ${state.key}`, "content-type": type },
      body: "a=b",
    });
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "unsupported_media_type",
    );
  }
});

test("a bearer-token upload without a boundary is a 400 validation error", async () => {
  const state = await setup();
  const response = await state.request("/api/v1/files", {
    method: "POST",
    headers: { authorization: `Bearer ${state.key}`, "content-type": "multipart/form-data" },
    body: "junk",
  });
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: { code: string } }).error.code).toBe("validation");
});

test("a genuine storage failure is still a 500", async () => {
  const state = await setup();
  const blocker = join(state.dir, "temp");
  await Bun.write(blocker, "not a directory");
  const response = await post(state, filePart + end);
  expect(response.status).toBe(500);
});

test("uploadMultipart signals 415 with the error envelope for a non-multipart request", async () => {
  const state = await setup();
  const request = new Request("http://localhost/api/v1/files", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "a=b",
  });
  const error = await uploadMultipart(
    state.ctx,
    { kind: "user", userId: 1, groupId: 2, sessionId: 0 } as never,
    request,
    { driver: localDriver(join(state.dir, "files")), tempDir: join(state.dir, "temp") },
    "attachment",
  ).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(HTTPException);
  const response = (error as HTTPException).getResponse();
  expect(response.status).toBe(415);
  expect(await response.json()).toEqual({
    error: { code: "unsupported_media_type", message: "Content-Type must be multipart/form-data." },
  });
});

test("an upload over the configured limit is rejected by the application with the error envelope", async () => {
  const state = await setup();
  const settings = readSiteSettings(state.ctx);
  state.ctx.sqlite
    .prepare("INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0)")
    .run(JSON.stringify({ ...settings, maxUploadBytes: 64 }));
  const big = part(
    'Content-Disposition: form-data; name="file"; filename="a.txt"\r\nContent-Type: text/plain',
    "x".repeat(500),
  );
  const response = await post(state, big + end);
  expect(response.status).toBe(400);
  const body = (await response.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("validation");
  expect(body.error.message).toContain("upload limit");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  await settle();
  expect(fileRows(state.ctx)).toBe(0);
  expect(await leftovers(state.dir)).toEqual([]);
});

test("the file name a browser sends as UTF-8 is stored and used as the download name", async () => {
  const state = await setup();
  const named = part(
    'Content-Disposition: form-data; name="file"; filename="informe económico.txt"\r\nContent-Type: text/plain',
    "hello world",
  );
  const response = await post(state, Buffer.from(named + end, "utf8"));
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: number };
  expect(
    state.ctx.sqlite
      .prepare<{ filename: string | null }, [number]>("SELECT filename FROM files WHERE id = ?1")
      .get(id)?.filename,
  ).toBe("informe económico.txt");
  const served = await state.request(`/api/v1/files/${id}`, { headers: { cookie: state.cookie } });
  expect(served.status).toBe(200);
  expect(served.headers.get("content-disposition")).toBe(
    `attachment; filename="informe econ_mico.txt"; filename*=UTF-8''informe%20econ%C3%B3mico.txt`,
  );
});

function filePrefix() {
  return `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`;
}

test("a refusal that comes while a body of ordinary size is still arriving reaches the sender as an answer", async () => {
  const state = await setup();
  // A limit under the body, a body under what is read after a refusal.
  const settings = readSiteSettings(state.ctx);
  state.ctx.sqlite
    .prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(JSON.stringify({ ...settings, maxUploadBytes: 100_000 }), state.ctx.now());
  const live = Bun.serve({ ...createServerOptions(state.app, 0), hostname: "127.0.0.1" });
  try {
    // Node's client, not fetch: it reports a connection reset instead of hiding it.
    const answer = await new Promise<string>((resolve) => {
      const sent = httpRequest(
        {
          host: "127.0.0.1",
          port: live.port,
          method: "POST",
          path: "/api/v1/files?purpose=attachment",
          headers: {
            cookie: state.cookie,
            origin: "http://localhost:3000",
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () => resolve(`status ${response.statusCode} ${text}`));
        },
      );
      sent.on("error", (error) => resolve(`error ${error.message}`));
      sent.write(filePrefix());
      const chunk = Buffer.alloc(50_000, 97);
      for (let count = 0; count < 12; count++) sent.write(chunk);
      sent.end(`\r\n${end}`);
    });
    expect(answer).toStartWith("status 400");
    expect(answer).toContain("File exceeds upload limit.");
  } finally {
    await live.stop(true);
  }
}, 30_000);

/** A request whose body is `first`, then `more` pieces of 64 KiB, `pause` ms apart; counts what was pulled. */
function slowRequest(more: number, pause: number) {
  const pulled = { bytes: 0, cancelled: false };
  const head = Buffer.from(filePrefix());
  const piece = Buffer.alloc(64 * 1024, 97);
  let sent = -1;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= 0 && pause) await new Promise((resolve) => setTimeout(resolve, pause));
      if (sent === more) return controller.close();
      const next = sent < 0 ? head : piece;
      sent += 1;
      pulled.bytes += next.length;
      controller.enqueue(next);
    },
    cancel() {
      pulled.cancelled = true;
    },
  });
  const request = new Request("http://localhost/api/v1/files", {
    method: "POST",
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body,
    duplex: "half",
  } as RequestInit);
  return { request, pulled };
}

async function refused(
  state: Awaited<ReturnType<typeof setup>>,
  request: Request,
  limits = {},
  purpose = "attachment",
  maxBytes = 1000,
) {
  const user = state.ctx.sqlite
    .prepare<{ id: number; group_id: number }, []>("SELECT id, group_id FROM users LIMIT 1")
    .get()!;
  return uploadMultipart(
    state.ctx,
    userActor({ id: user.id, groupId: user.group_id }),
    request,
    {
      driver: localDriver(join(state.dir, "files")),
      tempDir: join(state.dir, "temp"),
      maxBytes,
    },
    purpose,
    limits,
  ).catch((caught: unknown) => caught);
}

test("a refused upload whose body is larger than what is read after a refusal is cut off", async () => {
  const state = await setup();
  const { request, pulled } = slowRequest(200, 1);
  const error = await refused(state, request, { bytes: 256 * 1024 });
  expect(error).toBeInstanceOf(ValidationError);
  // About the file's limit, the cap and what was in flight; not the 12.5 MB that was on offer.
  expect(pulled.bytes).toBeLessThan(2 * 1024 * 1024);
  expect(pulled.cancelled).toBe(true);
});

test("a refused upload whose body trickles in is cut off when the time is up", async () => {
  const state = await setup();
  const { request, pulled } = slowRequest(1000, 40);
  const started = Date.now();
  const error = await refused(state, request, { ms: 300, bytes: 1e9 });
  expect(error).toBeInstanceOf(ValidationError);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(pulled.bytes).toBeLessThan(2 * 1024 * 1024);
  expect(pulled.cancelled).toBe(true);
});

test("a refused upload whose body is smaller than the cap is read to its end", async () => {
  const state = await setup();
  const { request, pulled } = slowRequest(8, 0);
  const error = await refused(state, request);
  expect(error).toBeInstanceOf(ValidationError);
  expect(pulled.bytes).toBeGreaterThan(8 * 64 * 1024);
  expect(pulled.cancelled).toBe(false);
});

test("a member over their group's size limit with a photo of several MiB is told so, not reset", async () => {
  const state = await setup();
  // The site takes 25 MB; this member's group takes 100 KB, which the web form cannot know.
  state.ctx.sqlite
    .prepare(
      "UPDATE permission_entries SET value = 100000 WHERE node_id = 0 AND user_id = 0 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'attachment.maxFileSize')",
    )
    .run();
  invalidate(state.ctx, "node_tree");
  const live = Bun.serve({ ...createServerOptions(state.app, 0), hostname: "127.0.0.1" });
  try {
    const answer = await new Promise<string>((resolve) => {
      const sent = httpRequest(
        {
          host: "127.0.0.1",
          port: live.port,
          method: "POST",
          path: "/api/v1/files?purpose=attachment",
          headers: {
            cookie: state.cookie,
            origin: "http://localhost:3000",
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
        },
        (response) => {
          let text = "";
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () => resolve(`status ${response.statusCode} ${text}`));
        },
      );
      sent.on("error", (error) => resolve(`error ${error.message}`));
      sent.write(filePrefix());
      const chunk = Buffer.alloc(1 << 20, 97);
      for (let count = 0; count < 8; count++) sent.write(chunk);
      sent.end(`\r\n${end}`);
    });
    expect(answer).toStartWith("status 400");
    expect(answer).toContain("File exceeds your upload limit of 100000 bytes.");
  } finally {
    await live.stop(true);
  }
}, 30_000);

test("after a size refusal the body is read up to the site's limit and a margin, and cut beyond that", async () => {
  const state = await setup();
  const site = 4 * 1024 * 1024;
  // The member's group takes 1000 bytes: every file of theirs is refused for its size.
  state.ctx.sqlite
    .prepare(
      "UPDATE permission_entries SET value = 1000 WHERE node_id = 0 AND user_id = 0 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'attachment.maxFileSize')",
    )
    .run();
  invalidate(state.ctx, "node_tree");
  // 3 MiB: over the group's limit, under the site's, and over the 1 MiB read after other refusals.
  const ordinary = slowRequest(48, 1);
  expect(await refused(state, ordinary.request, {}, "attachment", site)).toBeInstanceOf(
    ValidationError,
  );
  expect(ordinary.pulled.cancelled).toBe(false);
  expect(ordinary.pulled.bytes).toBeGreaterThan(3 * 1024 * 1024);
  // 14 MiB: over the site's limit and the margin.
  const large = slowRequest(224, 1);
  expect(await refused(state, large.request, {}, "attachment", site)).toBeInstanceOf(
    ValidationError,
  );
  expect(large.pulled.cancelled).toBe(true);
  expect(large.pulled.bytes).toBeLessThan(12 * 1024 * 1024);
});

test("a permission refusal with a large body gets its answer for a body of ordinary size and is cut beyond 1 MiB", async () => {
  const state = await setup();
  // A plain member may not upload a frame picture.
  const small = slowRequest(8, 1);
  const refusal = await refused(state, small.request, {}, "frame", 25 * 1024 * 1024);
  expect(refusal).toBeInstanceOf(ForbiddenError);
  expect(small.pulled.cancelled).toBe(false);
  const large = slowRequest(48, 1);
  expect(await refused(state, large.request, {}, "frame", 25 * 1024 * 1024)).toBeInstanceOf(
    ForbiddenError,
  );
  expect(large.pulled.cancelled).toBe(true);
  expect(large.pulled.bytes).toBeLessThan(2.5 * 1024 * 1024);
});
