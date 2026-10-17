import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { EditForm } from "@/components/staff/edit-form";
import { PageHeader } from "@/components/staff/page-header";
import { StreamedPanel } from "@/components/staff/screen-frame";
import { parseId } from "@/lib/sermo/ids";
import { EditFormSkeleton } from "../../../skeletons";
import { staffTrail } from "../../../trail";
import { deleteRule, saveRule } from "../actions";
import { ruleData } from "../rule-data";
import { RuleFormFields } from "../rule-form";

type Params = PageProps<"/[locale]/admin/credit-rules/[id]">["params"];

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.rules.editPage");
  return { title: t("metaTitle") };
}

// The rule by its id among all of them (the backend reads them only as a list). Its title is the
// page's heading, so the header is drawn once the rule is read.
async function EditRule({ params }: { params: Params }) {
  const id = parseId((await params).id);
  if (id === null) notFound();
  const [t, { items, triggers, nodes }] = await Promise.all([
    getTranslations("adminEconomy.rules"),
    ruleData(),
  ]);
  const rule = items.find((item) => item.id === id);
  if (!rule) notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        trail={staffTrail(`/admin/credit-rules/${rule.id}`)}
        title={rule.title}
        description={t("editPage.description")}
      />
      <div className="space-y-4">
        <EditForm action={saveRule}>
          <RuleFormFields rule={rule} triggers={triggers} nodes={nodes} />
        </EditForm>
        <ConfirmStep
          action={deleteRule}
          fields={{ id: rule.id }}
          heading={t("deleteHeading")}
          warning={t("deleteWarning")}
          submit={t("delete")}
        />
      </div>
    </div>
  );
}

export default function EditRulePage({
  params,
}: PageProps<"/[locale]/admin/credit-rules/[id]">) {
  const t = useTranslations("adminEconomy.rules");
  return (
    <StreamedPanel
      label={t("loading")}
      fallback={<EditFormSkeleton heading rows={5} />}
    >
      <EditRule params={params} />
    </StreamedPanel>
  );
}
