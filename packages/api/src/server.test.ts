import { expect, test } from "bun:test";
import { readConfiguration, shutdown } from "./server";

test("shutdown waits for requests, then flushes and closes resources in order", async () => {
  const order: string[] = [];
  let release!: () => void;
  const stopped = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = shutdown({
    stopAccepting: async () => {
      order.push("stop accepting");
      await stopped;
    },
    flushViewCounts: () => {
      order.push("flush views");
    },
    stopScheduler: () => {
      order.push("stop scheduler");
    },
    stopWorker: () => {
      order.push("stop worker");
    },
    stopCheckpointer: async () => {
      order.push("stop checkpointer");
    },
    closeContext: () => {
      order.push("close context");
    },
  });
  expect(order).toEqual(["stop accepting"]);
  await Promise.resolve();
  expect(order).toEqual(["stop accepting"]);
  release();
  await done;
  expect(order).toEqual([
    "stop accepting",
    "flush views",
    "stop scheduler",
    "stop worker",
    "stop checkpointer",
    "close context",
  ]);
});

test("shutdown closes the context and reports cleanup failures", async () => {
  const order: string[] = [];
  await expect(
    shutdown({
      stopAccepting: () => {
        order.push("stop");
      },
      flushViewCounts: () => {
        order.push("flush");
        throw new Error("flush failed");
      },
      stopScheduler: () => {
        order.push("scheduler");
      },
      stopWorker: () => {
        order.push("worker");
      },
      stopCheckpointer: () => {
        order.push("checkpointer");
      },
      closeContext: () => {
        order.push("close");
      },
    }),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(order).toEqual(["stop", "flush", "scheduler", "worker", "checkpointer", "close"]);
});

test("startup settings reject invalid port and partial admin credentials before database setup", () => {
  const base = {
    BETTER_AUTH_SECRET: "test-secret-for-sermo-tests-0123456789abcdef",
    BETTER_AUTH_URL: "http://localhost:3000",
  };
  expect(() => readConfiguration({ ...base, PORT: "70000" })).toThrow("PORT");
  expect(() => readConfiguration({ ...base, SERMO_ADMIN_USERNAME: "admin" })).toThrow(
    "must all be set together",
  );
  expect(readConfiguration({ ...base, PORT: "3001" }).port).toBe(3001);
});

test("site base URL is resolved and validated independently of the auth origin", () => {
  const base = {
    BETTER_AUTH_SECRET: "test-secret-for-sermo-tests-0123456789abcdef",
    BETTER_AUTH_URL: "https://api.example.test",
  };
  expect(readConfiguration(base).siteBaseURL).toBe("https://api.example.test");
  expect(
    readConfiguration({ ...base, SERMO_SITE_URL: "https://forum.example.test" }).siteBaseURL,
  ).toBe("https://forum.example.test");
  expect(() => readConfiguration({ ...base, SERMO_SITE_URL: "javascript:alert(1)" })).toThrow(
    "SERMO_SITE_URL",
  );
  expect(() =>
    readConfiguration({ ...base, SERMO_SITE_URL: "https://forum.example.test/sub" }),
  ).toThrow("SERMO_SITE_URL");
});
