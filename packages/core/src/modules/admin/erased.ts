import { type Ctx, prepared } from "../../context";
import { ConflictError } from "../../errors";

/** An erased account takes no administrative change; reading it is allowed. */
export function requireNotErased(ctx: Ctx, userId: number): void {
  const row = prepared(ctx, "admin.erasedAt", () =>
    ctx.sqlite.prepare<{ erased_at: number | null }, [number]>(
      "SELECT erased_at FROM users WHERE id = ?1",
    ),
  ).get(userId);
  if (row?.erased_at != null) throw new ConflictError("This member's account was erased.");
}
