import { moderatorLogList } from "@sermo/core/contracts";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { cursorFrom } from "@/components/staff/cursor-list";
import { LogTable } from "@/components/staff/log-table";
import { linkClass } from "@/components/staff/rows";
import { call, errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { first, forumOptions } from "../../../moderation/filter-bar";
import type { Standing } from "../../../registry";
import { MemberLink, memberNames, panelHref } from "../links";
import { MemberFilter, memberFilterId } from "../member-filter";

type Params = PageProps<"/[locale]/admin/logs/moderator">["searchParams"];

// The public page of what an entry acted on, for the kinds that have one.
function targetHref(type: string, id: number) {
  if (type === "thread") return `/threads/${id}`;
  if (type === "user") return `/members/${id}`;
  if (type === "node" || type === "forum") return `/forums/${id}`;
  return undefined;
}

function Target({
  type,
  id,
  viewer,
  label,
}: {
  type: string;
  id: number;
  viewer: Standing;
  label: string;
}) {
  const t = useTranslations("adminTools.links");
  const href = targetHref(type, id);
  const panel =
    type === "user" ? panelHref(viewer, "usersEdit", id) : undefined;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3">
      {href ? (
        <Link href={href} className={linkClass}>
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {panel && (
        <Link href={panel} className={`${linkClass} text-xs`}>
          {t("panel")}
        </Link>
      )}
    </span>
  );
}

// The moderator log as the backend returns it for this viewer. A page may be short or empty
// while `nextCursor` is set (the backend examines a bounded number of rows per call), so the way
// on is offered whenever there is a cursor.
export async function ModeratorLog({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const nodeId = parseId(first(params.nodeId)) ?? undefined;
  const actorId = memberFilterId(params, "actorId") ?? undefined;
  const action = first(params.action).trim() || undefined;
  const [t, viewer, forums] = await Promise.all([
    getTranslations("adminTools.moderatorLog"),
    getViewer(),
    forumOptions(),
  ]);
  // The backend decides what an action prefix may be; its refusal is shown above the log.
  let rejected: string | undefined;
  let page: z.output<typeof moderatorLogList.output> | undefined;
  try {
    page = await call(moderatorLogList, {
      nodeId,
      actorId,
      action,
      cursor: cursorFrom(params),
      limit: 25,
    });
  } catch (error) {
    if (!(error instanceof SermoError) || error.code !== "validation") {
      throw error;
    }
    rejected = await errorMessage(error);
  }
  const entries = page?.items ?? [];
  const name = await memberNames(entries.map((entry) => entry.actorId));
  const nextCursor = page?.nextCursor ?? null;
  return (
    <>
      <MemberFilter
        path="/admin/logs/moderator"
        params={params}
        param="actorId"
        heading={t("actor")}
      />
      {rejected && (
        <p
          role="alert"
          className="rounded-lg border bg-card px-4 py-2.5 text-xs font-medium text-destructive [overflow-wrap:anywhere]"
        >
          {t("rejected", { message: rejected })}
        </p>
      )}
      <LogTable
        label={t("heading")}
        path="/admin/logs/moderator"
        params={params}
        nextCursor={nextCursor}
        entries={entries.map((entry) => ({
          id: entry.id,
          at: entry.createdAt,
          actor: (
            <MemberLink
              id={entry.actorId}
              name={name(entry.actorId)}
              panel={panelHref(viewer, "usersEdit", entry.actorId)}
            />
          ),
          action: entry.action,
          actionId: entry.action,
          target: (
            <Target
              type={entry.targetType}
              id={entry.targetId}
              viewer={viewer}
              label={t("target", {
                type: entry.targetType,
                id: entry.targetId,
              })}
            />
          ),
          details: entry.details,
          reason: entry.reason || undefined,
        }))}
        filters={{
          search: { name: "action", label: t("action"), hint: t("actionHint") },
          selects: [{ name: "nodeId", label: t("forum"), options: forums }],
          carry:
            actorId === undefined ? undefined : { actorId: String(actorId) },
        }}
        empty={
          nextCursor === null
            ? { title: t("emptyTitle"), description: t("emptyDescription") }
            : {
                title: t("partialTitle"),
                description: t("partialDescription"),
              }
        }
      />
    </>
  );
}
