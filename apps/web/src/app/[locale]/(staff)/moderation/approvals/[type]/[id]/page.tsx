import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { HtmlContent } from "@/components/forum/html-content";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ContentIp } from "@/components/staff/content-ip";
import { PageHeader } from "@/components/staff/page-header";
import { linkClass, Section } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { parseId } from "@/lib/sermo/ids";
import { getViewer } from "@/lib/sermo/session";
import { spoilerContentFor } from "@/lib/spoiler-buttons";
import {
  MemberLink,
  memberNames,
  panelHref,
} from "../../../../admin/logs/links";
import { FormSkeleton } from "../../../../skeletons";
import { staffTrail } from "../../../../trail";
import { AuditedRead } from "../../../audited-read";
import { APPROVAL_TYPES, describe } from "../../../content";
import { ContentSkeleton } from "../../../skeletons";
import { Where } from "../../../where";
import { viewApprovalMessage } from "./actions";
import { DecisionForms } from "./decision-form";

type Props = PageProps<"/[locale]/moderation/approvals/[type]/[id]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ type, id }, t, label] = await Promise.all([
    params,
    getTranslations("moderation.review"),
    getTranslations("moderation.common.type"),
  ]);
  const known = APPROVAL_TYPES.find((option) => option === type);
  return { title: t("metaTitle", { type: known ? label(known) : type, id }) };
}

export default function ApprovalReviewPage({ params }: Props) {
  const t = useTranslations("moderation.review");
  return (
    <div className="space-y-6">
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <ContentSkeleton />
              <FormSkeleton rows={3} />
              <FormSkeleton rows={3} />
            </div>
          </LoadingRegion>
        }
      >
        <Review params={params} />
      </Suspense>
    </div>
  );
}

// One queued item in full, and the two ways to decide it. Whether the viewer may approve it is the
// backend's: the decision is refused there. A conversation message is read only through the
// audited preview.
async function Review({ params }: { params: Props["params"] }) {
  const raw = await params;
  const id = parseId(raw.id);
  const type = APPROVAL_TYPES.find((option) => option === raw.type);
  if (id === null || !type) notFound();
  const [t, label, contentState, format, viewer, detail] = await Promise.all([
    getTranslations("moderation.review"),
    getTranslations("moderation.common.type"),
    getTranslations("moderation.common.content"),
    getFormatter(),
    getViewer(),
    describe(type, id),
  ]);
  if (type !== "conversation_message" && detail.state === null) notFound();
  const name = await memberNames([
    ...(detail.author ? [detail.author.id] : []),
    ...(detail.where?.kind === "wall" ? [detail.where.id] : []),
  ]);
  return (
    <>
      <PageHeader
        trail={staffTrail(`/moderation/approvals/${type}/${id}`)}
        title={t("heading", { type: label(type), id })}
      />
      {type === "conversation_message" ? (
        <AuditedRead action={viewApprovalMessage} fields={{ id: String(id) }} />
      ) : (
        <Section
          heading={t("contentHeading")}
          description={t("contentDescription")}
        >
          <div className="space-y-3 p-4">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {detail.author && (
                <MemberLink
                  id={detail.author.id}
                  name={detail.author.username}
                  panel={panelHref(viewer, "usersEdit", detail.author.id)}
                />
              )}
              {detail.createdAt && (
                <time dateTime={detail.createdAt}>
                  {format.dateTime(new Date(detail.createdAt), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              )}
              {detail.state && (
                <Badge
                  variant={
                    detail.state === "moderated" ? "default" : "secondary"
                  }
                >
                  {contentState(detail.state)}
                </Badge>
              )}
            </p>
            {detail.bodyHtml !== null && (
              <HtmlContent content={spoilerContentFor(type, id)}>
                {detail.bodyHtml}
              </HtmlContent>
            )}
            <p className="flex flex-wrap gap-x-6 text-xs">
              <Where where={detail.where} name={name} />
              {detail.href && (
                <Link href={detail.href} className={linkClass}>
                  {t("viewPublic")}
                </Link>
              )}
            </p>
            <ContentIp from={detail.ipFrom} />
            {detail.state !== "moderated" && (
              <p className="text-xs text-muted-foreground">{t("notWaiting")}</p>
            )}
          </div>
        </Section>
      )}
      <DecisionForms type={type} id={id} />
    </>
  );
}
