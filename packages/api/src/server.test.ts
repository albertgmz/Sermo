import { expect, test } from "bun:test";
import { registerEmailJobs } from "@sermo/core";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { signUnsubscribe } from "../../core/src/modules/email/token";
import { createApp } from "./app";
import { handleUnsubscribeRequest, readConfiguration, shutdown } from "./server";

test("one-click POST ignores its body, keeps the client IP, and browser confirmation is HTML", async () => {
  const ctx = createTestContext();
  const user = insertUser(ctx, { username: "Reader" });
  registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    {
      defaults: { "digest.weekly": { inApp: false, email: true, push: false } },
      securityTypes: new Set(),
    },
  );
  const token = await signUnsubscribe(ctx, user.id, "digest.weekly");
  const app = createApp(ctx, { trustedProxyHeader: null });
  const server = {
    requestIP: () => ({ address: "198.51.100.10", family: "IPv4" as const, port: 1 }),
  };
  const url = `http://localhost:3000/api/v1/unsubscribe?token=${token}`;
  const response = await handleUnsubscribeRequest(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "ignored",
    }),
    app,
    server,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ scope: "digest.weekly" });
  const browser = await handleUnsubscribeRequest(
    new Request(`${url}&confirm=1`, { method: "POST" }),
    app,
    server,
  );
  expect(browser.headers.get("content-type")).toContain("text/html");
  expect(await browser.text()).toContain("preferences were updated");
});

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
    closeMailer: () => {
      order.push("close mailer");
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
    "close mailer",
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
      closeMailer: () => {
        order.push("mailer");
      },
      stopCheckpointer: () => {
        order.push("checkpointer");
      },
      closeContext: () => {
        order.push("close");
      },
    }),
  ).rejects.toBeInstanceOf(AggregateError);
  expect(order).toEqual([
    "stop",
    "flush",
    "scheduler",
    "worker",
    "mailer",
    "checkpointer",
    "close",
  ]);
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
  expect(
    readConfiguration({ ...base, SERMO_PUBLIC_FILES_URL: "https://cdn.example.test" })
      .publicFileBaseURL,
  ).toBe("https://cdn.example.test");
  expect(() =>
    readConfiguration({ ...base, SERMO_PUBLIC_FILES_URL: "https://cdn.example.test/path" }),
  ).toThrow("SERMO_PUBLIC_FILES_URL");
  expect(readConfiguration({ ...base, SERMO_FILES_DIR: "" }).storage.directory).toContain("files");
});

test("SMTP settings accept loopback sites over HTTP and an explicit STARTTLS setting", () => {
  const smtp = {
    BETTER_AUTH_SECRET: "test-secret-for-sermo-tests-0123456789abcdef",
    BETTER_AUTH_URL: "https://api.example.test",
    SERMO_MAIL_DRIVER: "smtp",
    SERMO_SMTP_HOST: "relay",
    SERMO_MAIL_FROM: "forum@example.test",
  };
  for (const site of ["http://localhost:3000", "http://127.1.2.3", "http://[::1]:3000"])
    expect(readConfiguration({ ...smtp, SERMO_SITE_URL: site }).siteBaseURL).toBe(
      new URL(site).origin,
    );
  expect(() => readConfiguration({ ...smtp, SERMO_SITE_URL: "http://forum.example.test" })).toThrow(
    "HTTPS",
  );
  expect(readConfiguration(smtp).mail.requireTLS).toBeUndefined();
  expect(readConfiguration({ ...smtp, SERMO_SMTP_REQUIRE_TLS: "false" }).mail.requireTLS).toBe(
    false,
  );
  expect(readConfiguration({ ...smtp, SERMO_SMTP_REQUIRE_TLS: "true" }).mail.requireTLS).toBe(true);
  expect(() => readConfiguration({ ...smtp, SERMO_SMTP_REQUIRE_TLS: "no" })).toThrow(
    "SERMO_SMTP_REQUIRE_TLS",
  );
});
