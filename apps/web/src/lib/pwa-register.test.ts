import { expect, test } from "bun:test";
import { registerWorker } from "./pwa-register";

const base = { production: true, retire: false, secure: true };

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
  expect(registerWorker({ ...base, workers })).toBe(true);
  expect(calls).toEqual([["/sw.js", { scope: "/", updateViaCache: "none" }]]);
});

test("nothing is registered in development", () => {
  const { calls, workers } = worker();
  expect(registerWorker({ ...base, production: false, workers })).toBe(false);
  expect(calls).toEqual([]);
});

test("nothing is registered on an insecure origin or in a browser without workers", () => {
  const { calls, workers } = worker();
  expect(registerWorker({ ...base, secure: false, workers })).toBe(false);
  expect(registerWorker({ ...base, workers: undefined })).toBe(false);
  expect(calls).toEqual([]);
});

test("a registration the browser refuses is not an error of the page", async () => {
  const workers = { register: () => Promise.reject(new Error("refused")) };
  expect(registerWorker({ ...base, workers })).toBe(true);
  await Promise.resolve();
});

test("the build that retires the worker registers nothing", () => {
  const { calls, workers } = worker();
  expect(registerWorker({ ...base, retire: true, workers })).toBe(false);
  expect(calls).toEqual([]);
});
