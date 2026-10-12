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
import type { User } from "@/lib/types";

const MODERATOR_LINKS = ["approvalQueue", "reports", "moderatorLog"] as const;

const ITEM =
  "inline-flex h-10 items-center gap-1 rounded-md px-2 font-medium outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:h-8";

export function StaffBar({ user }: { user: Pick<User, "role"> | null }) {
  const t = useTranslations("layout.staffBar");
  if (!user || user.role === "member") return null;
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
          {user.role === "admin" && (
            <Link href="/admin" className={ITEM}>
              {t("admin")}
            </Link>
          )}
        </div>
      </Container>
    </div>
  );
}
