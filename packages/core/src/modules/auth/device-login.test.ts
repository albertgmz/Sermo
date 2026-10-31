import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan } from "@sermo/core/testing";
import { STAFF_TYPES_JSON, staffUnreadSql } from "../notifications/staff";
import { DEVICE_LOGIN_SQL, purgeExpiredCredentialsBatch } from "./index";

test("a device login is found by its token through the unique token index", () => {
  expectNoTableScan(createTestContext(), DEVICE_LOGIN_SQL, ["token"]);
});

test("a device login's count of staff notices reads the member's unread range of one index", () => {
  expectNoTableScan(createTestContext(), staffUnreadSql, [1, 0, STAFF_TYPES_JSON]);
});

test("the credential purge deletes the device codes that expired, and only those", () => {
  const ctx = createTestContext();
  const now = ctx.now();
  ctx.sqlite.run(
    "INSERT INTO auth_device_code (device_code, user_code, expires_at, status, client_id) VALUES ('d1', 'U1', ?1, 'pending', 'sermo-cli'), ('d2', 'U2', ?2, 'pending', 'sermo-cli'), ('d3', 'U3', ?3, 'approved', 'sermo-cli')",
    [now - 1, now, now + 1],
  );
  expect(purgeExpiredCredentialsBatch(ctx)).toMatchObject({ deviceCodes: 2, more: false });
  expect(
    ctx.sqlite.query<{ device_code: string }, []>("SELECT device_code FROM auth_device_code").all(),
  ).toEqual([{ device_code: "d3" }]);
});
