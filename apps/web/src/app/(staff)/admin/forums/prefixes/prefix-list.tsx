import { paletteColorsList, threadPrefixesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { deletePrefix } from "../actions";
import { InlineForm } from "../inline-form";
import { Notice } from "../notice";
import { PrefixForm } from "./prefix-form";

// Every prefix in the backend's order (inactive ones too, for an administrator), each with its
// editor and its delete behind a disclosure, then the form for a new one.
export async function PrefixList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, { items }, { items: colours }] = await Promise.all([
    getTranslations("adminForums.prefixes"),
    read(threadPrefixesList, {}),
    read(paletteColorsList, { kind: "prefix" }),
  ]);
  return (
    <>
      <Notice
        searchParams={searchParams}
        shown={["created", "saved", "deleted", "deactivated"]}
      />
      <section className="overflow-hidden rounded-lg border bg-card">
        <div className="border-b p-4">
          <h2 className="text-sm font-semibold">{t("heading")}</h2>
        </div>
        {items.length > 0 ? (
          <ul aria-label={t("heading")} className="divide-y">
            {items.map((prefix) => (
              <li key={prefix.id}>
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                    <PrefixTag prefix={prefix} />
                    <span className="text-xs text-muted-foreground">
                      {t("order", { position: prefix.position })}
                    </span>
                    {!prefix.isActive && (
                      <Badge variant="outline">{t("inactive")}</Badge>
                    )}
                    <span className="ms-auto text-sm font-medium text-primary">
                      {t("edit")}
                    </span>
                  </summary>
                  <div className="space-y-4 border-t p-4">
                    <PrefixForm prefix={prefix} colours={colours} />
                    <div className="rounded-lg border border-destructive/30 p-4">
                      <p className="text-sm text-pretty">
                        {t("deleteWarning")}
                      </p>
                      <div className="mt-3">
                        <InlineForm
                          action={deletePrefix}
                          submit={t("delete")}
                          variant="destructive"
                        >
                          <input type="hidden" name="id" value={prefix.id} />
                        </InlineForm>
                      </div>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{t("none")}</p>
        )}
      </section>
      <PrefixForm colours={colours} />
    </>
  );
}
