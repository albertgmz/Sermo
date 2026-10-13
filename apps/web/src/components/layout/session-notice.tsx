import { getTranslations } from "next-intl/server";
import { unconfirmedKind } from "@/lib/sermo/client";

// The one line the shell shows when the backend could not say who is asking: the page is drawn for
// a guest, though the visitor may not be one.
export async function SessionNotice() {
  const kind = await unconfirmedKind();
  if (!kind) return null;
  const t = await getTranslations("layout.sessionNotice");
  return (
    <p
      role="status"
      className="border-b bg-muted px-4 py-2 text-center text-sm text-muted-foreground"
    >
      {t(kind === "site" ? "unreachable" : "text")}
    </p>
  );
}
