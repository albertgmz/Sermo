import type { Ctx } from "../../context";
import * as contracts from "../../contracts/credits";
import { implement } from "../../operation";

/** Placeholder: this module is implemented in the next step of the economy work. */
const pending = (): never => {
  throw new Error("Not implemented.");
};

export const operations = [
  implement(contracts.creditsHistory, pending),
  implement(contracts.creditsLedger, pending),
  implement(contracts.creditsAdjust, pending),
  implement(contracts.creditsRecalculate, pending),
];

/** Registers the module's job handlers and event subscriber. */
export function registerCreditJobs(_ctx: Ctx): void {}
