import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { nodesCreateOp, nodesGetOp, nodesListOp, nodesUpdateOp } from "./index";

const call = execute;

function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const member = userActor(insertUser(ctx));
  return { ctx, admin, member };
}

describe("node icon key", () => {
  test("round-trips through create, get, list and update, and null clears it", async () => {
    const { ctx, admin } = setup();
    const made = await call(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "F",
      iconKey: "gamepad-2",
    });
    expect(made.iconKey).toBe("gamepad-2");
    expect((await call(ctx, nodesGetOp, GUEST, { nodeId: made.id })).node.iconKey).toBe(
      "gamepad-2",
    );
    expect((await call(ctx, nodesListOp, GUEST, {})).items[0]!.iconKey).toBe("gamepad-2");

    const kept = await call(ctx, nodesUpdateOp, admin, { nodeId: made.id, title: "G" });
    expect(kept.iconKey).toBe("gamepad-2");
    const changed = await call(ctx, nodesUpdateOp, admin, { nodeId: made.id, iconKey: "music" });
    expect(changed.iconKey).toBe("music");
    const cleared = await call(ctx, nodesUpdateOp, admin, { nodeId: made.id, iconKey: null });
    expect(cleared.iconKey).toBeNull();

    const plain = await call(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "P",
    });
    expect(plain.iconKey).toBeNull();
  });

  test("a malformed key is a validation error", async () => {
    const { ctx, admin } = setup();
    const made = await call(ctx, nodesCreateOp, admin, {
      parentId: null,
      type: "forum",
      title: "F",
    });
    for (const iconKey of ["Music", "two words", "-a", "a-", "a--b", "", "x".repeat(65)]) {
      await expect(
        call(ctx, nodesCreateOp, admin, { parentId: null, type: "forum", title: "F", iconKey }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        call(ctx, nodesUpdateOp, admin, { nodeId: made.id, iconKey }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  test("permissions are unchanged", async () => {
    const { ctx, member } = setup();
    const input = { parentId: null, type: "forum" as const, title: "F", iconKey: "music" };
    await expect(call(ctx, nodesCreateOp, GUEST, input)).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(call(ctx, nodesCreateOp, member, input)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
