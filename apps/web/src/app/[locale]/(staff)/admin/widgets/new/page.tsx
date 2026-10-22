import { WidgetKind } from "@sermo/core/contracts";
import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { asPosition } from "../positions";
import { TypeChoice } from "../type-choice";
import { WidgetForm } from "../widget-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminWidgets.pages.new");
  return { title: t("metaTitle") };
}

// `?type=` is the second step (the form); without a known type the page asks for one. `?position=`
// is where the list's "Add widget here" was pressed.
async function NewWidget({
  searchParams,
}: {
  searchParams: PageProps<"/[locale]/admin/widgets/new">["searchParams"];
}) {
  const query = await searchParams;
  const one = (value: string | string[] | undefined) =>
    typeof value === "string" ? value : "";
  const position = asPosition(one(query.position)) ?? undefined;
  const type = WidgetKind.safeParse(one(query.type));
  return type.success ? (
    <WidgetForm type={type.data} position={position} />
  ) : (
    <TypeChoice position={position} />
  );
}

export default function NewWidgetPage({
  searchParams,
}: PageProps<"/[locale]/admin/widgets/new">) {
  const t = useTranslations("adminWidgets.pages");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/widgets/new")}
      heading={t("new.heading")}
      subtitle={t("new.subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <NewWidget searchParams={searchParams} />
    </ScreenFrame>
  );
}
