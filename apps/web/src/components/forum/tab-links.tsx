import Link from "next/link";
import { TabMore } from "@/components/forum/tab-more";
import { cn } from "@/lib/utils";

export type TabLink = {
  value: string;
  label: string;
  href: string;
  icon?: React.ReactNode;
  count?: number;
};

const VARIANTS = {
  underline: {
    nav: "overflow-x-auto border-b [scrollbar-width:none]",
    link: "h-11 border-b-2 border-transparent px-3 aria-[current=page]:border-primary",
  },
  segmented: {
    nav: "w-full gap-0.5 rounded-lg border bg-card p-[3px] sm:w-fit",
    link: "h-10 flex-1 justify-center rounded-md px-3 aria-[current=page]:bg-muted sm:flex-none md:h-7 md:px-2.5 md:text-(length:--text-control-sm)",
  },
  plain: {
    nav: "overflow-x-auto [scrollbar-width:none]",
    link: "h-10 px-2",
  },
};

// A tab's look, the same for a link of the bar and the menu button at its end.
const TAB_CLASS =
  "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

// A narrow tab: tighter below `sm`, and the frame of the label it hides there (`sr-only` is
// positioned).
const NARROW_TAB = "relative max-sm:px-2.5";

// Props
//   tabs   The tabs of the bar.
//   more   Tabs that do not fit the bar: a menu at its end, named `moreLabel`, holds them.
//   narrow Below `sm` every tab but the open one, and the menu button, shows only its icon.
export function TabLinks({
  tabs,
  active,
  label,
  variant = "underline",
  className,
  more,
  moreLabel,
  narrow = false,
}: {
  tabs: TabLink[];
  active: string;
  label: string;
  variant?: keyof typeof VARIANTS;
  className?: string;
  more?: TabLink[];
  moreLabel?: string;
  narrow?: boolean;
}) {
  const tabClass = cn(TAB_CLASS, VARIANTS[variant].link, narrow && NARROW_TAB);
  return (
    <nav
      aria-label={label}
      className={cn("flex", VARIANTS[variant].nav, className)}
    >
      {tabs.map((tab) => (
        <Link
          key={tab.value}
          href={tab.href}
          scroll={false}
          aria-current={tab.value === active ? "page" : undefined}
          className={tabClass}
        >
          {tab.icon}
          {narrow && tab.value !== active ? (
            <span className="max-sm:sr-only">{tab.label}</span>
          ) : (
            tab.label
          )}
          {tab.count !== undefined && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {tab.count}
            </span>
          )}
        </Link>
      ))}
      {more && more.length > 0 && moreLabel && (
        <TabMore
          tabs={more}
          label={moreLabel}
          className={tabClass}
          narrow={narrow}
        />
      )}
    </nav>
  );
}
