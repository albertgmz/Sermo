import { postsByAuthorOp, threadsByAuthorOp } from "./authors";
import { threadsFeaturedOp } from "./features";
import { feedListOp, feedNewCountOp } from "./feed";
import { threadsRankedOp } from "./rankings";

export { refreshRankings, registerRankingJobs } from "./rankings";

export const operations = [
  feedListOp,
  feedNewCountOp,
  threadsRankedOp,
  threadsFeaturedOp,
  threadsByAuthorOp,
  postsByAuthorOp,
];
