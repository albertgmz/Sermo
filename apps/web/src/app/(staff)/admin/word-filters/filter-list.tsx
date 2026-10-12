import { wordFiltersList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { FieldRow, FormRows } from "@/components/staff/form-rows";
import { Notice } from "@/components/staff/notice";
import { Section, selectClass } from "@/components/staff/rows";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";
import { removeWordFilter, saveWordFilter } from "./actions";
import { WordFilterRowForm } from "./row-form";

// The word filters the backend returns. Holders of wordFilter.manage get a form on each row and
// the form for a new filter; the others read the list. The backend enforces either way.
export async function FilterList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, viewer, { items }] = await Promise.all([
    getTranslations("adminContent.wordFilters"),
    getViewer(),
    read(wordFiltersList, {}),
  ]);
  const manage = viewer.resolvedPermissions["wordFilter.manage"] === true;
  return (
    <>
      <Notice
        searchParams={searchParams}
        notices={{
          created: t("notices.created"),
          saved: t("notices.saved"),
          removed: t("notices.removed"),
        }}
      />
      <Section heading={t("list.heading")} description={t("list.description")}>
        {items.length === 0 ? (
          <EmptyState
            title={t("list.emptyTitle")}
            description={t("list.emptyDescription")}
          />
        ) : (
          <ul aria-label={t("list.heading")} className="divide-y">
            {items.map((item) => (
              <li key={item.id} className="space-y-2 p-4">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="[overflow-wrap:anywhere]">{item.term}</span>
                  <Badge variant={item.isActive ? "success" : "secondary"}>
                    {item.isActive ? t("list.active") : t("list.inactive")}
                  </Badge>
                </p>
                {manage ? (
                  <>
                    <WordFilterRowForm
                      id={item.id}
                      term={item.term}
                      action={item.action}
                      replacement={item.replacement}
                      isActive={item.isActive}
                    />
                    <ConfirmStep
                      action={removeWordFilter}
                      fields={{ id: String(item.id) }}
                      summary={t("list.remove")}
                      warning={t("list.removeWarning")}
                      submit={t("list.remove")}
                    />
                  </>
                ) : (
                  <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <div className="flex gap-1">
                      <dt>{t("row.action")}</dt>
                      <dd className="font-medium text-foreground">
                        {t(`row.${item.action}`)}
                      </dd>
                    </div>
                    {item.replacement !== null && (
                      <div className="flex gap-1">
                        <dt>{t("row.replacement")}</dt>
                        <dd className="font-medium text-foreground [overflow-wrap:anywhere]">
                          {item.replacement}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {manage && (
        <FormRows
          action={saveWordFilter}
          heading={t("create.heading")}
          description={t("create.description")}
          submit={t("create.submit")}
          id="new"
        >
          <input type="hidden" name="creating" value="1" />
          <FieldRow
            name="term"
            label={t("create.term")}
            htmlFor="new-term"
            help={t("create.termHelp")}
          >
            <Input id="new-term" name="term" required />
          </FieldRow>
          <FieldRow
            name="action"
            label={t("create.action")}
            htmlFor="new-action"
            help={t("create.actionHelp")}
          >
            <select id="new-action" name="action" className={selectClass}>
              <option value="replace">{t("row.replace")}</option>
              <option value="moderate">{t("row.moderate")}</option>
            </select>
          </FieldRow>
          <FieldRow
            name="replacement"
            label={t("create.replacement")}
            htmlFor="new-replacement"
            help={t("create.replacementHelp")}
          >
            <Input id="new-replacement" name="replacement" />
          </FieldRow>
          <FieldRow
            name="isActive"
            label={t("create.active")}
            htmlFor="new-active"
          >
            <label className="flex min-h-10 items-center gap-3 text-sm">
              <input
                id="new-active"
                type="checkbox"
                name="isActive"
                defaultChecked
                className="size-5"
              />
              {t("create.activeSwitch")}
            </label>
          </FieldRow>
        </FormRows>
      )}
    </>
  );
}
