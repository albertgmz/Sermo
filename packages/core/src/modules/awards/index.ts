import type { Ctx } from "../../context";
import * as contracts from "../../contracts/awards";
import { implement } from "../../operation";

/** Placeholder: this module is implemented in the next step of the economy work. */
const pending = (): never => {
  throw new Error("Not implemented.");
};

export const operations = [
  implement(contracts.awardsList, pending),
  implement(contracts.awardsGet, pending),
  implement(contracts.awardsHolders, pending),
  implement(contracts.awardsCriteria, pending),
  implement(contracts.awardsCreate, pending),
  implement(contracts.awardsUpdate, pending),
  implement(contracts.awardsDelete, pending),
  implement(contracts.awardsRun, pending),
  implement(contracts.awardsGrant, pending),
  implement(contracts.awardsRevoke, pending),
  implement(contracts.awardsMember, pending),
  implement(contracts.awardsMemberGrants, pending),
];

/** Registers the module's job handlers and event subscriber. */
export function registerAwardJobs(_ctx: Ctx): void {}
