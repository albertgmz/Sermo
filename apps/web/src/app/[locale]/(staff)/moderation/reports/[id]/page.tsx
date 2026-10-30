import { reportsGet, reportsSetState } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { GuestName } from "@/components/forum/guest-name";
import { RelativeTime } from "@/components/forum/relative-time";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ContentIp } from "@/components/staff/content-ip";
import { Notice } from "@/components/staff/notice";
import { PageHeader } from "@/components/staff/page-header";
import { Help, linkClass, Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { MemberLink, memberNames, panelHref } from "../../../admin/logs/links";
import { hrefFor } from "../../../registry";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { describe } from "../../content";
import { ContentBody } from "../../content-body";
import { ContentSkeleton } from "../../skeletons";
import { Where } from "../../where";
import { STATE_BADGE } from "../report-list";
import { StateForm } from "./state-form";

type Props = PageProps<"/[locale]/moderation/reports/[id]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ id }, t] = await Promise.all([
    params,
    getTranslations("moderation.case"),
  ]);
  return { title: t("metaTitle", { id }) };
}

export default function ReportCasePage({ params, searchParams }: Props) {
  const t = useTranslations("moderation.case");
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <ContentSkeleton />
              <ContentSkeleton />
              <FormSkeleton rows={3} />
            </div>
          </LoadingRegion>
        }
      >
        <Case params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

// One report group: what was reported, every report on it, and the form that decides it. What the
// backend refuses this viewer (a case outside their forums) is a 404.
async function Case({
  params,
  searchParams,
}: {
  params: Props["params"];
  searchParams: Props["searchParams"];
}) {
  const groupId = parseId((await params).id);
  if (groupId === null) notFound();
  const [t, common, type, stateText, contentState, format, viewer, group] =
    await Promise.all([
      getTranslations("moderation.case"),
      getTranslations("moderation.common"),
      getTranslations("moderation.common.type"),
      getTranslations("moderation.common.state"),
      getTranslations("moderation.common.content"),
      getFormatter(),
      getViewer(),
      read(reportsGet, { groupId }),
    ]);
  const detail = await describe(group.targetType, group.targetId);
  const name = await memberNames([
    ...group.reports.map((report) => report.reporterId),
    ...(group.assignedToId ? [group.assignedToId] : []),
    ...(detail.author ? [detail.author.id] : []),
    ...(detail.where?.kind === "wall" ? [detail.where.id] : []),
    ...(group.targetType === "user" ? [group.targetId] : []),
  ]);
  const messageHref = hrefFor(viewer, "moderationReportMessage")?.replace(
    "[id]",
    String(group.id),
  );
  const authorId =
    group.targetType === "user" ? group.targetId : detail.author?.id;
  const authorPanel =
    authorId === undefined
      ? undefined
      : panelHref(viewer, "usersEdit", authorId);
  return (
    <>
      <PageHeader
        trail={staffTrail(`/moderation/reports/${group.id}`)}
        title={t("heading", { id: group.id })}
        description={type(group.targetType)}
      />
      <Notice
        namespace="moderation.notices"
        searchParams={searchParams}
        shown={["stateSaved", "approved", "rejected"]}
      />
      <Section heading={t("summaryHeading")}>
        <dl className="grid gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="text-muted-foreground">{t("target")}</dt>
          <dd>
            {type(group.targetType)} #{group.targetId}
          </dd>
          <dt className="text-muted-foreground">{t("state")}</dt>
          <dd>
            <Badge variant={STATE_BADGE[group.state]}>
              {stateText(group.state)}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">{t("assignedTo")}</dt>
          <dd>
            {group.assignedToId ? name(group.assignedToId) : t("unassigned")}
          </dd>
          <dt className="text-muted-foreground">{t("reportCount")}</dt>
          <dd>{format.number(group.reportCount)}</dd>
        </dl>
      </Section>
      <Section
        heading={t("contentHeading")}
        description={t("contentDescription")}
      >
        <div className="space-y-3 p-4">
          {(detail.author || detail.guest) && (
            <p className="text-xs text-muted-foreground">
              {detail.author ? (
                <MemberLink
                  id={detail.author.id}
                  name={detail.author.username}
                />
              ) : (
                <GuestName
                  name={detail.guest?.name ?? null}
                  className="font-normal"
                />
              )}{" "}
              {detail.createdAt && <RelativeTime date={detail.createdAt} />}
            </p>
          )}
          {detail.state && detail.state !== "visible" && (
            <Badge variant="secondary">{contentState(detail.state)}</Badge>
          )}
          {detail.bodyHtml !== null ? (
            <ContentBody
              type={group.targetType}
              id={group.targetId}
              html={detail.bodyHtml}
              attachments={detail.attachments}
            />
          ) : group.targetType === "conversation_message" ? (
            <Help>{t("messageHelp")}</Help>
          ) : group.targetType === "user" ? (
            <p className="text-sm">{name(group.targetId)}</p>
          ) : (
            <p className="text-sm text-muted-foreground">{common("gone")}</p>
          )}
          <p className="text-xs">
            <Where where={detail.where} name={name} />
          </p>
          <ContentIp from={detail.ipFrom} />
        </div>
      </Section>
      <Section heading={t("reportsHeading")}>
        {group.reports.length > 0 ? (
          <ul className="divide-y">
            {group.reports.map((report) => (
              <li key={report.id} className="space-y-1 p-4 text-sm">
                <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                  <MemberLink
                    id={report.reporterId}
                    name={name(report.reporterId)}
                    panel={panelHref(viewer, "usersEdit", report.reporterId)}
                  />
                  <RelativeTime date={report.createdAt} />
                </p>
                <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                  <span className="sr-only">{t("reportReason")}: </span>
                  {report.reason}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">
            {t("reportsEmpty")}
          </p>
        )}
      </Section>
      <Section
        heading={t("historyHeading")}
        description={t("historyDescription")}
      >
        <ol className="divide-y text-sm">
          <li className="flex flex-wrap justify-between gap-2 p-4">
            <span>{t("opened")}</span>
            <RelativeTime date={group.createdAt} />
          </li>
          {group.updatedAt !== group.createdAt && (
            <li className="flex flex-wrap justify-between gap-2 p-4">
              <span>
                {t("updated")}: {stateText(group.state)}
                {group.assignedToId && `, ${name(group.assignedToId)}`}
              </span>
              <RelativeTime date={group.updatedAt} />
            </li>
          )}
          {group.resolvedAt && (
            <li className="flex flex-wrap justify-between gap-2 p-4">
              <span>{t("closed")}</span>
              <RelativeTime date={group.resolvedAt} />
            </li>
          )}
        </ol>
      </Section>
      <Section heading={t("linksHeading")} description={t("linksDescription")}>
        <div className="flex flex-wrap gap-x-6 gap-y-1 p-4">
          {detail.href && (
            <Link href={detail.href} className={linkClass}>
              {t("viewPublic")}
            </Link>
          )}
          {authorId !== undefined && (
            <>
              <Link href={`/members/${authorId}`} className={linkClass}>
                {group.targetType === "user"
                  ? t("viewMember")
                  : t("viewAuthor")}
              </Link>
              {authorPanel && (
                <Link href={authorPanel} className={linkClass}>
                  {group.targetType === "user"
                    ? t("viewMemberPanel")
                    : t("viewAuthorPanel")}
                </Link>
              )}
            </>
          )}
          {messageHref && group.targetType === "conversation_message" && (
            <Link href={messageHref} className={linkClass}>
              {t("viewMessage")}
            </Link>
          )}
        </div>
      </Section>
      <StateForm
        groupId={group.id}
        states={reportsSetState.input.shape.state.options}
        current={group.state}
      />
    </>
  );
}
