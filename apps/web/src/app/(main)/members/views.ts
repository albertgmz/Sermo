import {
  Coins,
  Crown,
  Heart,
  LayoutGrid,
  type LucideIcon,
  MessageCircle,
  Shield,
  TrendingUp,
  Trophy,
  UserPlus,
  Users,
} from "lucide-react";
import type { LeaderboardKind } from "@/lib/db";

export type MembersView = {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  // Set on the views that are one ranking of all members.
  ranking?: LeaderboardKind;
};

export const VIEWS = [
  {
    value: "overview",
    label: "overviewLabel",
    description: "overviewDescription",
    icon: LayoutGrid,
  },
  {
    value: "month",
    label: "monthLabel",
    description: "monthDescription",
    icon: Crown,
  },
  {
    value: "posts",
    label: "postsLabel",
    description: "postsDescription",
    icon: MessageCircle,
    ranking: "posts",
  },
  {
    value: "reactions",
    label: "reactionsLabel",
    description: "reactionsDescription",
    icon: Heart,
    ranking: "reactions",
  },
  {
    value: "awards",
    label: "awardsLabel",
    description: "awardsDescription",
    icon: Trophy,
    ranking: "awards",
  },
  {
    value: "level",
    label: "levelLabel",
    description: "levelDescription",
    icon: TrendingUp,
    ranking: "xp",
  },
  {
    value: "credits",
    label: "creditsLabel",
    description: "creditsDescription",
    icon: Coins,
    ranking: "credits",
  },
  {
    value: "referrals",
    label: "referralsLabel",
    description: "referralsDescription",
    icon: UserPlus,
    ranking: "referrals",
  },
  {
    value: "staff",
    label: "staffLabel",
    description: "staffDescription",
    icon: Shield,
  },
  {
    value: "all",
    label: "allLabel",
    description: "allDescription",
    icon: Users,
  },
] as const satisfies readonly MembersView[];

export type ViewValue = (typeof VIEWS)[number]["value"];

// Views live in the query string: a path below /members is a username.
export function viewHref(view: ViewValue) {
  return view === "overview" ? "/members" : `/members?view=${view}`;
}
