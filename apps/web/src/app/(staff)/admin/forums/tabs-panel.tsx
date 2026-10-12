import type { forumTabsList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { Section } from "@/components/staff/rows";
import { Input } from "@/components/ui/input";
import { deleteTab, saveTab } from "./actions";
import { InlineForm } from "./inline-form";

type Tab = z.output<typeof forumTabsList.output>["items"][number];

// The tabs of the public forum list: each is renamed and ordered in place, deleted behind a
// confirmation (its categories stay and belong to no tab), and a new one is added below. A tab
// is given to a root category in that category's own editor.
export async function TabsPanel({ tabs }: { tabs: readonly Tab[] }) {
  const t = await getTranslations("adminForums.tabs");
  return (
    <Section id="tabs" heading={t("heading")} description={t("description")}>
      {tabs.length > 0 ? (
        <ul aria-label={t("heading")} className="divide-y">
          {tabs.map((tab) => (
            <li key={tab.id} className="space-y-3 p-4">
              <InlineForm action={saveTab} submit={t("save")}>
                <input type="hidden" name="id" value={tab.id} />
                <div className="min-w-0 flex-1 space-y-1 sm:max-w-xs">
                  <label htmlFor={`tab-title-${tab.id}`} className="text-xs">
                    {t("title")}
                  </label>
                  <Input
                    id={`tab-title-${tab.id}`}
                    name="title"
                    required
                    defaultValue={tab.title}
                  />
                </div>
                <div className="w-24 space-y-1">
                  <label htmlFor={`tab-position-${tab.id}`} className="text-xs">
                    {t("position")}
                  </label>
                  <Input
                    id={`tab-position-${tab.id}`}
                    name="position"
                    type="number"
                    inputMode="numeric"
                    defaultValue={tab.position}
                  />
                </div>
              </InlineForm>
              <details>
                <summary className="flex min-h-10 cursor-pointer items-center text-sm font-medium text-destructive">
                  {t("delete")}…
                </summary>
                <div className="space-y-3 pt-2">
                  <p className="text-sm text-pretty">
                    {t("deleteWarning", { title: tab.title })}
                  </p>
                  <InlineForm
                    action={deleteTab}
                    submit={t("delete")}
                    variant="destructive"
                  >
                    <input type="hidden" name="id" value={tab.id} />
                  </InlineForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
      )}
      <div className="border-t p-4">
        <h3 className="mb-3 text-sm font-semibold">{t("addHeading")}</h3>
        <InlineForm action={saveTab} submit={t("add")} variant="default">
          <div className="min-w-0 flex-1 space-y-1 sm:max-w-xs">
            <label htmlFor="tab-new-title" className="text-xs">
              {t("title")}
            </label>
            <Input id="tab-new-title" name="title" required />
          </div>
          <div className="w-24 space-y-1">
            <label htmlFor="tab-new-position" className="text-xs">
              {t("position")}
            </label>
            <Input
              id="tab-new-position"
              name="position"
              type="number"
              inputMode="numeric"
            />
          </div>
        </InlineForm>
      </div>
    </Section>
  );
}
