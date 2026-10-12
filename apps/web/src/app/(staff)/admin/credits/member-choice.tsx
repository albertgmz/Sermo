import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { memberNames } from "../logs/links";
import { MemberPicker } from "../permissions/member-picker";
import { one } from "./shared";

// The member a screen of this section works on, held in the address as `userId`: a search whose
// matches link back to the page with the member chosen, then the member's name with a link to
// choose another.
export async function MemberChoice({
  path,
  userId,
  params,
  heading,
}: {
  path: string;
  userId: number | null;
  params: Record<string, string | string[] | undefined>;
  heading: string;
}) {
  const t = await getTranslations("adminEconomy.member");
  if (userId !== null) {
    const name = await memberNames([userId]);
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
        <p className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">
          <span className="font-semibold">{heading}</span>{" "}
          {t("chosen", { name: name(userId) })}
        </p>
        <Link
          href={path}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-10 px-4",
          )}
        >
          {t("change")}
        </Link>
      </section>
    );
  }
  return (
    <MemberPicker
      query={one(params.userIdSearch) || undefined}
      name="userIdSearch"
      id="member-search"
      heading={heading}
      action={t("choose")}
      href={(id) => `${path}?userId=${id}`}
    />
  );
}
