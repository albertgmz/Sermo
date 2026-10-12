import Link from "next/link";
import { useTranslations } from "next-intl";
import { canOpen, type Standing, screenByKey } from "@/app/(staff)/registry";
import { Container } from "@/components/layout/container";

const ITEM =
  "inline-flex h-10 items-center rounded-md px-2 font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-8";

// What the staff bar links to for this viewer: the panel when the backend says there is anything
// in it for them, and the moderation landing when they may open a moderation screen.
export function staffLinks(viewer: Standing) {
  return {
    admin: viewer.staff.panel,
    moderation: canOpen(viewer, screenByKey("moderationHome")),
  };
}

export function StaffBar({
  admin,
  moderation,
}: {
  admin: boolean;
  moderation: boolean;
}) {
  const t = useTranslations("layout.staffBar");
  return (
    <div className="border-b bg-background text-xs text-muted-foreground">
      <Container className="flex items-center">
        <div className="-ml-2 flex items-center">
          {admin && (
            <Link href="/admin" className={ITEM}>
              {t("admin")}
            </Link>
          )}
          {moderation && (
            <Link href="/moderation" className={ITEM}>
              {t("moderation")}
            </Link>
          )}
        </div>
      </Container>
    </div>
  );
}
