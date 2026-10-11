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
    label: "Overview",
    description: "The people who make this community.",
    icon: LayoutGrid,
  },
  {
    value: "month",
    label: "Member of the month",
    description: "Who earned the most points in the last complete month.",
    icon: Crown,
  },
  {
    value: "posts",
    label: "Most posts",
    description: "Every member, ranked by the posts they have written.",
    icon: MessageCircle,
    ranking: "posts",
  },
  {
    value: "reactions",
    label: "Most reactions",
    description: "Every member, ranked by the reactions they have received.",
    icon: Heart,
    ranking: "reactions",
  },
  {
    value: "awards",
    label: "Most awards",
    description: "Every member, ranked by the awards they hold.",
    icon: Trophy,
    ranking: "awards",
  },
  {
    value: "level",
    label: "Highest level",
    description: "Every member, ranked by level and XP.",
    icon: TrendingUp,
    ranking: "xp",
  },
  {
    value: "credits",
    label: "Most credits",
    description: "Every member, ranked by the credits they hold.",
    icon: Coins,
    ranking: "credits",
  },
  {
    value: "referrals",
    label: "Most referrals",
    description: "Every member, ranked by the members they have invited.",
    icon: UserPlus,
    ranking: "referrals",
  },
  {
    value: "staff",
    label: "Staff",
    description: "The team that looks after the community.",
    icon: Shield,
  },
  {
    value: "all",
    label: "Registered members",
    description: "The full directory, with search.",
    icon: Users,
  },
] as const satisfies readonly MembersView[];

export type ViewValue = (typeof VIEWS)[number]["value"];

// Views live in the query string: a path below /members is a username.
export function viewHref(view: ViewValue) {
  return view === "overview" ? "/members" : `/members?view=${view}`;
}
