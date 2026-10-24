import { z } from "zod";
import { getCustomerName } from "@tachy/core/catalog";
import {
  applyIngest,
  assertModelCallAllowed,
  defineFlowAction,
  flowName,
  ingestConfig,
} from "@tachy/core/flows";
import { badInput } from "@tachy/core/infra";
import { resolveSource } from "@tachy/core/sources";
import {
  fileLinker,
  ingestWorkItem,
  priorSummaryIds,
  renderSummaryHtml,
  renderSummaryText,
  replaceNotes,
  transcriptOnTicket,
} from "@tachy/core/work-items";
import { firstJsonObject, runAdvisory } from "./advisory";
import { summarizeTicket } from "./ticket-summary";

const SYSTEM = `You are one step of an automated support flow in tachy. You get an
instruction and the material earlier steps gathered. Answer the instruction
only, from that material; say plainly when it does not hold the answer. Your
answer is read by the next step, not by a person in a chat. Answer in English
unless the instruction asks for another language.`;

/**
 * The model as a flow step. Lives here rather than in core because only this
 * package reaches a model; the processes that run flows register it at start.
 */
export function registerAgentFlowActions(): void {
  defineFlowAction({
    key: "agent.ask",
    title: "ask tachy",
    description:
      "one prompt to the model, with the material you give it. uses the flow owner's model credential",
    category: "agent",
    writes: false,
    params: z.object({
      prompt: z
        .string()
        .min(1)
        .describe("what to do, e.g. summarise the thread for a developer"),
      material: z
        .string()
        .default("")
        .meta({ title: "context" })
        .describe("what it works from, e.g. {{steps.fetch.text}}"),
      answer: z
        .enum(["text", "json"])
        .default("text")
        .describe("json asks for one JSON object, readable as steps.<id>.json"),
      tier: z
        .enum(["cheap", "caller"])
        .default("caller")
        .meta({ title: "model" })
        .describe("cheap for a quick yes or no, caller for the owner's model"),
    }),
    output: z.object({
      text: z.string(),
      json: z.record(z.string(), z.unknown()).nullable(),
    }),
    async run(ctx, params) {
      await assertModelCallAllowed(ctx.flowId);
      const text = await runAdvisory(
        {
          system:
            params.answer === "json"
              ? `${SYSTEM}\nAnswer with one JSON object and nothing else.`
              : SYSTEM,
          prompt: (scrub) =>
            params.material
              ? `${scrub(params.prompt)}\n\n---\n${scrub(params.material)}`
              : scrub(params.prompt),
          tier: params.tier,
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
        json: params.answer === "json" ? firstJsonObject(text) : null,
      };
    },
  });

  defineFlowAction({
    key: "agent.summarize_item",
    title: "summarise ticket",
    description:
      "reads the ticket fresh, writes a summary (problem, status, timeline, what was tried) and posts it as a private note, replacing the previous summary. uses the flow owner's model credential",
    category: "agent",
    writes: true,
    params: z.object({
      post: z
        .boolean()
        .default(true)
        .describe("off keeps the summary in the run, as steps.<id>.text"),
    }),
    output: z.object({
      text: z.string(),
      posted: z.boolean(),
      replaced: z.number(),
    }),
    async run(ctx, params) {
      if (!ctx.item) throw badInput("this step needs an item to work on");
      await assertModelCallAllowed(ctx.flowId);
      const { external_id, connection, source_type } = ctx.item;
      const { conn, source } = await resolveSource(connection, ctx.scope);
      if (params.post && !source.postNote)
        throw badInput(`${source_type} items cannot take notes`);
      const raw = await source.fetchItem(external_id);
      const { customerId } = await ingestWorkItem(conn.id, raw);
      const { item, guidance } = applyIngest(
        raw,
        ingestConfig(conn.config),
        source.modelOmits,
      );
      const summary = await summarizeTicket(item, ctx.scope, ctx.userId, {
        mode: "flow",
        guidance,
        meta: { flow_id: ctx.flowId, flow_run_id: ctx.flowRunId },
      });
      const text = renderSummaryText(summary);
      if (!params.post) return { text, posted: false, replaced: 0 };
      const flow = await flowName(ctx.flowId);
      const note = renderSummaryHtml(
        { external_id, title: raw.title },
        summary,
        {
          linkOf: fileLinker(raw, {
            source: connection,
            // Only a source that opens files has something for the link to open.
            origin: source.openAttachment
              ? process.env.TACHY_PUBLIC_ORIGIN
              : undefined,
          }),
          customer: await getCustomerName(customerId),
          requestedBy: flow ? `Flow: ${flow}` : undefined,
          transcript: transcriptOnTicket(raw.messages),
        },
      );
      const posted = await replaceNotes(
        source,
        external_id,
        [note],
        priorSummaryIds(raw.messages),
      );
      return { text, posted: true, replaced: posted.replaced_previous ?? 0 };
    },
  });
}
