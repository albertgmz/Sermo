import Link from "next/link";
import { useTranslations } from "next-intl";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import type { ActivityView, PlaceView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// Where each named place lives. A place the viewer may not see comes without a target and reads
// "Viewing a page".
const TARGETS = {
  forum: (id: number) => `/forums/${id}`,
  thread: (id: number) => `/threads/${id}`,
  member: (id: number) => `/members/${id}`,
} as const;

type Translate = ReturnType<typeof useTranslations<"forum.activity">>;

type Parts =
  | { key: `places.${Exclude<PlaceView["kind"], keyof typeof TARGETS>}` }
  | {
      key: `targets.${keyof typeof TARGETS}`;
      title: string;
      href: string;
    };

// The one reading of a place, for the line and for a plain-text title alike.
function partsOf(place: PlaceView): Parts {
  const { kind, target } = place;
  if (kind === "forum" || kind === "thread" || kind === "member")
    return target
      ? {
          key: `targets.${kind}`,
          title: target.title,
          href: TARGETS[kind](target.id),
        }
      : { key: "places.page" };
  return { key: `places.${kind}` };
}

// A place as plain text ("Viendo el tema «X»"), for a name's title tooltip.
export function placeText(t: Translate, place: PlaceView): string {
  const parts = partsOf(place);
  return "title" in parts
    ? t.markup(parts.key, { title: parts.title, link: (chunks) => chunks })
    : t(parts.key);
}

// What a visitor is viewing, as XenForo's `user_activity`: "Viendo el tema «X»", the title a
// link to it.
export function ActivityPlace({ place }: { place: PlaceView }) {
  const t = useTranslations("forum.activity");
  const parts = partsOf(place);
  if (!("title" in parts)) return t(parts.key);
  return t.rich(parts.key, {
    title: parts.title,
    link: (chunks) => (
      <Link
        href={parts.href}
        className="text-primary-ink [overflow-wrap:anywhere] hover:underline"
      >
        {chunks}
      </Link>
    ),
  });
}

// The "last seen" line wherever a member's activity is shown (the profile, the member card, the
// online page): when, then, within the last hour, where ("hace 5 minutos · Viendo el tema «X»");
// a member who hides their online status, seen by themselves or staff, is marked hidden.
export function ActivityLine({
  activity,
  className,
}: {
  activity: ActivityView;
  className?: string;
}) {
  const t = useTranslations("forum.activity");
  return (
    <span data-slot="activity-line" className={cn(className)}>
      <StaticRelativeTime date={activity.at} />
      {activity.place && (
        <>
          <span aria-hidden="true"> · </span>
          <ActivityPlace place={activity.place} />
        </>
      )}
      {activity.hidden && (
        <span data-slot="activity-hidden" className="text-muted-foreground">
          {" "}
          {t("hidden")}
        </span>
      )}
    </span>
  );
}
