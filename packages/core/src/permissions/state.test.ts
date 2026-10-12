import { expect, test } from "bun:test";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { writeTx } from "../db/tx";
import { can, combinationsGranting } from "./check";
import { allCombinations, permissionState } from "./state";
import { resolvedActor, sharedDatabase } from "./test-contexts";

test("enumeration returns every stored combination after a newer one was resolved alone", () => {
  const fixture = createTestContext();
  insertUser(fixture, { groupId: 4 });
  const database = sharedDatabase(fixture);
  try {
    const here = database.open();
    const elsewhere = database.open();
    const known = combinationsGranting(here, "admin.permissions");
    expect(known).toHaveLength(1);
    const administrator = insertUser(elsewhere, { groupId: 4 });
    const moderator = insertUser(elsewhere);
    const join = elsewhere.sqlite.prepare(
      "INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, ?2, 0)",
    );
    join.run(administrator.id, 2);
    join.run(moderator.id, 3);
    const combination = (userId: number) =>
      here.sqlite
        .prepare<{ id: number }, [number]>(
          "SELECT permission_combination_id AS id FROM users WHERE id = ?1",
        )
        .get(userId)!.id;
    expect(combination(moderator.id)).toBeGreaterThan(combination(administrator.id));
    expect(
      can(here, resolvedActor(here, moderator.id), "member.warn", { target: { kind: "guest" } }),
    ).toBe(true);
    const stored = here.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM permission_combinations ORDER BY id")
      .all()
      .map((row) => row.id);
    const enumerated = () =>
      allCombinations(here, permissionState(here))
        .map((c) => c.id)
        .sort((a, b) => a - b);
    expect(writeTx(here, enumerated)).toEqual(stored);
    expect(enumerated()).toEqual(stored);
    expect(enumerated()).toEqual(stored);
    expect(combinationsGranting(here, "admin.permissions").sort((a, b) => a - b)).toEqual(
      [...known, combination(administrator.id)].sort((a, b) => a - b),
    );
  } finally {
    database.close();
  }
});
