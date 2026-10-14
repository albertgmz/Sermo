"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { findRecipients } from "@/app/[locale]/(main)/conversations/actions";
import { Input } from "@/components/ui/input";

type Recipient = { id: number; username: string };

const TYPING_PAUSE_MS = 250;

// What the search found that can still be picked: not chosen yet, not excluded.
export function offered(
  found: Recipient[],
  chosen: Recipient[],
  exclude: number[],
): Recipient[] {
  return found.filter(
    (user) =>
      !exclude.includes(user.id) &&
      !chosen.some((entry) => entry.id === user.id),
  );
}

// Recipients are found by the start of their username as the visitor types; the backend answers
// with at most 25 and decides who is in the list. Members in `exclude` are never offered.
export function RecipientPicker({
  initial,
  exclude = [],
  onCount,
}: {
  initial?: Recipient;
  exclude?: number[];
  // Told how many are chosen, as it changes.
  onCount?: (count: number) => void;
}) {
  const t = useTranslations("conversations.recipientPicker");
  const [chosen, setChosen] = useState<Recipient[]>(initial ? [initial] : []);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Recipient[] | null>(null);

  useEffect(() => {
    const prefix = query.trim();
    if (!prefix) {
      setFound(null);
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      const items = await findRecipients(prefix);
      if (current) setFound(items);
    }, TYPING_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only a change of the count is told
  useEffect(() => onCount?.(chosen.length), [chosen.length]);

  const options = offered(found ?? [], chosen, exclude);

  function choose(user: Recipient) {
    setChosen((now) => [...now, user]);
    setQuery("");
    setFound(null);
  }

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">{t("label")}</legend>
      {chosen.length > 0 && (
        <ul aria-label={t("aria.chosen")} className="flex flex-wrap gap-2">
          {chosen.map((user) => (
            <li
              key={user.id}
              className="inline-flex h-10 items-center rounded-md border bg-muted/40 pl-3 text-sm"
            >
              <input type="hidden" name="recipientIds" value={user.id} />
              <span className="max-w-40 truncate">{user.username}</span>
              <button
                type="button"
                aria-label={t("aria.remove", { name: user.username })}
                onClick={() =>
                  setChosen((now) =>
                    now.filter((entry) => entry.id !== user.id),
                  )
                }
                className="flex size-10 items-center justify-center text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        type="search"
        value={query}
        autoComplete="off"
        placeholder={t("placeholder")}
        aria-label={t("aria.search")}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (options[0]) choose(options[0]);
        }}
        className="h-10 md:h-8"
      />
      {found !== null &&
        (options.length > 0 ? (
          <ul className="max-h-60 divide-y overflow-y-auto rounded-md border bg-card">
            {options.map((user) => (
              <li key={user.id}>
                <button
                  type="button"
                  onClick={() => choose(user)}
                  className="flex min-h-10 w-full items-center px-3 text-left text-sm hover:bg-muted/50"
                >
                  {user.username}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t("noMatch")}
          </p>
        ))}
    </fieldset>
  );
}
