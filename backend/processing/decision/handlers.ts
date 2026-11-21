import type { DecideEvent, DecideResult, Deps, InvokeContext, SqsBatchResponse, SqsEvent } from "./types.js";

export interface Handlers {
  decide(event: DecideEvent, ctx: InvokeContext): Promise<DecideResult>;
  routeOnly(event: SqsEvent, ctx: InvokeContext): Promise<SqsBatchResponse>;
  /** Lambda entry point: SQS events go to routeOnly, anything else to decide. */
  handler(event: DecideEvent | SqsEvent, ctx: InvokeContext): Promise<DecideResult | SqsBatchResponse>;
}

export function createHandlers(deps: Deps): Handlers {
  void deps;
  const decide: Handlers["decide"] = async () => {
    throw new Error("decide: not implemented");
  };
  const routeOnly: Handlers["routeOnly"] = async () => {
    throw new Error("routeOnly: not implemented");
  };
  const handler: Handlers["handler"] = (event, ctx) =>
    "Records" in event ? routeOnly(event, ctx) : decide(event, ctx);
  return { decide, routeOnly, handler };
}
