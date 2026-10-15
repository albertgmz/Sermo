import { postsByAuthorOp, threadsByAuthorOp } from "./authors";
import { feedListOp, feedNewCountOp } from "./feed";
import { threadsRankedOp } from "./rankings";

export { refreshRankings, registerRankingJobs } from "./rankings";

export const operations = [
  feedListOp,
  feedNewCountOp,
  threadsRankedOp,
  threadsByAuthorOp,
  postsByAuthorOp,
];
