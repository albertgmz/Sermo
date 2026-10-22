import Link from "next/link";
import { TabMore } from "@/components/forum/tab-more";
import { TabStripWithArrow } from "@/components/forum/tab-strip-arrow";
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
    // Labels stay on one line: tabs that do not fit the screen scroll sideways.
    nav: "w-full max-w-full gap-0.5 overflow-x-auto rounded-lg border bg-card p-[3px] [scrollbar-width:none] sm:w-fit",
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
//   arrow  A ">" over the bar's right end while tabs lie beyond it; a press scrolls the bar on.
export function TabLinks({
  tabs,
  active,
  label,
  variant = "underline",
  className,
  more,
  moreLabel,
  narrow = false,
  arrow = false,
}: {
  tabs: TabLink[];
  active: string;
  label: string;
  variant?: keyof typeof VARIANTS;
  className?: string;
  more?: TabLink[];
  moreLabel?: string;
  narrow?: boolean;
  arrow?: boolean;
}) {
  const tabClass = cn(TAB_CLASS, VARIANTS[variant].link, narrow && NARROW_TAB);
  const bar = (
    <nav
      aria-label={label}
      className={cn("flex", VARIANTS[variant].nav, className)}
    >
      {tabs.map((tab) => {
        const iconOnly = narrow && tab.value !== active;
        return (
          <Link
            key={tab.value}
            href={tab.href}
            scroll={false}
            aria-current={tab.value === active ? "page" : undefined}
            title={iconOnly ? tab.label : undefined}
            className={tabClass}
          >
            {tab.icon}
            {iconOnly ? (
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
        );
      })}
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
  if (!arrow) return bar;
  return <TabStripWithArrow>{bar}</TabStripWithArrow>;
}
