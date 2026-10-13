import { paletteColorsList, threadPrefixesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ConfirmStep } from "@/components/staff/confirm-step";
import {
  DeleteBox,
  EditDisclosure,
  EntryList,
} from "@/components/staff/entity-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { deletePrefix } from "../actions";
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
        namespace="adminForums.notices"
        searchParams={searchParams}
        shown={["created", "saved", "deleted", "deactivated"]}
      />
      <EntryList
        heading={t("heading")}
        none={t("none")}
        items={items.map((prefix) => (
          <li key={prefix.id}>
            <EditDisclosure
              className="group"
              summaryClass="min-h-12"
              edit={t("edit")}
              summary={
                <>
                  <PrefixTag prefix={prefix} />
                  <span className="text-xs text-muted-foreground">
                    {t("order", { position: prefix.position })}
                  </span>
                  {!prefix.isActive && (
                    <Badge variant="outline">{t("inactive")}</Badge>
                  )}
                </>
              }
            >
              <PrefixForm prefix={prefix} colours={colours} />
              <DeleteBox>
                <ConfirmStep
                  action={deletePrefix}
                  fields={{ id: prefix.id }}
                  summary={`${t("delete")}…`}
                  warning={t("deleteWarning")}
                  submit={t("delete")}
                />
              </DeleteBox>
            </EditDisclosure>
          </li>
        ))}
      />
      <PrefixForm colours={colours} />
    </>
  );
}
