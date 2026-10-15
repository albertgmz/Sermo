import { useTranslations } from "next-intl";
import { useId } from "react";
import { setLiteMode } from "@/app/[locale]/(main)/actions";
import { LiteCheckbox } from "@/app/[locale]/(main)/data-saver/checkbox";
import { LiteStatus } from "@/app/[locale]/(main)/data-saver/status";
import { PendingButton } from "@/components/forum/pending-button";
import { LITE_CATEGORIES, type LiteState } from "@/lib/lite-preferences";

function PreferenceRow({
  id,
  label,
  description,
  ...props
}: {
  id: string;
  label: string;
  description: string;
  name?: string;
  value?: string;
  defaultChecked: boolean;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex min-h-10 items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1 space-y-1">
        <span id={`${id}-label`} className="block text-sm font-medium">
          {label}
        </span>
        <span id={`${id}-help`} className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="flex size-10 shrink-0 items-center justify-center">
        <LiteCheckbox
          id={id}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-help`}
          {...props}
        />
      </span>
    </label>
  );
}

export function LiteSettingsForm({
  state,
  returnTo,
  saved = false,
}: {
  state: LiteState;
  returnTo: string;
  saved?: boolean;
}) {
  const t = useTranslations("lite.settingsForm");
  const categories = useTranslations("lite.categories");
  const id = useId();

  return (
    <section className="rounded-lg border bg-card">
      <div className="space-y-1 border-b p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold tracking-tight">{t("title")}</h1>
          <span className="text-sm text-muted-foreground">
            <LiteStatus state={state} />
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t("description")}</p>
      </div>
      <form action={setLiteMode} className="group/lite">
        <input type="hidden" name="returnTo" value={returnTo} />
        <PreferenceRow
          id={`${id}-master`}
          name="mode"
          value="all"
          defaultChecked={state.master}
          label={t("masterLabel")}
          description={t("masterDescription")}
        />
        <div className="border-t px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold">{t("categoriesLabel")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("categoriesDescription")}
          </p>
          <p className="mt-2 hidden text-sm text-muted-foreground group-has-[input[name=mode]:checked]/lite:block">
            {t("masterNotice")}
          </p>
        </div>
        <div className="divide-y group-has-[input[name=mode]:checked]/lite:hidden">
          {LITE_CATEGORIES.map(({ key }) => (
            <PreferenceRow
              key={key}
              id={`${id}-${key}`}
              name="category"
              value={key}
              defaultChecked={state.blocked.includes(key)}
              label={categories(`${key}.label`)}
              description={categories(`${key}.description`)}
            />
          ))}
        </div>
        <div className="hidden divide-y group-has-[input[name=mode]:checked]/lite:block">
          {LITE_CATEGORIES.map(({ key }) => (
            <PreferenceRow
              key={key}
              id={`${id}-${key}-locked`}
              defaultChecked
              disabled
              label={categories(`${key}.label`)}
              description={categories(`${key}.description`)}
            />
          ))}
        </div>
        {/* A checked master is submitted first; otherwise the mode is custom. */}
        <input type="hidden" name="mode" value="custom" />
        <div className="space-y-3 border-t p-4">
          {saved && (
            <output className="block text-sm">{t("savedMessage")}</output>
          )}
          <PendingButton className="min-h-10">{t("saveButton")}</PendingButton>
        </div>
      </form>
    </section>
  );
}
