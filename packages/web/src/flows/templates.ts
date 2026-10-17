import type { FlowGraph } from "@tachy/contract";

/**
 * Starting points for a helpdesk's flows. Each is an ordinary graph the
 * person edits before saving; the connection is left for them to pick.
 */
export interface FlowTemplate {
  key: string;
  name: string;
  hint: string;
  graph: FlowGraph;
}

const onNewTicket = {
  id: "new-ticket",
  kind: "item.synced" as const,
  params: { connection: "", events: ["created"] },
};

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: "draft-reply",
    name: "draft a reply",
    hint: "a suggested first answer as a private note",
    graph: {
      triggers: [onNewTicket],
      steps: [
        { id: "fetch", kind: "action", action: "item.fetch", params: {} },
        {
          id: "similar",
          kind: "action",
          action: "knowledge.search",
          params: { query: "{{item.title}}" },
        },
        {
          id: "draft",
          kind: "action",
          action: "agent.ask",
          params: {
            prompt:
              "Draft the first reply to the customer, in the language they wrote in. Use the similar cases only where they fit, and ask for what the thread lacks. Plain text, no greeting line.",
            material:
              "{{steps.fetch.text}}\n\nGuidance: {{steps.fetch.guidance}}\n\nSimilar cases:\n{{steps.similar.text}}",
          },
        },
        {
          id: "note",
          kind: "action",
          action: "item.post_note",
          params: {
            body: "Suggested reply from tachy, to review before sending:\n\n{{steps.draft.text}}",
            private: true,
          },
        },
      ],
    },
  },
  {
    key: "triage",
    name: "triage",
    hint: "the model picks a priority and sets it",
    graph: {
      triggers: [onNewTicket],
      steps: [
        { id: "fetch", kind: "action", action: "item.fetch", params: {} },
        {
          id: "classify",
          kind: "action",
          action: "agent.ask",
          params: {
            prompt:
              'Pick the ticket\'s priority: 1 low, 2 medium, 3 high, 4 urgent. Answer {"priority": n}.',
            material: "{{steps.fetch.text}}",
            answer: "json",
            tier: "cheap",
          },
        },
        {
          id: "priority",
          kind: "action",
          action: "item.set_field",
          params: {
            field: "priority",
            value: "{{steps.classify.json.priority}}",
          },
        },
      ],
    },
  },
  {
    key: "sla-watch",
    name: "SLA watch",
    hint: "tell the team before a first response is due",
    graph: {
      triggers: [
        {
          id: "every-15-min",
          kind: "schedule",
          params: {
            cron: "*/15 * * * *",
            connection: "",
            since_days: 3,
            max_items: 200,
          },
          where: {
            all: [
              {
                not: {
                  field: "item.raw.stats.first_responded_at",
                  op: "exists",
                },
              },
              { field: "item.raw.fr_due_by", op: "lt", value: "now+2h" },
            ],
          },
        },
      ],
      steps: [
        {
          id: "tell",
          kind: "action",
          action: "notify",
          params: {
            to: "team",
            title: "First response due: {{item.title}}",
            body: "#{{item.external_id}} is due by {{item.raw.fr_due_by}} and has no agent reply.",
          },
        },
      ],
    },
  },
  {
    key: "follow-linked",
    name: "follow linked ADO items",
    hint: "dev item changes come back as private notes",
    graph: {
      triggers: [
        {
          id: "synced",
          kind: "item.synced",
          params: { connection: "", events: ["created", "updated"] },
        },
      ],
      steps: [
        { id: "fetch", kind: "action", action: "item.fetch", params: {} },
        {
          id: "follow",
          kind: "action",
          action: "item.follow_linked",
          params: { note_back: true },
        },
      ],
    },
  },
];
