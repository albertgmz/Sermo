import { useTranslations } from "next-intl";
import { BANNER_HEADER_HEIGHT } from "@/components/forum/banner-size";
import { EDITOR_BOX, editorMinHeight } from "@/components/forum/composer-box";
import { COMPOSER_PAGE_CLASS } from "@/components/forum/composer-page";
import { Container } from "@/components/layout/container";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function LoadingRegion({
  children,
  label,
}: {
  children: React.ReactNode;
  label?: string;
}) {
  const t = useTranslations("skeletons.skeletons");
  return (
    <>
      <output aria-live="polite" className="sr-only">
        {label === undefined ? t("aria.loading") : label}
      </output>
      {children}
    </>
  );
}

export function ThreadRowSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex items-center gap-3 px-3 py-2.5 md:px-4"
    >
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-8 w-8 sm:h-4 sm:w-32" />
      <Skeleton className="hidden h-3 w-52 md:block" />
    </div>
  );
}

export function MemberRowSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex items-center gap-3 px-4 py-2.5", className)}
    >
      <Skeleton className="size-10 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    </div>
  );
}

export function StatTileSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="size-4" />
      </div>
      <Skeleton className="mt-3 h-7 w-16" />
    </div>
  );
}

export function CardSkeleton({
  described = false,
  banner = false,
  children,
}: {
  // The header carries a second line under the title.
  described?: boolean;
  // The header is as tall as one with a picture behind it.
  banner?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card"
    >
      <div
        className={cn(
          "flex items-center border-b px-4 py-2",
          banner ? BANNER_HEADER_HEIGHT : "min-h-12",
        )}
      >
        {described ? (
          <div>
            <div className="flex h-5 items-center">
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-24" />
            </div>
          </div>
        ) : (
          <Skeleton className="h-4 w-32" />
        )}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}

export function TextSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

export function PostSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 p-3 md:gap-x-4 md:p-4"
    >
      <Skeleton className="size-10 rounded-full md:row-span-2 md:size-16" />
      <div className="flex min-h-10 flex-col justify-center gap-2">
        <Skeleton className="h-4 w-36 max-w-full" />
        <Skeleton className="h-3 w-48 max-w-full" />
      </div>
      <div className="col-span-2 min-w-0 md:col-span-1 md:col-start-2">
        <div className="flex h-10 items-center md:h-7">
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="md:mt-1">
          <TextSkeleton />
        </div>
        <div className="mt-2 flex h-10 items-center justify-end gap-2 md:h-7">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-16" />
        </div>
      </div>
    </div>
  );
}

export function FormRowSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <Skeleton className="h-3.5 w-24" />
      <Skeleton className="h-10 w-full md:h-8" />
    </div>
  );
}

// The editor's box as it looks at rest (`composer-box.ts`, `editor-toolbar.tsx`): the bar's band
// with three of its segments, and the text's room, so nothing moves or changes colour when the
// page arrives. The editor and its least height come from the same module.
export function EditorSkeleton({
  minHeight = editorMinHeight(false),
}: {
  minHeight?: number;
}) {
  return (
    <div aria-hidden="true" className={cn("overflow-hidden", EDITOR_BOX)}>
      <div className="flex gap-[3px] rounded-t-[inherit] border-b bg-border p-1.5">
        {[
          ["text", "w-24"],
          ["insert", "w-24"],
          ["misc", "flex-1"],
        ].map(([group, width]) => (
          <div
            key={group}
            className={cn("h-[42px] rounded-[9px] border bg-card", width)}
          />
        ))}
      </div>
      {/* Empty, as the box is before anything is written in it (the skeleton's own fill is the
          muted one in the dark theme, the box's). */}
      <div style={{ minHeight }} />
    </div>
  );
}

// The composer of a thread as a page: close, the forum chip, the title row, the editor's box and
// the bottom row.
export function ComposerSkeleton() {
  return (
    <div aria-hidden="true" className={COMPOSER_PAGE_CLASS}>
      <div className="flex items-center justify-between border-b p-2">
        <Skeleton className="size-10" />
        <Skeleton className="h-10 w-20 rounded-full" />
      </div>
      <div className="flex-1 space-y-3 p-3 md:p-4">
        <Skeleton className="h-10 w-44 rounded-full" />
        <Skeleton className="h-11 w-full rounded-[9px] md:h-12" />
        <Skeleton className="h-64 w-full rounded-[9px]" />
      </div>
      <div className="flex items-center gap-2 border-t p-2">
        <Skeleton className="size-10" />
        <Skeleton className="h-10 w-40" />
      </div>
    </div>
  );
}

export function TabsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex h-11 items-center gap-3 overflow-hidden border-b"
    >
      <Skeleton className="h-5 w-20 shrink-0" />
      <Skeleton className="h-5 w-20 shrink-0" />
      <Skeleton className="h-5 w-20 shrink-0" />
    </div>
  );
}

export function HeadingSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex h-10 items-center md:h-8">
        <Skeleton className="h-3 w-48 max-w-full" />
      </div>
      <Skeleton className="mt-1 h-8 w-2/3" />
    </div>
  );
}

export function MemberListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <CardSkeleton>
      {Array.from({ length: rows }, (_, index) => `member-${index}`).map(
        (key) => (
          <MemberRowSkeleton key={key} />
        ),
      )}
    </CardSkeleton>
  );
}

export function FeedSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-(--page-gap)">
      {[1, 2, 3].map((item) => (
        <div key={item} className="overflow-hidden rounded-lg border bg-card">
          <MemberRowSkeleton />
          <div className="px-4 pb-4">
            <TextSkeleton />
          </div>
          <div className="flex h-11 items-center justify-end gap-2 border-t px-4">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <>
      <CardSkeleton>
        <div className="space-y-3 p-4">
          <TextSkeleton />
          <Skeleton className="h-10 w-full" />
        </div>
      </CardSkeleton>
      <MemberListSkeleton />
      <MemberListSkeleton />
    </>
  );
}

// The ten rows of a forum statistics tab: the starter's avatar and the title.
export function ForumStatsRowsSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((row) => (
        <div key={row} className="flex min-h-8 items-center gap-2 px-2 py-1">
          <Skeleton className="size-6 shrink-0 rounded-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

export function ForumStatsSkeleton() {
  return (
    <CardSkeleton>
      <TabsSkeleton />
      <ForumStatsRowsSkeleton />
    </CardSkeleton>
  );
}

export function ForumCategoriesSkeleton() {
  return (
    <>
      {[1, 2].map((category) => (
        <CardSkeleton key={category} banner>
          <div className="grid gap-2 p-2 md:grid-cols-2">
            {[1, 2, 3, 4].map((forum) => (
              <div key={forum} className="space-y-3 rounded-md border p-3">
                <div className="flex gap-3">
                  <Skeleton className="size-10 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
                <Skeleton className="h-3 w-1/2" />
                <div className="border-t pt-3">
                  <Skeleton className="h-3 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </CardSkeleton>
      ))}
    </>
  );
}

export function ProfileHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="relative">
      <Skeleton className="absolute inset-x-0 top-0 h-36 rounded-none md:h-56" />
      <Container className="relative pt-20 md:pt-44">
        <Skeleton className="size-24 rounded-full ring-4 ring-background" />
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="min-w-0 space-y-2">
            <div className="flex h-10 items-center">
              <Skeleton className="h-7 w-44" />
            </div>
            <Skeleton className="h-4 w-52 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg border bg-card p-3 lg:flex lg:shrink-0 lg:gap-6 lg:border-0 lg:bg-transparent lg:p-0">
            {[1, 2, 3, 4, 5, 6].map((stat) => (
              <div key={stat} className="space-y-1">
                <Skeleton className="h-5 w-12" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>
      </Container>
    </div>
  );
}

export function AccountHeaderSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex min-h-40 flex-wrap items-end gap-4 rounded-lg border bg-card p-4 sm:min-h-48 sm:p-6"
    >
      <Skeleton className="size-16 rounded-full" />
      <div className="min-w-0 flex-1 basis-36 space-y-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Skeleton className="h-10 w-28" />
    </div>
  );
}

// The member of the month: stacked on a phone, in a row from sm.
export function MonthHeroSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-lg border bg-card p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="flex h-4 items-center">
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="mt-5 flex flex-col items-center gap-4 sm:flex-row sm:gap-5">
        <Skeleton className="size-24 shrink-0 rounded-full" />
        <div className="flex flex-col items-center sm:items-start">
          <div className="flex h-10 items-center">
            <Skeleton className="h-7 w-40" />
          </div>
          <div className="flex h-5 items-center">
            <Skeleton className="h-3.5 w-32" />
          </div>
          <div className="mt-3 flex h-5 items-center">
            <Skeleton className="h-4 w-12" />
          </div>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[1, 2, 3, 4].map((tile) => (
          <div key={tile} className="rounded-md border p-3">
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-2/3" />
            </div>
            <div className="mt-1 flex h-6.25 items-center">
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex justify-end">
        <Skeleton className="h-8 w-24" />
      </div>
    </div>
  );
}

const STANDING_LINES = {
  leader: ["h-6", "h-4"],
  plain: ["h-5", "h-4"],
  compact: ["h-4", "h-5"],
};

// One row of a standing: the leader is taller, a compact row has a caption
// above the name and no rank.
function StandingRowSkeleton({
  variant,
}: {
  variant: keyof typeof STANDING_LINES;
}) {
  const compact = variant === "compact";
  return (
    <div
      className={cn(
        "flex items-center gap-3 px-4 py-2.5",
        variant === "leader" && "py-4",
      )}
    >
      {!compact && <Skeleton className="h-4 w-5 shrink-0" />}
      <Skeleton
        className={cn("shrink-0 rounded-full", compact ? "size-8" : "size-10")}
      />
      <div className="min-w-0 flex-1">
        {STANDING_LINES[variant].map((height, line) => (
          <div key={height} className={cn("flex items-center", height)}>
            <Skeleton className={cn("h-3", line === 0 ? "w-1/2" : "w-2/3")} />
          </div>
        ))}
      </div>
      <Skeleton className="h-5 w-12 shrink-0" />
    </div>
  );
}

// This month's race next to the past winners.
export function RaceWinnersSkeleton() {
  return (
    <div className="grid gap-3 md:grid-cols-2 md:items-start">
      <CardSkeleton described>
        <StandingRowSkeleton variant="leader" />
        <StandingRowSkeleton variant="plain" />
        <StandingRowSkeleton variant="plain" />
      </CardSkeleton>
      <CardSkeleton>
        {[1, 2, 3].map((row) => (
          <StandingRowSkeleton key={row} variant="compact" />
        ))}
      </CardSkeleton>
    </div>
  );
}

const PODIUM_PLACES = [
  { column: "col-start-2", avatar: "size-16", step: "h-8" },
  { column: "col-start-1", avatar: "size-10", step: "h-6" },
  { column: "col-start-3", avatar: "size-10", step: "h-5" },
];

// The body of a podium panel: three places, then two list rows.
export function PodiumSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y divide-border">
      <div className="grid grid-cols-3 items-end gap-1 px-3 pt-2">
        {PODIUM_PLACES.map(({ column, avatar, step }) => (
          <div
            key={column}
            className={cn(
              "row-start-1 flex min-w-0 flex-col items-center px-1 pt-2",
              column,
            )}
          >
            <Skeleton className={cn("rounded-full", avatar)} />
            <div className="mt-1 flex h-5 w-full items-center justify-center">
              <Skeleton className="h-3 w-3/4" />
            </div>
            <div className="flex min-h-5 w-full items-center justify-center">
              <Skeleton className="h-3 w-8" />
            </div>
            <Skeleton
              className={cn("mt-1 w-full rounded-t-md rounded-b-none", step)}
            />
          </div>
        ))}
      </div>
      <div className="divide-y divide-border">
        {[4, 5].map((rank) => (
          <div key={rank} className="flex h-10 items-center gap-2 px-3">
            <Skeleton className="h-3 w-5 shrink-0" />
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <Skeleton className="h-3 w-1/3 flex-1" />
            <Skeleton className="h-3 w-8 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function StaffRowsSkeleton() {
  return (
    <>
      {[1, 2].map((row) => (
        <MemberRowSkeleton key={row} className="py-2" />
      ))}
    </>
  );
}

export function NewestMembersSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-wrap gap-2 px-4 py-3">
      {[1, 2, 3, 4, 5, 6].map((member) => (
        <Skeleton key={member} className="size-10 rounded-full" />
      ))}
    </div>
  );
}

// Stands in for the common case, a row or two of members.
export function BirthdaysSkeleton() {
  return <MemberRowSkeleton className="py-2" />;
}

export function MembersOverviewSkeleton() {
  const t = useTranslations("skeletons.skeletons");
  return (
    <>
      <MonthHeroSkeleton />
      <RaceWinnersSkeleton />
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("notableHeading")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((card) => (
            <CardSkeleton key={card}>
              <PodiumSkeleton />
            </CardSkeleton>
          ))}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {t("communityHeading")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <CardSkeleton>
            <StaffRowsSkeleton />
          </CardSkeleton>
          <div className="grid gap-3">
            <CardSkeleton>
              <NewestMembersSkeleton />
              <div className="space-y-2 px-4 py-3">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-10 w-full md:h-8" />
              </div>
            </CardSkeleton>
            <CardSkeleton>
              <BirthdaysSkeleton />
            </CardSkeleton>
          </div>
        </div>
      </section>
    </>
  );
}

export function MemberCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 pt-8"
    >
      <div className="flex items-end gap-5">
        <Skeleton className="size-16 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
        </div>
      </div>
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="mt-auto grid grid-cols-3 gap-2 border-t pt-3">
        {[1, 2, 3].map((stat) => (
          <div key={stat}>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-full" />
            </div>
            <div className="flex h-4 items-center">
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export function CatalogueSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-6">
      {[1, 2, 3].map((group) => (
        <div key={group} className="space-y-3">
          <div className="border-b pb-2">
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[1, 2, 3, 4].map((item) => (
              <div
                key={item}
                className="flex gap-3 rounded-lg border bg-card p-4"
              >
                <Skeleton className="size-12 shrink-0" />
                <div className="min-w-0 flex-1 space-y-3">
                  <Skeleton className="h-5 w-2/3" />
                  <TextSkeleton />
                  <Skeleton className="h-5 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ConversationListSkeleton() {
  return (
    <div aria-hidden="true" className="divide-y">
      {[1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="flex min-h-16 items-center gap-3 px-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function BalanceSkeleton() {
  return (
    <div aria-hidden="true" className="rounded-lg border bg-card p-4 md:p-6">
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-3 h-12 w-36" />
      <Skeleton className="mt-2 h-5 w-48 max-w-full" />
    </div>
  );
}

// The shop as `credits/shop.tsx` lays it out: the category chips, the category blurb and a grid
// of cards (picture, name, description, effect, price, button).
export function ShopSkeleton({ items = 6 }: { items?: number }) {
  return (
    <div aria-hidden="true" className="space-y-4">
      <div className="flex h-10 gap-2 overflow-hidden">
        {[1, 2, 3, 4].map((chip) => (
          <Skeleton key={chip} className="h-10 w-28 shrink-0" />
        ))}
      </div>
      <div className="flex h-5 items-center">
        <Skeleton className="h-3.5 w-2/3 max-w-prose" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: items }, (_, index) => index).map((item) => (
          <div
            key={item}
            className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card"
          >
            <div className="aspect-video border-b" />
            <div className="flex flex-1 flex-col gap-3 p-3">
              <div className="flex-1 space-y-0.5">
                <div className="flex h-5 items-center">
                  <Skeleton className="h-4 w-2/3" />
                </div>
                <TextSkeleton />
              </div>
              <div className="flex h-6 items-center">
                <Skeleton className="h-5 w-16" />
              </div>
              <div>
                <Skeleton className="h-10 w-full" />
                <div className="mt-1.5 h-4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
