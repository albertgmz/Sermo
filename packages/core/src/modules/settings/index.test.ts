import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { operations, readSiteSettings } from "./index";

test("site settings are admin controlled, validated, and read without a write", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = userActor(insertUser(ctx));
  const get = operations[0]!;
  const update = operations[1]!;
  await expect(execute(ctx, get, GUEST, {})).rejects.toBeInstanceOf(UnauthenticatedError);
  await expect(execute(ctx, update, member, { maxUploadBytes: 123 })).rejects.toBeInstanceOf(
    ForbiddenError,
  );
  const before = ctx.sqlite.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n;
  expect((await execute(ctx, get, admin, {})).maxUploadBytes).toBe(25 * 1024 * 1024);
  expect(ctx.sqlite.query<{ n: number }, []>("SELECT total_changes() AS n").get()!.n).toBe(before);
  await expect(execute(ctx, update, admin, { maxUploadBytes: 0 })).rejects.toThrow();
  const changed = await execute(ctx, update, admin, {
    maxUploadBytes: 1024,
    warningBanThreshold: 8,
  });
  expect(changed.maxUploadBytes).toBe(1024);
  expect(readSiteSettings(ctx).warningBanThreshold).toBe(8);
  expectNoTableScan(ctx, "SELECT value FROM site_settings WHERE key = 'configuration'", []);
});
