import { z } from "zod";
import { assertModelCallAllowed, defineFlowAction } from "@tachy/core/flows";
import { firstJsonObject, runAdvisory } from "./advisory";

const SYSTEM = `You are one step of an automated support flow in tachy. You get an
instruction and the material earlier steps gathered. Answer the instruction
only, from that material; say plainly when it does not hold the answer. Your
answer is read by the next step, not by a person in a chat.`;

/**
 * The model as a flow step. Lives here rather than in core because only this
 * package reaches a model; the processes that run flows register it at start.
 */
export function registerAgentFlowActions(): void {
  defineFlowAction({
    key: "agent.ask",
    title: "Ask tachy",
    description:
      "One prompt to the model, with the material you give it. Uses the flow owner's model credential.",
    category: "agent",
    writes: false,
    params: z.object({
      prompt: z
        .string()
        .min(1)
        .describe("What to do, e.g. summarise the thread for a developer."),
      material: z
        .string()
        .default("")
        .meta({ title: "context" })
        .describe("What it works from, e.g. {{steps.fetch.text}}."),
      answer: z
        .enum(["text", "json"])
        .default("text")
        .describe(
          "json asks for one JSON object, readable as steps.<id>.json.",
        ),
      tier: z
        .enum(["cheap", "caller"])
        .default("caller")
        .meta({ title: "model" })
        .describe("cheap for a quick yes or no, caller for the owner's model."),
    }),
    output: z.object({
      text: z.string(),
      json: z.record(z.string(), z.unknown()).nullable(),
    }),
    async run(ctx, p) {
      await assertModelCallAllowed(ctx.flowId);
      const text = await runAdvisory(
        {
          system:
            p.answer === "json"
              ? `${SYSTEM}\nAnswer with one JSON object and nothing else.`
              : SYSTEM,
          prompt: (scrub) =>
            p.material
              ? `${scrub(p.prompt)}\n\n---\n${scrub(p.material)}`
              : scrub(p.prompt),
          tier: p.tier,
          timeoutMs: 120_000,
          mode: "flow",
          meta: { flow_id: ctx.flowId, flow_run_id: ctx.flowRunId },
        },
        ctx.scope,
        ctx.userId,
      );
      if (text === null)
        throw new Error("the flow's owner has no model credential");
      if (text === "") throw new Error("the model call failed");
      return {
        text,
        json: p.answer === "json" ? firstJsonObject(text) : null,
      };
    },
  });
}
