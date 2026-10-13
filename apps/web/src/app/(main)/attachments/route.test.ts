import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { siteAnswer } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
// The upload limit is read through the cached site read.
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace, true),
}));

const { POST } = await import("./route");

const realFetch = globalThis.fetch;
let asked: { url: string; headers: Headers; body: unknown }[] = [];
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  process.env.SERMO_PUBLIC_URL = "http://localhost:3000";
  process.env.SERMO_API_URL = "http://127.0.0.1:8787";
  asked = [];
});

function backend(response: () => Response) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const site = siteAnswer(url);
    if (site) return site;
    asked.push({ url, headers: new Headers(init.headers), body: init.body });
    return response();
  }) as unknown as typeof fetch;
}

// A body that records whether anyone started reading it.
function posted(headers: Record<string, string> = {}) {
  const state = { pulled: false };
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulled = true;
        controller.enqueue(new Uint8Array(5));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const request = new Request("http://localhost:3000/attachments", {
    method: "POST",
    headers: {
      cookie: "sermo.session_token=abc",
      origin: "http://localhost:3000",
      "content-type": "multipart/form-data; boundary=----x1",
      "content-length": "5",
      ...headers,
    },
    body,
    duplex: "half",
  } as RequestInit);
  return { request, state };
}

test("a request that fails a check that needs no body is refused before anything is read", async () => {
  backend(() => Response.json({ id: 1 }));
  const cases: [Record<string, string>, number][] = [
    [{ cookie: "" }, 401],
    [{ cookie: "sermo.x=1" }, 401],
    [{ origin: "http://evil.test" }, 403],
    [{ "content-type": "text/plain" }, 400],
    [{ "content-length": "" }, 411],
    [{ "content-length": "99999999999" }, 413],
  ];
  for (const [headers, status] of cases) {
    const { request, state } = posted(headers);
    const response = await POST(request);
    expect(response.status, JSON.stringify(headers)).toBe(status);
    expect(typeof (await response.json()).error).toBe("string");
    expect(state.pulled).toBe(false);
  }
  expect(asked).toEqual([]);
});

test("the body goes to the backend as the request's own stream, as an attachment", async () => {
  backend(() => Response.json({ id: 31 }, { status: 201 }));
  const { request } = posted();
  const response = await POST(request);
  expect(await response.json()).toEqual({ id: 31 });
  expect(asked).toHaveLength(1);
  expect(asked[0].url).toBe(
    "http://127.0.0.1:8787/api/v1/files?purpose=attachment",
  );
  expect(asked[0].body).toBe(request.body);
  expect(asked[0].headers.get("cookie")).toBe("sermo.session_token=abc");
});

test("the backend's refusal is passed on with its words and status", async () => {
  backend(() =>
    Response.json(
      { error: { code: "forbidden", message: "You may not upload files." } },
      { status: 403 },
    ),
  );
  const response = await POST(posted().request);
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "You may not upload files." });
});

test("a file above the site's limit is refused with the limit in the message and nothing is sent", async () => {
  backend(() => Response.json({ id: 1 }));
  const { request, state } = posted({
    "content-length": String(7 * 1024 * 1024),
  });
  const response = await POST(request);
  expect(response.status).toBe(413);
  expect((await response.json()).error).toBe(
    messages.forum.attachments.overLimit.replace("{size}", "5"),
  );
  expect(state.pulled).toBe(false);
  expect(asked).toEqual([]);
});
