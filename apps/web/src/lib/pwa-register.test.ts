import { expect, test } from "bun:test";
import { registerWorker } from "./pwa-register";

function worker() {
  const calls: [string, unknown][] = [];
  return {
    calls,
    workers: {
      register: async (url: string, options: unknown) => {
        calls.push([url, options]);
      },
    },
  };
}

test("a production build on a secure origin registers the worker for the whole site", () => {
  const { calls, workers } = worker();
  expect(registerWorker({ production: true, secure: true, workers })).toBe(
    true,
  );
  expect(calls).toEqual([
    ["/serwist/sw.js", { scope: "/", updateViaCache: "none" }],
  ]);
});

test("nothing is registered in development", () => {
  const { calls, workers } = worker();
  expect(registerWorker({ production: false, secure: true, workers })).toBe(
    false,
  );
  expect(calls).toEqual([]);
});

test("nothing is registered on an insecure origin or in a browser without workers", () => {
  const { calls, workers } = worker();
  expect(registerWorker({ production: true, secure: false, workers })).toBe(
    false,
  );
  expect(
    registerWorker({ production: true, secure: true, workers: undefined }),
  ).toBe(false);
  expect(calls).toEqual([]);
});

test("a registration the browser refuses is not an error of the page", async () => {
  const workers = { register: () => Promise.reject(new Error("refused")) };
  expect(registerWorker({ production: true, secure: true, workers })).toBe(
    true,
  );
  await Promise.resolve();
});
