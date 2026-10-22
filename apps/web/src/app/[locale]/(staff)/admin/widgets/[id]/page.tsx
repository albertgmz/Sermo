import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { linkClass } from "@/components/staff/rows";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { parseId } from "@/lib/sermo/ids";
import { FormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { getWidgetList } from "../data";
import { PAGE_ADDRESSES, pagesDrawn, positionDrawn, typeDrawn } from "../drawn";
import { widgetName } from "../labels";
import { WidgetForm } from "../widget-form";
import { DeleteStep, DuplicateStep } from "../widget-steps";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminWidgets.pages.edit");
  return { title: t("metaTitle") };
}

async function Editor({
  params,
  searchParams,
}: {
  params: PageProps<"/[locale]/admin/widgets/[id]">["params"];
  searchParams: PageProps<"/[locale]/admin/widgets/[id]">["searchParams"];
}) {
  const widgetId = parseId((await params).id);
  if (widgetId === null) notFound();
  const [t, widgets] = await Promise.all([
    getTranslations("adminWidgets"),
    getWidgetList(),
  ]);
  const widget = widgets.find((item) => item.id === widgetId);
  if (!widget) notFound();
  const pages = pagesDrawn(widget.position).filter(
    (page) => PAGE_ADDRESSES[page],
  );
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          saved: t("notices.saved"),
          added: t("notices.added"),
          duplicated: t("notices.duplicated"),
        }}
      />
      <p className="text-sm font-medium [overflow-wrap:anywhere]">
        {t("edit.about", {
          title: widget.title ?? widgetName(t, widget),
          position: t(`positions.${widget.position}`),
        })}
      </p>
      {!typeDrawn(widget.type) && (
        <p className="text-sm text-muted-foreground">
          {t("edit.typeNotShown")}
        </p>
      )}
      {!positionDrawn(widget.position) && (
        <p className="text-sm text-muted-foreground">
          {t("edit.positionNotShown")}
        </p>
      )}
      <WidgetForm key={widget.updatedAt} type={widget.type} widget={widget} />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <DuplicateStep widget={widget} />
        {pages.map((page) => (
          <Link
            key={page}
            href={PAGE_ADDRESSES[page] as string}
            className={linkClass}
          >
            {t("edit.view", { page: t(`sitePages.${page}`) })}
          </Link>
        ))}
      </div>
      <DeleteStep widget={widget} heading={t("steps.deleteHeading")} />
    </>
  );
}

export default function EditWidgetPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/widgets/[id]">) {
  const t = useTranslations("adminWidgets.pages");
  return (
    <ScreenFrame
      trail={params.then(({ id }) => staffTrail(`/admin/widgets/${id}`))}
      heading={t("edit.heading")}
      subtitle={t("edit.subtitle")}
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <Editor params={params} searchParams={searchParams} />
    </ScreenFrame>
  );
}
