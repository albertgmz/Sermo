import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EditForm } from "@/components/staff/edit-form";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../trail";
import { EditFormSkeleton } from "../../credits/skeletons";
import { saveRule } from "../actions";
import { ruleData } from "../rule-data";
import { RuleFormFields } from "../rule-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.rules.new");
  return { title: t("metaTitle") };
}

async function NewRule() {
  const [t, { triggers, nodes }] = await Promise.all([
    getTranslations("adminEconomy.rules.new"),
    ruleData(),
  ]);
  return (
    <EditForm action={saveRule} submit={t("submit")}>
      <RuleFormFields triggers={triggers} nodes={nodes} />
    </EditForm>
  );
}

export default function NewRulePage() {
  const t = useTranslations("adminEconomy.rules");
  return (
    <ScreenFrame
      heading={t("new.heading")}
      subtitle={t("new.description")}
      trail={staffTrail("/admin/credit-rules/new")}
      label={t("loading")}
      fallback={<EditFormSkeleton rows={5} />}
    >
      <NewRule />
    </ScreenFrame>
  );
}
