import { group, sleep } from "k6";
import { SharedArray } from "k6/data";
import { json, META, OPS, pick, read, signIn, think, write } from "./lib.js";
import { handleSummary as summarize } from "./summary.js";

// Profile (env PROFILE): smoke, hundreds or thousands. PEAK_VUS overrides the peak of the last
// two. The visitors split into four kinds, each its own scenario.
const PROFILES = {
  smoke: { peak: 10, up: "5s", hold: "20s", down: "5s", pool: 6, pollSeconds: 18 },
  hundreds: { peak: 300, up: "1m", hold: "4m", down: "30s", pool: 40, pollSeconds: 60 },
  thousands: { peak: 1000, up: "3m", hold: "5m", down: "1m", pool: 60, pollSeconds: 60 },
};
const profile = PROFILES[__ENV.PROFILE || "smoke"];
if (!profile) throw new Error(`PROFILE must be one of ${Object.keys(PROFILES).join(", ")}`);
const peak = Number(__ENV.PEAK_VUS) || profile.peak;

// Share of the visitors in each scenario, and the function it runs. Posters are sized so that
// writes are a few percent of all requests (the report prints the measured share).
const KINDS = {
  guests: { share: 0.55, exec: "guests" },
  scrollers: { share: 0.2, exec: "scrollers" },
  pollers: { share: 0.18, exec: "pollers" },
  posters: { share: 0.07, exec: "posters" },
};

function scenarios() {
  const result = {};
  const others = Object.values(KINDS).slice(1);
  const taken = others.reduce((sum, kind) => sum + Math.max(1, Math.round(peak * kind.share)), 0);
  for (const [name, kind] of Object.entries(KINDS)) {
    // The guests, first in the list, take whatever the others leave of the peak.
    const target =
      kind === KINDS.guests
        ? Math.max(1, peak - taken)
        : Math.max(1, Math.round(peak * kind.share));
    result[name] = {
      executor: "ramping-vus",
      exec: kind.exec,
      startVUs: 0,
      stages: [
        { duration: profile.up, target },
        { duration: profile.hold, target },
        { duration: profile.down, target: 0 },
      ],
      gracefulRampDown: "30s",
    };
  }
  return result;
}

// A threshold that always passes makes k6 keep a sub-metric per operation for the report.
const thresholds = {
  "http_req_failed{kind:read}": ["rate<0.01"],
  "http_req_failed{kind:write}": ["rate<0.01"],
  "http_req_duration{kind:read}": ["p(95)<200"],
  "http_req_duration{kind:write}": ["p(95)<500"],
};
for (const op of OPS) thresholds[`http_req_duration{name:${op}}`] = ["max>=0"];

export const options = {
  scenarios: scenarios(),
  thresholds,
  setupTimeout: "30m",
  summaryTrendStats: ["avg", "med", "p(90)", "p(95)", "p(99)", "max", "count"],
  discardResponseBodies: false,
};

// The seed's meta JSON (next to the database): ids to visit and the shared password.
function list(name, pluck) {
  return new SharedArray(name, () => pluck(JSON.parse(open(META))));
}
const threadIds = list("threadIds", (m) => m.threadIds);
const bigThreadIds = list("bigThreadIds", (m) => m.bigThreadIds);
const forumIds = list("forumIds", (m) => m.bigForumIds);
const memberIds = list("memberIds", (m) => m.memberIds);
const terms = list("terms", (m) => [
  ...m.searchTerms.common,
  ...m.searchTerms.medium,
  ...m.searchTerms.rare,
]);
const conversationMembers = list("conversationMembers", (m) => m.conversationMembers);
const password = list("password", (m) => [m.password]);

/** One member per pool slot, each in a conversation they take part in, signed in once. */
export function setup() {
  const sessions = [];
  const seen = new Set();
  for (const [conversationId, userId] of conversationMembers) {
    if (sessions.length >= profile.pool) break;
    if (seen.has(userId)) continue;
    seen.add(userId);
    const cookie = signIn(userId, password[0]);
    if (cookie) sessions.push({ userId, conversationId, cookie });
    // Better Auth allows 3 sign-ins per address, and counts again only after 10 s without one; it
    // reads the address from the socket (the staging backend trusts no proxy header). So the pool
    // is signed in three at a time, with a pause after each three.
    if (seen.size % 3 === 0) sleep(10.5);
  }
  if (sessions.length === 0) throw new Error("no member could sign in");
  console.log(`signed in ${sessions.length} members`);
  return { sessions, startedAt: new Date().toISOString() };
}

function sessionOf(data) {
  return data.sessions[(__VU - 1) % data.sessions.length];
}

function threadOf() {
  return Math.random() < 0.8 ? pick(threadIds) : pick(bigThreadIds);
}

export function guests() {
  const roll = Math.random();
  if (roll < 0.3)
    group("guest home", () => {
      read("site.get", "/site");
      read("feed.list", "/feed", { limit: 20 });
    });
  else if (roll < 0.55)
    group("guest forum", () => {
      const forumId = pick(forumIds);
      read("nodes.list", "/nodes");
      read("nodes.get", `/nodes/${forumId}`);
      read("threads.list", `/nodes/${forumId}/threads`, { limit: 20 });
    });
  else if (roll < 0.85)
    group("guest thread", () => {
      const threadId = threadOf();
      read("threads.get", `/threads/${threadId}`);
      read("posts.list", `/threads/${threadId}/posts`, { page: 1, limit: 20 });
    });
  else if (roll < 0.93)
    group("guest profile", () => {
      read("profiles.get", `/users/${pick(memberIds)}`);
    });
  else
    group("guest search", () => {
      read("search.query", "/search", { q: pick(terms), limit: 20 });
    });
  think(2, 6);
}

export function scrollers(data) {
  const session = sessionOf(data);
  group("feed scroll", () => {
    let cursor;
    const scope = Math.random() < 0.8 ? "latest" : "hot";
    for (let page = 0; page < 9; page++) {
      const res = read("feed.list", "/feed", { scope, limit: 20, cursor }, session);
      cursor = json(res)?.nextCursor;
      if (!cursor) break;
      think(1, 3);
    }
  });
  think(3, 8);
}

export function pollers(data) {
  const session = sessionOf(data);
  const id = session.conversationId;
  let last;
  group("conversation open", () => {
    read("auth.counters", "/me/counters", null, session);
    read("conversations.list", "/conversations", { limit: 20 }, session);
    read("conversations.get", `/conversations/${id}`, null, session);
    const page = json(
      read(
        "conversations.listMessages",
        `/conversations/${id}/messages`,
        {
          order: "newest",
          limit: 30,
        },
        session,
      ),
    );
    last = page?.items?.[0]?.id;
  });
  // The web app's real intervals: messages every 3 s, the feed's new-post count every 30 s, the
  // header counters every 60 s.
  group("polling", () => {
    const rounds = Math.floor(profile.pollSeconds / 3);
    for (let round = 1; round <= rounds; round++) {
      think(3, 3);
      const page = json(
        read(
          "conversations.listMessages",
          `/conversations/${id}/messages`,
          {
            afterMessageId: last,
            limit: 30,
          },
          session,
        ),
      );
      const items = page?.items || [];
      if (items.length) last = items[items.length - 1].id;
      if (round % 10 === 0)
        read(
          "feed.newCount",
          "/feed/new-count",
          { scope: "latest", since: data.startedAt },
          session,
        );
      if (round % 20 === 0) read("auth.counters", "/me/counters", null, session);
    }
  });
}

let counter = 0;
function text(session, what) {
  counter += 1;
  return `Load test ${what} ${counter} from member ${session.userId} at ${Date.now()}. The forum is holding up.`;
}

export function posters(data) {
  const session = sessionOf(data);
  group("reply", () => {
    if (Math.random() < 0.4) {
      write(
        "conversations.reply",
        `/conversations/${session.conversationId}/messages`,
        {
          body: text(session, "message"),
          attachmentIds: [],
        },
        session,
      );
      return;
    }
    const threadId = threadOf();
    const thread = json(read("threads.get", `/threads/${threadId}`, null, session));
    read("posts.list", `/threads/${threadId}/posts`, { page: 1, limit: 20 }, session);
    // The page hides the reply box when the member cannot reply.
    if (thread?.permissions?.canReply === false) return;
    think(2, 4);
    write(
      "posts.create",
      `/threads/${threadId}/posts`,
      {
        body: text(session, "reply"),
        attachmentIds: [],
      },
      session,
    );
  });
  think(4, 8);
}

export const handleSummary = summarize;
