import { warningTypesList } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { read } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { staffTrail } from "../../../../../trail";
import { FormSkeleton } from "../../../../groups/skeletons";
import { TypeForm } from "../../warning-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.warningTypes.form");
  return { title: t("headingEdit") };
}

async function WarningType({
  params,
}: {
  params: PageProps<"/[locale]/admin/settings/warnings/types/[id]">["params"];
}) {
  const typeId = parseId((await params).id);
  if (typeId === null) notFound();
  const { items } = await read(warningTypesList, {});
  const type = items.find((other) => other.id === typeId);
  if (!type) notFound();
  return <TypeForm type={type} />;
}

export default function EditWarningTypePage({
  params,
}: PageProps<"/[locale]/admin/settings/warnings/types/[id]">) {
  const t = useTranslations("adminSetup.warningTypes.form");
  const loading = useTranslations("adminSetup.loading");
  return (
    <ScreenFrame
      trail={params.then(({ id }) =>
        staffTrail(`/admin/settings/warnings/types/${id}`),
      )}
      heading={t("headingEdit")}
      label={loading("label")}
      fallback={<FormSkeleton />}
    >
      <WarningType params={params} />
    </ScreenFrame>
  );
}
