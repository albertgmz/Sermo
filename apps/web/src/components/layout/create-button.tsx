"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type CreateVariant,
  TriggerContent,
  triggerClass,
} from "@/components/layout/create-trigger";
import { LazyPopup } from "@/components/ui/lazy-popup";

// The dialog (Base UI, the chooser, the forum list, the composer and the editor behind it) is
// fetched when the button is first reached for.
const loadPopup = () => import("@/components/layout/create-popup");

// The one entry point for writing something new: a discussion, a question, a poll or quiz, or a wall
// post. For a member it opens the dialog; for a guest it is a link to sign in, which comes back to
// the page it was pressed on.
export function CreateButton({
  variant,
  member,
}: {
  variant: CreateVariant;
  member: boolean;
}) {
  const t = useTranslations("layout.createButton");
  const pathname = usePathname();
  const label = t("label");
  if (!member) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(pathname)}`}
        aria-label={label}
        className={triggerClass(variant)}
      >
        <TriggerContent variant={variant} label={label} />
      </Link>
    );
  }
  return (
    <LazyPopup
      load={loadPopup}
      popup={{ variant, label }}
      trigger={(lazy) => (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label={label}
          className={triggerClass(variant)}
          {...lazy}
        >
          <TriggerContent variant={variant} label={label} />
        </button>
      )}
    />
  );
}
