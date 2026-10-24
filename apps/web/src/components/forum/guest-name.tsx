import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

// How a guest author is named wherever content shows its author: the name they gave and "Guest",
// or "Guest" alone when no name was kept (the account of a deleted member). Plain text: a guest
// has no profile to link and no card to open.
export function GuestName({
  name,
  className,
}: {
  name: string | null;
  className?: string;
}) {
  const t = useTranslations("forum.guestAuthor");
  return (
    <span className={cn("font-semibold", className)}>
      {name ? (
        <>
          {name}
          <span className="font-normal text-muted-foreground">
            {" "}
            · {t("label")}
          </span>
        </>
      ) : (
        t("label")
      )}
    </span>
  );
}
