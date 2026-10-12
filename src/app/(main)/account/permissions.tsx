import Link from "next/link";
import { SignatureForm } from "@/app/(main)/account/permission-forms";
import { Credits } from "@/components/forum/credits";
import { PermissionIcon } from "@/components/forum/permission-icon";
import { Badge } from "@/components/ui/badge";
import type { PermissionView, UserView } from "@/lib/db";
import { stripMarkdownImages } from "@/lib/lite-markdown";
import { liteBlocks } from "@/lib/lite-mode";
import type { PermissionKey } from "@/lib/permissions";

const linkClass =
  "inline-flex min-h-10 items-center font-medium text-primary underline-offset-4 hover:underline";

function shopHref(key: PermissionKey) {
  return `/credits?category=permission#permission-${key}`;
}

function sourceLabel(permission: PermissionView, user: UserView) {
  switch (permission.source) {
    case "rank":
      return `Included in your ${user.rank?.name} rank`;
    case "staff":
      return "Staff";
    case "purchase":
      return permission.quantity === undefined
        ? "Purchased"
        : `${permission.quantity} ${permission.quantity === 1 ? "change" : "changes"} available`;
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
  return (
    <div id={id} className="scroll-mt-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{permission.label}</h2>
        <p className="text-xs text-pretty text-muted-foreground">
          {description}
        </p>
        {!permission.granted && (
          <p className="text-xs text-muted-foreground">
            Locked.{" "}
            <Link href={shopHref(permission.key)} className={linkClass}>
              Unlock it in the permissions shop
            </Link>
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
  const signatureText = (await liteBlocks("postImages"))
    ? stripMarkdownImages(user.signature ?? "")
    : (user.signature ?? "");

  return (
    <section id="permissions" className="scroll-mt-4 rounded-lg border bg-card">
      <div className="border-b p-4">
        <h1 className="text-xl font-bold tracking-tight">Permissions</h1>
        <p className="text-xs text-muted-foreground">
          What your account can do, and where each permission comes from.{" "}
          <Link href="/account" className={linkClass}>
            Edit your username and title
          </Link>
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
                  {permission.label}
                  {permission.granted ? (
                    <Badge variant="success">Granted</Badge>
                  ) : (
                    <Badge variant="secondary">Locked</Badge>
                  )}
                </p>
                <p className="text-xs text-pretty text-muted-foreground">
                  {permission.description}
                </p>
              </div>
              <p className="flex basis-full flex-wrap items-center gap-x-3 text-xs text-muted-foreground sm:basis-auto sm:justify-end">
                {permission.granted ? (
                  sourceLabel(permission, user)
                ) : (
                  <>
                    {price !== undefined && <Credits value={price} />}
                    <Link href={shopHref(permission.key)} className={linkClass}>
                      View in the shop
                      <span className="sr-only">: {permission.label}</span>
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
            description="Shown under your first post on each thread page and on your profile."
          >
            <SignatureForm
              key={signatureText}
              signature={signatureText}
              locked={!signature.granted}
              saved={saved === "signature"}
            />
          </Control>
        )}
      </div>
    </section>
  );
}
