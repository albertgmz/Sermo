import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { SignatureForm } from "@/app/(main)/account/permission-forms";
import { Credits } from "@/components/forum/credits";
import { PermissionIcon } from "@/components/forum/permission-icon";
import { Badge } from "@/components/ui/badge";
import type { PermissionView, UserView } from "@/lib/db";
import { filterLiteMarkdown } from "@/lib/lite-mode";
import type { PermissionKey } from "@/lib/permissions";

const linkClass =
  "inline-flex min-h-10 items-center font-medium text-primary underline-offset-4 hover:underline";

function shopHref(key: PermissionKey) {
  return `/credits?category=permission#permission-${key}`;
}

function sourceLabel(
  permission: PermissionView,
  user: UserView,
  t: ReturnType<typeof useTranslations<"account.permissions">>,
) {
  switch (permission.source) {
    case "rank":
      return t("rankSource", { rank: String(user.rank?.name) });
    case "staff":
      return t("staffSource");
    case "purchase":
      return permission.quantity === undefined
        ? t("purchaseSource")
        : t("changes", { count: permission.quantity });
    default:
      return null;
  }
}

function Control({
  id,
  permission,
  description,
  children,
}: {
  id: string;
  permission: PermissionView;
  description: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("account.permissions");
  const labels = useTranslations("lib.permissions");
  return (
    <div id={id} className="scroll-mt-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">
          {labels(`${permission.key}.label`)}
        </h2>
        <p className="text-xs text-pretty text-muted-foreground">
          {description}
        </p>
        {!permission.granted && (
          <p className="text-xs text-muted-foreground">
            {t.rich("lockedDescription", {
              shop: (chunks) => (
                <Link href={shopHref(permission.key)} className={linkClass}>
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export async function PermissionsPanel({
  user,
  permissions,
  prices,
  saved,
}: {
  user: UserView;
  permissions: PermissionView[];
  prices: Partial<Record<PermissionKey, number>>;
  saved: string | undefined;
}) {
  const signature = permissions.find(
    (permission) => permission.key === "signature",
  );
  // The editor saves whatever it holds, so it never gets filtered text: when
  // LITE changes the signature the editor starts empty and says why.
  const stored = user.signature ?? "";
  const hidden = (await filterLiteMarkdown(stored)) !== stored;
  const signatureText = hidden ? "" : stored;
  const t = await getTranslations("account.permissions");
  const labels = await getTranslations("lib.permissions");

  return (
    <section id="permissions" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold tracking-tight">{t("heading")}</h1>
        <p className="text-xs text-muted-foreground">
          {t.rich("description", {
            account: (chunks) => (
              <Link href="/account" className={linkClass}>
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
      <ul className="divide-y">
        {permissions.map((permission) => {
          const price = prices[permission.key];
          return (
            <li
              key={permission.key}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                <PermissionIcon permission={permission} className="size-5" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold">
                  {labels(`${permission.key}.label`)}
                  {permission.granted ? (
                    <Badge variant="success">{t("granted")}</Badge>
                  ) : (
                    <Badge variant="secondary">{t("locked")}</Badge>
                  )}
                </p>
                <p className="text-xs text-pretty text-muted-foreground">
                  {labels(`${permission.key}.description`)}
                </p>
              </div>
              <p className="flex basis-full flex-wrap items-center gap-x-3 text-xs text-muted-foreground sm:basis-auto sm:justify-end">
                {permission.granted ? (
                  sourceLabel(permission, user, t)
                ) : (
                  <>
                    {price !== undefined && <Credits value={price} />}
                    <Link href={shopHref(permission.key)} className={linkClass}>
                      {t.rich("shopLink", {
                        permission: labels(`${permission.key}.label`),
                        name: (chunks) => (
                          <span className="sr-only">{chunks}</span>
                        ),
                      })}
                    </Link>
                  </>
                )}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="space-y-6 border-t p-4">
        {signature && (
          <Control
            id="signature"
            permission={signature}
            description={t("signatureDescription")}
          >
            <SignatureForm
              key={`${hidden}${signatureText}`}
              signature={signatureText}
              hidden={hidden}
              locked={!signature.granted}
              saved={saved === "signature"}
            />
          </Control>
        )}
      </div>
    </section>
  );
}
