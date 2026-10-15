import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import { usersAdminAcceptances } from "../../contracts/terms";
import type { AcceptanceKind } from "../../db/schema";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { iso } from "../../time";
import { acceptanceSql, publishedVersions } from "../pages/acceptance";
import { targetMember } from "./shared";

interface Row {
  kind: AcceptanceKind;
  version: number;
  ip: string | null;
  accepted_at: number;
}

export const usersAdminAcceptancesOp = implement(usersAdminAcceptances, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.members", {
    target: targetMember(ctx, actor, input.userId),
  });
  return {
    items: prepared(ctx, "admin.acceptances", () =>
      ctx.sqlite.prepare<Row, [number]>(acceptanceSql.member),
    )
      .all(input.userId)
      .map((row) => ({
        kind: row.kind,
        version: row.version,
        acceptedAt: iso(row.accepted_at),
        ip: row.ip,
      })),
    current: publishedVersions(ctx),
  };
});
