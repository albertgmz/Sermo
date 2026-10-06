import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { permissionValue } from "../../permissions";
import { operations, readSiteSettings, settingsQuotaSql } from "./index";

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
  expectNoTableScan(ctx, settingsQuotaSql, []);
});

test("settings permission can be granted without other administrator permissions", async () => {
  const ctx = createTestContext();
  const group = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO groups (title, rank) VALUES ('Settings team', 10) RETURNING id",
    )
    .get()!.id;
  const manager = userActor(insertUser(ctx, { groupId: group }));
  const definition = ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT id FROM permission_definitions WHERE key = 'admin.settings'",
    )
    .get()!.id;
  await expect(execute(ctx, operations[0]!, manager, {})).rejects.toBeInstanceOf(ForbiddenError);
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, 1)",
    )
    .run(definition, group);
  expect((await execute(ctx, operations[0]!, manager, {})).maxUploadBytes).toBe(25 * 1024 * 1024);
  expect(
    (await execute(ctx, operations[1]!, manager, { maxUploadBytes: 2048 })).maxUploadBytes,
  ).toBe(2048);
});

test("updating group upload limits changes the permission and omits the stored field", async () => {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = userActor(insertUser(ctx));
  expect(permissionValue(ctx, member, "attachment.storageQuota")).toBe(100 * 1024 * 1024);
  const updated = await execute(ctx, operations[1]!, admin, {
    groupUploadLimitBytes: { "2": 1000 },
  });
  expect(updated.groupUploadLimitBytes).toEqual({ "2": 1000 });
  expect(permissionValue(ctx, member, "attachment.storageQuota")).toBe(1000);
  const stored = ctx.sqlite
    .prepare<{ value: string }, []>("SELECT value FROM site_settings WHERE key = 'configuration'")
    .get()!.value;
  expect(JSON.parse(stored)).not.toHaveProperty("groupUploadLimitBytes");
  expect(readSiteSettings(ctx)).not.toHaveProperty("groupUploadLimitBytes");
  expect((await execute(ctx, operations[0]!, admin, {})).groupUploadLimitBytes).toEqual({
    "2": 1000,
  });
  const version = () =>
    ctx.sqlite
      .prepare<{ version: number }, []>(
        "SELECT version FROM cache_versions WHERE key = 'permissions'",
      )
      .get()!.version;
  const afterFirstUpdate = version();
  await execute(ctx, operations[1]!, admin, { groupUploadLimitBytes: { "2": 1000 } });
  expect(version()).toBe(afterFirstUpdate);
  const quotaDefinition = ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT id FROM permission_definitions WHERE key = 'attachment.storageQuota'",
    )
    .get()!.id;
  ctx.sqlite
    .prepare(
      "DELETE FROM permission_entries WHERE permission_id = ?1 AND group_id = 2 AND user_id = 0 AND node_id = 0",
    )
    .run(quotaDefinition);
  expect((await execute(ctx, operations[0]!, admin, {})).groupUploadLimitBytes).toEqual({
    "2": 0,
  });
});
