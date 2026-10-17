import { warningActionsList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { staffTrail } from "../../../../../trail";
import { FormSkeleton } from "../../../../groups/skeletons";
import { ActionForm, groupChoices } from "../../warning-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.warningActions.form");
  return { title: t("headingEdit") };
}

async function WarningAction({
  params,
}: {
  params: PageProps<"/[locale]/admin/settings/warnings/actions/[id]">["params"];
}) {
  const actionId = parseId((await params).id);
  if (actionId === null) notFound();
  const [{ items }, groups] = await Promise.all([
    read(warningActionsList, {}),
    groupChoices(),
  ]);
  const action = items.find((other) => other.id === actionId);
  if (!action) notFound();
  return <ActionForm action={action} groups={groups} />;
}

export default function EditWarningActionPage({
  params,
}: PageProps<"/[locale]/admin/settings/warnings/actions/[id]">) {
  const t = useTranslations("adminSetup.warningActions.form");
  const loading = useTranslations("adminSetup.loading");
  return (
    <ScreenFrame
      trail={params.then(({ id }) =>
        staffTrail(`/admin/settings/warnings/actions/${id}`),
      )}
      heading={t("headingEdit")}
      label={loading("label")}
      fallback={<FormSkeleton />}
    >
      <WarningAction params={params} />
    </ScreenFrame>
  );
}
