import type { MEMBER_SORTS } from "@sermo/core/contracts";
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
import type { LeaderboardKind } from "@/components/forum/leaderboard";

export type MemberSort = (typeof MEMBER_SORTS)[number];

export type MembersView = {
  value: string;
  label: string;
  description: string;
  icon: LucideIcon;
  // Set on the views that are one ranking of all members: the sort the backend ranks by and how
  // the score is drawn.
  sort?: MemberSort;
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
    sort: "posts",
    ranking: "posts",
  },
  {
    value: "reactions",
    label: "reactionsLabel",
    description: "reactionsDescription",
    icon: Heart,
    sort: "reactions",
    ranking: "reactions",
  },
  {
    value: "awards",
    label: "awardsLabel",
    description: "awardsDescription",
    icon: Trophy,
    sort: "awards",
    ranking: "awards",
  },
  {
    value: "level",
    label: "levelLabel",
    description: "levelDescription",
    icon: TrendingUp,
    sort: "level",
    ranking: "xp",
  },
  {
    value: "credits",
    label: "creditsLabel",
    description: "creditsDescription",
    icon: Coins,
    sort: "credits",
    ranking: "credits",
  },
  {
    value: "referrals",
    label: "referralsLabel",
    description: "referralsDescription",
    icon: UserPlus,
    sort: "referrals",
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
