import { afterEach, expect, test } from "bun:test";
import {
  browserRecoveryEnv,
  forgetReload,
  type RecoveryEnv,
  recoverFromChunkFailure,
} from "./lazy-popup-recovery";

function setup(options: {
  address?: string;
  online?: boolean;
  storage?: Record<string, string> | "blocked";
}) {
  const store: Record<string, string> =
    options.storage && options.storage !== "blocked" ? options.storage : {};
  const calls = { reloads: 0 };
  const env: RecoveryEnv = {
    storage: () => {
      if (options.storage === "blocked") throw new Error("SecurityError");
      return {
        getItem: (key) => store[key] ?? null,
        setItem: (key, value) => {
          store[key] = value;
        },
        removeItem: (key) => {
          delete store[key];
        },
      };
    },
    address: () => options.address ?? "/threads/12",
    online: () => options.online ?? true,
    reload: () => {
      calls.reloads += 1;
    },
  };
  return { env, calls, store };
}

test("the first failure on an address reloads the page, with a reload and not a navigation", () => {
  const { env, calls } = setup({});
  expect(recoverFromChunkFailure(env, { reloaded: false })).toBe("reloaded");
  expect(calls.reloads).toBe(1);
});

test("a second failure on the same address in the session does not reload again", () => {
  const { env, calls, store } = setup({});
  recoverFromChunkFailure(env, { reloaded: false });
  // The reloaded page: a new page memory, the same session storage.
  expect(recoverFromChunkFailure(env, { reloaded: false })).toBe("gave-up");
  expect(calls.reloads).toBe(1);
  expect(Object.keys(store)).toHaveLength(1);
});

test("another address has its own reload", () => {
  const store: Record<string, string> = {};
  const a = setup({ address: "/threads/12", storage: store });
  const b = setup({ address: "/forums/3", storage: store });
  expect(recoverFromChunkFailure(a.env, { reloaded: false })).toBe("reloaded");
  expect(recoverFromChunkFailure(b.env, { reloaded: false })).toBe("reloaded");
});

test("blocked storage: one reload per page load, and the flag lives in the page", () => {
  const { env, calls } = setup({ storage: "blocked" });
  const memory = { reloaded: false };
  expect(recoverFromChunkFailure(env, memory)).toBe("reloaded");
  expect(recoverFromChunkFailure(env, memory)).toBe("gave-up");
  expect(calls.reloads).toBe(1);
});

test("offline nothing is reloaded: the page would become the browser's error page", () => {
  const { env, calls, store } = setup({ online: false });
  expect(recoverFromChunkFailure(env, { reloaded: false })).toBe("gave-up");
  expect(calls.reloads).toBe(0);
  expect(Object.keys(store)).toHaveLength(0);
});

test("a popup whose code arrives clears the mark, so a later stale chunk there reloads again", () => {
  const { env, calls, store } = setup({});
  expect(recoverFromChunkFailure(env, { reloaded: false })).toBe("reloaded");
  forgetReload(env);
  expect(Object.keys(store)).toHaveLength(0);
  expect(recoverFromChunkFailure(env, { reloaded: false })).toBe("reloaded");
  expect(calls.reloads).toBe(2);
});

const realWindow = (globalThis as { window?: unknown }).window;
afterEach(() => {
  (globalThis as { window?: unknown }).window = realWindow;
});

test("in the browser the address leaves the fragment out and keeps the query, and the page is reloaded", () => {
  const calls = { reload: 0, assign: 0 };
  (globalThis as { window?: unknown }).window = {
    sessionStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    location: {
      pathname: "/threads/12",
      search: "?page=3",
      hash: "#post-40",
      reload: () => {
        calls.reload += 1;
      },
      assign: () => {
        calls.assign += 1;
      },
    },
    navigator: { onLine: true },
  };
  expect(browserRecoveryEnv.address()).toBe("/threads/12?page=3");
  expect(recoverFromChunkFailure(browserRecoveryEnv, { reloaded: false })).toBe(
    "reloaded",
  );
  expect(calls).toEqual({ reload: 1, assign: 0 });
});
