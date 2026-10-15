import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import { usersAdminAcceptances } from "../../contracts/terms";
import type { AcceptanceKind } from "../../db/schema";
import { ACCEPTANCE_KINDS } from "../../db/schema";
import { implement } from "../../operation";
import { can, requirePermission } from "../../permissions";
import { iso } from "../../time";
import { ACCEPTANCES_PER_KIND, acceptanceSql, publishedVersions } from "../pages/acceptance";
import { targetMember } from "./shared";

interface Row {
  kind: AcceptanceKind;
  version: number;
  ip: string | null;
  accepted_at: number;
}

export const usersAdminAcceptancesOp = implement(usersAdminAcceptances, (ctx, actor, input) => {
  requireAuthenticated(actor);
  const target = targetMember(ctx, actor, input.userId);
  requirePermission(ctx, actor, "admin.members", { target });
  // The address needs the permission that reads addresses, as the IP log does.
  const showAddress = can(ctx, actor, "member.viewIps", { target });
  return {
    items: ACCEPTANCE_KINDS.flatMap((kind) =>
      prepared(ctx, "admin.acceptances", () =>
        ctx.sqlite.prepare<Row, [number, string, number]>(acceptanceSql.memberKind),
      ).all(input.userId, kind, ACCEPTANCES_PER_KIND),
    )
      .sort((a, b) => b.accepted_at - a.accepted_at || b.version - a.version)
      .map((row) => ({
        kind: row.kind,
        version: row.version,
        acceptedAt: iso(row.accepted_at),
        ip: showAddress ? row.ip : null,
      })),
    current: publishedVersions(ctx),
  };
});
