import { beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { bundleWorker } from "../scripts/build-sw-lib";

// The built worker, run against a fake worker scope: the events a browser sends, a fake Cache
// Storage and a fake network. This pins what the worker really does with Serwist's code in it.

const dir = decodeURIComponent(
  new URL("..", import.meta.url).pathname.replace(/^\/(?=[a-z]:)/i, ""),
);

const ORIGIN = "https://forum.test";
const OFFLINE_PAGE = "<h1>offline</h1>";
const IMMUTABLE = "public, max-age=31536000, immutable";

// Cache Storage: named caches of url -> response.
class FakeCache {
  entries = new Map<string, Response>();
  private key = (request: RequestInfo | URL) =>
    typeof request === "string"
      ? request
      : request instanceof URL
        ? request.href
        : request.url;
  async match(request: RequestInfo | URL) {
    return this.entries.get(this.key(request))?.clone();
  }
  async put(request: RequestInfo | URL, response: Response) {
    this.entries.set(this.key(request), response.clone());
  }
  async delete(request: RequestInfo | URL) {
    return this.entries.delete(this.key(request));
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}

function fakeCaches() {
  const stores = new Map<string, FakeCache>();
  return {
    stores,
    open: async (name: string) => {
      const cache = stores.get(name) ?? new FakeCache();
      stores.set(name, cache);
      return cache;
    },
    match: async (request: RequestInfo | URL) => {
      for (const cache of stores.values()) {
        const found = await cache.match(request);
        if (found) return found;
      }
      return undefined;
    },
    keys: async () => [...stores.keys()],
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
  };
}

type Listener = (event: unknown) => void;

// Serwist tells a fetch event by its class.
class FetchEvent {}

// A worker running in a fresh scope. `network` answers every request the worker sends on.
function boot(script: string) {
  const listeners = new Map<string, Listener[]>();
  const caches = fakeCaches();
  const asked: string[] = [];
  const scope = {
    network: (_request: { url: string }): Response | Promise<Response> =>
      new Response("", { status: 404 }),
    skipped: false,
    claimed: false,
    unregistered: false,
    databases: [] as string[],
  };
  const sandbox: Record<string, unknown> = {
    caches,
    FetchEvent,
    indexedDB: {
      deleteDatabase: (name: string) => scope.databases.push(name),
    },
    Request,
    Response,
    Headers,
    URL,
    console,
    setTimeout,
    clearTimeout,
    location: new URL(`${ORIGIN}/sw.js`),
    fetch: async (request: { url: string } | string) => {
      const url = typeof request === "string" ? request : request.url;
      asked.push(url);
      return scope.network(typeof request === "string" ? { url } : request);
    },
    skipWaiting: () => {
      scope.skipped = true;
    },
    clients: {
      claim: async () => {
        scope.claimed = true;
      },
    },
    registration: {
      scope: `${ORIGIN}/`,
      unregister: async () => {
        scope.unregistered = true;
        return true;
      },
    },
    addEventListener: (type: string, listener: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  sandbox.self = sandbox;
  runInNewContext(script, sandbox);

  // Sends an event and waits for every promise the worker hands to `waitUntil` to settle.
  async function dispatch(type: string, fields: Record<string, unknown> = {}) {
    const work: Promise<unknown>[] = [];
    let answer: Promise<Response> | undefined;
    const event = Object.assign(
      type === "fetch" ? new FetchEvent() : {},
      fields,
      {
        type,
        waitUntil: (promise: Promise<unknown>) => work.push(promise),
        respondWith: (promise: Promise<Response>) => {
          answer = promise;
          work.push(promise);
        },
      },
    );
    for (const listener of listeners.get(type) ?? []) listener(event);
    // The worker adds more work while it runs (the cache write after a response): wait for all.
    for (let done = 0; done < work.length; ) {
      const batch = work.slice(done);
      done = work.length;
      await Promise.allSettled(batch);
    }
    return { answered: answer !== undefined, response: answer };
  }

  const fetchEvent = (
    path: string,
    init: { method?: string; mode?: string; destination?: string } = {},
  ) => {
    const request = {
      url: `${ORIGIN}${path}`,
      method: init.method ?? "GET",
      mode: init.mode ?? "cors",
      destination: init.destination ?? "",
      headers: new Headers(),
      credentials: "same-origin",
      redirect: "follow",
      clone() {
        return this;
      },
    };
    return dispatch("fetch", {
      request,
      preloadResponse: Promise.resolve(undefined),
    });
  };

  return { listeners, caches, asked, scope, dispatch, fetchEvent };
}

let script = "";
beforeAll(async () => {
  script = await bundleWorker(dir, false, {
    idb: join(dir, "tests/fake-idb.ts"),
  });
});

// A worker that has installed and taken over, with the network answering as the server does.
async function ready() {
  const worker = boot(script);
  worker.scope.network = (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === "/offline.html") return new Response(OFFLINE_PAGE);
    if (pathname.startsWith("/_next/static/"))
      return new Response("chunk", {
        headers: { "cache-control": IMMUTABLE },
      });
    return new Response("a page of the forum");
  };
  await worker.dispatch("install");
  await worker.dispatch("activate");
  worker.asked.length = 0;
  return worker;
}

const offline = (worker: ReturnType<typeof boot>) => {
  worker.scope.network = () => {
    throw new TypeError("Failed to fetch");
  };
};

const STATIC = "sermo-static-v1";
const PAGES = (worker: ReturnType<typeof boot>) =>
  [...worker.caches.stores.entries()].flatMap(([name, cache]) =>
    [...cache.entries.keys()].map((url) => `${name} ${url}`),
  );

test("it asks for no more than install, activate, fetch and message events", async () => {
  const { listeners } = await ready();
  expect([...listeners.keys()].sort()).toEqual([
    "activate",
    "fetch",
    "install",
    "message",
  ]);
});

test("installing keeps the offline page and the worker takes over at once", async () => {
  const worker = boot(script);
  worker.scope.network = () => new Response(OFFLINE_PAGE);
  await worker.dispatch("install");
  await worker.dispatch("activate");
  expect(worker.scope.skipped).toBe(true);
  expect(worker.scope.claimed).toBe(true);
  expect(
    PAGES(worker).filter((entry) => entry.includes("/offline.html")),
  ).toHaveLength(1);
});

test("a file of the build is kept, and the second request does not reach the network", async () => {
  const worker = await ready();
  const first = await worker.fetchEvent("/_next/static/chunks/a-1f3.js", {
    destination: "script",
  });
  expect(first.answered).toBe(true);
  expect(await (await first.response)?.text()).toBe("chunk");
  expect(PAGES(worker)).toContain(
    `${STATIC} ${ORIGIN}/_next/static/chunks/a-1f3.js`,
  );
  worker.asked.length = 0;
  const second = await worker.fetchEvent("/_next/static/chunks/a-1f3.js", {
    destination: "script",
  });
  expect(await (await second.response)?.text()).toBe("chunk");
  expect(worker.asked).toEqual([]);
});

test("a static address that is not immutable is answered but not kept", async () => {
  const worker = await ready();
  worker.scope.network = () =>
    new Response("<svg/>", {
      headers: { "content-type": "image/svg+xml", "cache-control": "no-store" },
    });
  const result = await worker.fetchEvent("/_next/static/media/logo.js");
  expect(result.answered).toBe(true);
  expect(PAGES(worker).some((entry) => entry.includes("logo.js"))).toBe(false);
});

test("a picture under /_next/static is left to the browser", async () => {
  const worker = await ready();
  const result = await worker.fetchEvent("/_next/static/media/logo.png", {
    destination: "image",
  });
  expect(result.answered).toBe(false);
});

test("a page load goes to the network and nothing of it is kept", async () => {
  const worker = await ready();
  const before = PAGES(worker);
  const result = await worker.fetchEvent("/threads/12-news", {
    mode: "navigate",
    destination: "document",
  });
  expect(result.answered).toBe(true);
  expect(await (await result.response)?.text()).toBe("a page of the forum");
  expect(worker.asked).toEqual([`${ORIGIN}/threads/12-news`]);
  expect(PAGES(worker)).toEqual(before);
});

test("a server error on a page load is shown as it is, not replaced by the offline page", async () => {
  const worker = await ready();
  worker.scope.network = () => new Response("bad gateway", { status: 502 });
  const result = await worker.fetchEvent("/", {
    mode: "navigate",
    destination: "document",
  });
  const response = await result.response;
  expect(response?.status).toBe(502);
  expect(await response?.text()).toBe("bad gateway");
});

test("a page load with no network gets the offline page", async () => {
  const worker = await ready();
  offline(worker);
  const result = await worker.fetchEvent("/threads/12-news", {
    mode: "navigate",
    destination: "document",
  });
  expect(result.answered).toBe(true);
  expect(await (await result.response)?.text()).toBe(OFFLINE_PAGE);
});

test("with no network anything but a page load fails as it would without the worker", async () => {
  const worker = await ready();
  offline(worker);
  for (const [path, init] of [
    ["/api/v1/threads", { destination: "" }],
    ["/threads/12-news", { destination: "" }],
    ["/api/v1/files/5", { mode: "navigate", destination: "document" }],
    ["/api/v1/me", { method: "POST" }],
    ["/threads/12/uploads", { method: "POST" }],
  ] as const) {
    const result = await worker.fetchEvent(path, init);
    expect(result.answered, path).toBe(false);
  }
});

test("the API, files, uploads and a POST are not touched", async () => {
  const worker = await ready();
  for (const [path, init] of [
    ["/api/v1/threads", {}],
    ["/api/v1/files/5", { destination: "image" }],
    ["/api/v1/files/5", { mode: "navigate", destination: "document" }],
    ["/attachments", { method: "POST" }],
    ["/threads/12-news", { method: "POST", mode: "navigate" }],
    ["/_next/static/chunks/a.js", { method: "POST" }],
    ["/threads/12-news", {}],
    ["/manifest.webmanifest", {}],
  ] as const) {
    const result = await worker.fetchEvent(path, init);
    expect(result.answered, `${init.method ?? "GET"} ${path}`).toBe(false);
  }
  expect(worker.asked).toEqual([]);
  expect(PAGES(worker).every((entry) => !entry.includes("/api/"))).toBe(true);
});

test("taking over deletes the caches of an older version and keeps the rest", async () => {
  const worker = boot(script);
  worker.scope.network = () => new Response(OFFLINE_PAGE);
  await worker.caches.open("sermo-static-v0");
  await worker.caches.open("sermo-pages");
  await worker.caches.open(STATIC);
  await worker.caches.open("another-app");
  await worker.dispatch("install");
  await worker.dispatch("activate");
  const names = await worker.caches.keys();
  expect(names).not.toContain("sermo-static-v0");
  expect(names).not.toContain("sermo-pages");
  expect(names).toContain(STATIC);
  expect(names).toContain("another-app");
  expect(names.some((name) => name.startsWith("serwist-precache-"))).toBe(true);
});

// The worker that removes the real one (SERMO_RETIRE_WORKER=1).
test("the retiring worker deletes what the worker kept and unregisters itself", async () => {
  const worker = boot(await bundleWorker(dir, true));
  await worker.caches.open(STATIC);
  await worker.caches.open("serwist-precache-v2-https://forum.test/");
  await worker.caches.open("another-app");
  await worker.dispatch("install");
  expect(worker.scope.skipped).toBe(true);
  await worker.dispatch("activate");
  expect(await worker.caches.keys()).toEqual(["another-app"]);
  expect(worker.scope.databases).toEqual(["serwist-expiration"]);
  expect(worker.scope.unregistered).toBe(true);
  // It answers no request: every page and file goes to the network.
  expect(worker.listeners.has("fetch")).toBe(false);
});
