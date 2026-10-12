// Member of the month: what a member did inside one calendar month (UTC).
export const POST_POINTS = 1;
export const REACTIONS_PER_POINT = 10;
export const REFERRAL_POINTS = 20;

export type Month = {
  year: number;
  // 1 to 12.
  month: number;
};

export type Activity = {
  posts: number;
  reactions: number;
  referrals: number;
};

export type Standing = Activity & {
  points: number;
};

export function standingPoints({ posts, reactions, referrals }: Activity) {
  const points =
    posts * POST_POINTS +
    reactions / REACTIONS_PER_POINT +
    referrals * REFERRAL_POINTS;
  return Math.round(points * 10) / 10;
}

// Most points first; ties go to more posts, then to the older account.
export function compareStanding(
  a: Standing & { user: { id: number } },
  b: Standing & { user: { id: number } },
) {
  return b.points - a.points || b.posts - a.posts || a.user.id - b.user.id;
}

export function monthOf(date: Date): Month {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function previousMonth({ year, month }: Month): Month {
  return month === 1
    ? { year: year - 1, month: 12 }
    : { year, month: month - 1 };
}

export function inMonth({ year, month }: Month, date: string) {
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const to = new Date(Date.UTC(year, month, 1)).toISOString();
  return date >= from && date < to;
}
