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
  "inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground";

// Props
//   tabs   The tabs of the bar.
//   more   Tabs that do not fit the bar: a menu at its end, named `moreLabel`, holds them.
export function TabLinks({
  tabs,
  active,
  label,
  variant = "underline",
  className,
  more,
  moreLabel,
}: {
  tabs: TabLink[];
  active: string;
  label: string;
  variant?: keyof typeof VARIANTS;
  className?: string;
  more?: TabLink[];
  moreLabel?: string;
}) {
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
          className={cn(TAB_CLASS, VARIANTS[variant].link)}
        >
          {tab.icon}
          {tab.label}
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
          className={cn(TAB_CLASS, VARIANTS[variant].link)}
        />
      )}
    </nav>
  );
}
