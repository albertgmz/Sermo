// The built-in groups come with English names and titles (the migrations wrote them); an
// administrator may rename any of them. The panel shows them in the visitor's language while the
// stored text is still the one the migrations wrote, and the stored text itself is never changed.
// `lib.builtinGroups` holds the words, one per default below.

const DEFAULTS = {
  guest: { title: "Guest" },
  registered: { title: "Member", userTitle: "Member" },
  moderator: { title: "Moderator", userTitle: "Moderator" },
  admin: { title: "Administrator", userTitle: "Administrator" },
  unconfirmed: {
    title: "Unconfirmed",
    userTitle: "Awaiting confirmation",
    description: "Members who have not confirmed their email address.",
  },
} as const;

type Field = "title" | "userTitle" | "description";

export type BuiltinGroupKey =
  | "guest.title"
  | "registered.title"
  | "registered.userTitle"
  | "moderator.title"
  | "moderator.userTitle"
  | "admin.title"
  | "admin.userTitle"
  | "unconfirmed.title"
  | "unconfirmed.userTitle"
  | "unconfirmed.description";

// A method signature, so a translator typed by its own keys fits (a function type would not).
export type BuiltinGroupWords = {
  words(key: BuiltinGroupKey): string;
}["words"];

type Named = {
  builtin: string | null;
  title: string;
  userTitle: string;
  description: string;
};

function defaultOf(builtin: string | null, field: Field): string | undefined {
  if (builtin === null || !Object.hasOwn(DEFAULTS, builtin)) return undefined;
  const defaults: Partial<Record<Field, string>> =
    DEFAULTS[builtin as keyof typeof DEFAULTS];
  return defaults[field];
}

// The group with its default English text in the visitor's language. Text an administrator
// changed, and every group that is not built in, stays as stored.
export function inVisitorsLanguage<T extends Named>(
  group: T,
  words: BuiltinGroupWords,
): T {
  const word = (field: Field): string => {
    const stored = group[field];
    return stored !== "" && stored === defaultOf(group.builtin, field)
      ? words(`${group.builtin}.${field}` as BuiltinGroupKey)
      : stored;
  };
  return {
    ...group,
    title: word("title"),
    userTitle: word("userTitle"),
    description: word("description"),
  };
}
