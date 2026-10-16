import { expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor, sharedDatabase } from "../../permissions/test-contexts";

// A member whose right to edit their own profile is taken away in another process, after the
// request's actor was resolved, cannot change a preference any more: the write asks again.
test("preferences.update refuses a member whose permission was revoked since the request began", async () => {
  const fixture = createTestContext();
  const founder = userActor(insertUser(fixture, { groupId: 4 }));
  const member = insertUser(fixture);
  const database = sharedDatabase(fixture);
  try {
    const here = database.open();
    const elsewhere = database.open();
    const actor = resolvedActor(here, member.id);
    const update = getOperation("preferences.update");
    // Warm: the request's own check passes now.
    expect(await execute(here, update, actor, { feedView: "compact" })).toMatchObject({
      feedView: "compact",
    });
    await execute(elsewhere, getOperation("permissions.set"), founder, {
      groupId: 2,
      entries: [{ permission: "profile.editOwn", value: "never" }],
    });
    await expect(execute(here, update, actor, { feedView: "cards" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const stored = here.sqlite
      .prepare<{ feed_view: string }, [number]>("SELECT feed_view FROM users WHERE id = ?1")
      .get(member.id);
    expect(stored?.feed_view).toBe("compact");
  } finally {
    database.close();
  }
});
