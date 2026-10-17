import { threadPrefixesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { ConfirmStep } from "@/components/staff/confirm-step";
import { ItemList, RowLink } from "@/components/staff/item-list";
import { Notice } from "@/components/staff/notice";
import { Badge } from "@/components/ui/badge";
import { read } from "@/lib/sermo/client";
import { deletePrefix } from "../actions";

// Every prefix in the backend's order (inactive ones too, for an administrator), each with its
// edit link and its delete behind a confirmation.
export async function PrefixList({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string | string[] }>;
}) {
  const [t, { items }] = await Promise.all([
    getTranslations("adminForums.prefixes"),
    read(threadPrefixesList, {}),
  ]);
  return (
    <>
      <Notice
        namespace="adminForums.notices"
        searchParams={searchParams}
        shown={["created", "saved", "deleted", "deactivated"]}
      />
      <ItemList
        label={t("listLabel")}
        empty={{ title: t("none"), description: t("noneDescription") }}
        items={items.map((prefix) => ({
          id: prefix.id,
          title: <PrefixTag prefix={prefix} />,
          href: `/admin/forums/prefixes/${prefix.id}`,
          description: t("order", { position: prefix.position }),
          badges: !prefix.isActive && (
            <Badge variant="outline">{t("inactive")}</Badge>
          ),
          actions: (
            <>
              <RowLink
                href={`/admin/forums/prefixes/${prefix.id}`}
                label={t("edit", { label: prefix.label })}
              />
              <ConfirmStep
                action={deletePrefix}
                fields={{ id: prefix.id }}
                summary={`${t("delete")}…`}
                warning={t("deleteWarning")}
                submit={t("delete")}
              />
            </>
          ),
        }))}
      />
    </>
  );
}
