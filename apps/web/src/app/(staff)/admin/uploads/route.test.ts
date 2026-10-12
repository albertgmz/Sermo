import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));

const { PANEL_PURPOSES } = await import("@/lib/sermo/upload");
const route = await import("./route");
const { POST } = route;

const realFetch = globalThis.fetch;
let forwarded: { url: string; headers: Headers; body: unknown }[] = [];
let panel = true;
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
  panel = true;
});

// The backend: `auth.me` answers a viewer who is in the panel or not; the file endpoint answers
// what the test says.
function backendAnswers(response: () => Response) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (new URL(url).pathname === "/api/v1/me") {
      const viewer = viewerBody(true);
      viewer.staff.panel = panel;
      return Response.json(viewer);
    }
    forwarded.push({
      url,
      headers: new Headers(init.headers),
      body: init.body,
    });
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
      "content-length": "200",
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

test("a member who is not in the panel gets a 404 for every method, and nothing is forwarded", async () => {
  panel = false;
  backendAnswers(() => Response.json({ id: 1 }));
  expect((await POST(upload("frame"))).status).toBe(404);
  // Whatever the purpose, the origin or the body.
  expect((await POST(upload("avatar"))).status).toBe(404);
  expect(
    (await POST(upload("frame", { origin: "http://evil.test" }))).status,
  ).toBe(404);
  for (const method of [
    route.GET,
    route.HEAD,
    route.PUT,
    route.PATCH,
    route.DELETE,
    route.OPTIONS,
  ]) {
    expect(method().status).toBe(404);
  }
  expect(forwarded).toEqual([]);
});

test("a session the backend does not accept gets a 404 too", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "unauthenticated", message: "Sign in." } },
      { status: 401 },
    )) as unknown as typeof fetch;
  expect((await POST(upload("frame"))).status).toBe(404);
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
  for (const purpose of PANEL_PURPOSES) {
    expect((await POST(upload(purpose))).status, purpose).toBe(200);
  }
});

test("the body is handed on as the visitor and the stored id is answered", async () => {
  backendAnswers(() => Response.json({ id: 42 }));
  const request = upload("frame");
  const response = await POST(request);
  expect(await response.json()).toEqual({ id: 42 });
  expect(forwarded[0].url).toBe(
    "http://127.0.0.1:8787/api/v1/files?purpose=frame",
  );
  expect(forwarded[0].headers.get("cookie")).toBe("sermo.session_token=abc");
  expect(forwarded[0].headers.get("content-type")).toStartWith(
    "multipart/form-data",
  );
  expect(forwarded[0].body).toBeInstanceOf(ReadableStream);
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

test("a body that is not a multipart form, or declares no length, or too much, is refused", async () => {
  backendAnswers(() => Response.json({ id: 1 }));
  const plain = new Request(
    "http://localhost:3000/admin/uploads?purpose=frame",
    {
      method: "POST",
      body: "x",
      headers: {
        origin: "http://localhost:3000",
        cookie: "sermo.session_token=abc",
        "content-type": "text/plain",
        "content-length": "1",
      },
    },
  );
  expect((await POST(plain)).status).toBe(400);
  expect((await POST(upload("frame", { "content-length": "" }))).status).toBe(
    411,
  );
  expect(
    (await POST(upload("frame", { "content-length": "99999999999" }))).status,
  ).toBe(413);
  expect(forwarded).toEqual([]);
});
