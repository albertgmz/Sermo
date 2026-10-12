import { reportsGet } from "@sermo/core/contracts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { linkClass } from "@/components/staff/rows";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { PageHead } from "../../../../admin/groups/skeletons";
import { AuditedRead } from "../../../audited-read";
import { ContentSkeleton } from "../../../skeletons";
import { viewReportedMessage } from "./actions";

type Props = PageProps<"/moderation/reports/[id]/message">;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.message");
  return { title: t("metaTitle") };
}

export default function ReportedMessagePage({ params }: Props) {
  const t = useTranslations("moderation.message");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ContentSkeleton />
          </LoadingRegion>
        }
      >
        <Message params={params} />
      </Suspense>
    </div>
  );
}

// Only the case is read here (it is not audited). The message itself is read when the moderator
// confirms, by the action, which is what writes the log entry.
async function Message({ params }: { params: Props["params"] }) {
  const groupId = parseId((await params).id);
  if (groupId === null) notFound();
  const [t, group] = await Promise.all([
    getTranslations("moderation.message"),
    read(reportsGet, { groupId }),
  ]);
  if (group.targetType !== "conversation_message") notFound();
  return (
    <div className="space-y-4">
      <Link href={`/moderation/reports/${group.id}`} className={linkClass}>
        {t("back")}
      </Link>
      <AuditedRead
        action={viewReportedMessage}
        fields={{ id: String(group.id) }}
      />
    </div>
  );
}
