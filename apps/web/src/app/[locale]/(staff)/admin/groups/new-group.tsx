import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { GroupForm } from "./group-form";
import { FormSkeleton } from "./skeletons";

// The page for a new group, at `/admin/groups?new=1`: the list's own address, as the registry has
// no screen of its own for it. The way up ends in the list.
export async function NewGroup() {
  const [t, list] = await Promise.all([
    getTranslations("adminGroups.new"),
    getTranslations("adminGroups.list"),
  ]);
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/groups").then((crumbs) => [
        ...crumbs,
        { href: "/admin/groups", label: list("pageHeading") },
      ])}
      label={t("loading")}
      fallback={<FormSkeleton />}
    >
      <GroupForm />
    </ScreenFrame>
  );
}
