import type { FlowActionInfo } from "@tachy/contract";
import {
  describeFlowActions,
  getFlowAction,
  hasFlowAction,
  type FlowAction,
} from "./actions";
import { registerBuiltinFlowActions } from "./builtin";

/** The action library with core's own actions in it, however it was reached. */
export function flowActionCatalog(): FlowActionInfo[] {
  registerBuiltinFlowActions();
  return describeFlowActions();
}

export function flowAction(key: string): FlowAction {
  registerBuiltinFlowActions();
  return getFlowAction(key);
}

export function hasAction(key: string): boolean {
  registerBuiltinFlowActions();
  return hasFlowAction(key);
}
