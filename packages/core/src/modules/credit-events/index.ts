import type { Ctx } from "../../context";
import * as contracts from "../../contracts/credits";
import { implement } from "../../operation";

/** Placeholder: this module is implemented in the next step of the economy work. */
const pending = (): never => {
  throw new Error("Not implemented.");
};

export const operations = [
  implement(contracts.creditRulesList, pending),
  implement(contracts.creditRulesCreate, pending),
  implement(contracts.creditRulesUpdate, pending),
  implement(contracts.creditRulesDelete, pending),
];

/** Registers the module's job handlers and event subscriber. */
export function registerCreditRuleJobs(_ctx: Ctx): void {}
