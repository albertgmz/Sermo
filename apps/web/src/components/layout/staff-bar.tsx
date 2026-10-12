import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Container } from "@/components/layout/container";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MODERATOR_LINKS = ["approvalQueue", "reports", "moderatorLog"] as const;

const ITEM =
  "inline-flex h-10 items-center gap-1 rounded-md px-2 font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-8";

type Standing = {
  permissions: { isModerator: boolean };
  resolvedPermissions: Record<string, boolean | number>;
};

// The viewer has staff work when the backend gives them any administration permission or makes
// them a moderator.
export function hasStaffWork({ permissions, resolvedPermissions }: Standing) {
  return (
    permissions.isModerator ||
    Object.entries(resolvedPermissions).some(
      ([id, value]) => id.startsWith("admin.") && value === true,
    )
  );
}

export function StaffBar({ admin }: { admin: boolean }) {
  const t = useTranslations("layout.staffBar");
  return (
    <div className="border-b bg-background text-xs text-muted-foreground">
      <Container className="flex items-center">
        <div className="-ml-2 flex items-center">
          <DropdownMenu>
            <DropdownMenuTrigger className={ITEM}>
              {t("moderator")}
              <ChevronDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-44">
              {MODERATOR_LINKS.map((label) => (
                <DropdownMenuItem key={label} className="min-h-10 md:min-h-8">
                  {t(`links.${label}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {admin && (
            <Link href="/admin" className={ITEM}>
              {t("admin")}
            </Link>
          )}
        </div>
      </Container>
    </div>
  );
}
