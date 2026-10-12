import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { POST } = await import("./route");

const realFetch = globalThis.fetch;
let forwarded: { url: string; headers: Headers }[] = [];
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  process.env.SERMO_PUBLIC_URL = "http://localhost:3000";
  process.env.SERMO_API_URL = "http://127.0.0.1:8787";
  forwarded = [];
});

function backendAnswers(response: () => Response) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    forwarded.push({ url, headers: new Headers(init.headers) });
    return response();
  }) as unknown as typeof fetch;
}

function upload(purpose: string | null, headers: Record<string, string> = {}) {
  const body = new FormData();
  body.set("file", new File([new Uint8Array([1, 2, 3])], "a.png"));
  const query = purpose === null ? "" : `?purpose=${purpose}`;
  return new Request(`http://localhost:3000/admin/uploads${query}`, {
    method: "POST",
    body,
    headers: {
      origin: "http://localhost:3000",
      cookie: "sermo.session_token=abc",
      ...headers,
    },
  });
}

test("a visitor without a session cookie gets a 404 before anything is read", async () => {
  backendAnswers(() => Response.json({ id: 1 }));
  const response = await POST(upload("frame", { cookie: "" }));
  expect(response.status).toBe(404);
  expect(forwarded).toEqual([]);
});

test("another site's origin, or none, is refused", async () => {
  backendAnswers(() => Response.json({ id: 1 }));
  expect(
    (await POST(upload("frame", { origin: "http://evil.test" }))).status,
  ).toBe(403);
  expect((await POST(upload("frame", { origin: "" }))).status).toBe(403);
  expect(forwarded).toEqual([]);
});

test("only the purposes the panel uploads for are accepted", async () => {
  backendAnswers(() => Response.json({ id: 1 }));
  for (const purpose of ["avatar", "cover", "attachment", "nonsense", null]) {
    expect((await POST(upload(purpose))).status, String(purpose)).toBe(400);
  }
  for (const purpose of [
    "frame",
    "cover_preset",
    "thread_cover",
    "node_icon",
    "node_cover",
    "award_image",
    "shop_image",
    "site_logo",
    "site_icon",
    "site_backdrop",
  ]) {
    expect((await POST(upload(purpose))).status, purpose).toBe(200);
  }
});

test("the body is handed on as the visitor and the stored id is answered", async () => {
  backendAnswers(() => Response.json({ id: 42 }));
  const response = await POST(upload("frame"));
  expect(await response.json()).toEqual({ id: 42 });
  expect(forwarded[0].url).toBe(
    "http://127.0.0.1:8787/api/v1/files?purpose=frame",
  );
  expect(forwarded[0].headers.get("cookie")).toBe("sermo.session_token=abc");
  expect(forwarded[0].headers.get("content-type")).toStartWith(
    "multipart/form-data",
  );
});

test("the backend's refusal and its status are passed on", async () => {
  backendAnswers(() =>
    Response.json(
      { error: { code: "forbidden", message: "You may not upload this." } },
      { status: 403 },
    ),
  );
  const response = await POST(upload("frame"));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "You may not upload this." });
});

test("a body that is not a multipart form is refused", async () => {
  backendAnswers(() => Response.json({ id: 1 }));
  const request = new Request(
    "http://localhost:3000/admin/uploads?purpose=frame",
    {
      method: "POST",
      body: "x",
      headers: {
        origin: "http://localhost:3000",
        cookie: "sermo.session_token=abc",
        "content-type": "text/plain",
      },
    },
  );
  expect((await POST(request)).status).toBe(400);
  expect(forwarded).toEqual([]);
});
