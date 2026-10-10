import { describe, expect, it } from "vitest";

import {
  compactMessages,
  normalizeBody,
  parseMailDate,
  splitQuotedBlocks,
  splitPrologue,
  renderCompactScript,
  renderCompactNotes,
  summarizeCompaction,
  normalizeAttachments,
  formatBytes,
  compactForLlm,
  COMPACT_MIN_CHARS,
  TRANSCRIPT_MARKER,
  SUMMARY_MARKER,
} from "@tachy/core/work-items";
import { type RawMessage, type RawWorkItem } from "@tachy/core/sources";

const message = (
  over: Partial<RawMessage> & { bodyText: string },
): RawMessage => ({
  visibility: "public",
  direction: "incoming",
  createdAt: "2026-06-20T10:00:00Z",
  ...over,
});

const meta = {
  externalId: "42",
  title: "Report T&T",
  opened: "2026-06-16T08:00:00Z",
  updated: "2026-08-10T17:00:00Z",
};

describe("normalizeBody", () => {
  it("restores paragraph breaks from freshdesk space runs", () => {
    expect(normalizeBody("one     two")).toBe("one\n\ntwo");
  });

  it("drops image placeholders and mailto decorations", () => {
    const normalized = normalizeBody(
      "Hola [cid:abc-1] Javier<mailto:j@x.com> [Image]",
    );
    expect(normalized).not.toContain("cid:");
    expect(normalized).not.toContain("mailto:");
    expect(normalized).not.toContain("[Image]");
    expect(normalized).toContain("Javier");
  });

  it("unwraps corporate link rewriters back to the real target", () => {
    const wrapped =
      "see https://secure-web.cisco.com/abc123/https%3A%2F%2Fpreprod.osapiens.cloud%2Fcapture%2F now";
    expect(normalizeBody(wrapped)).toContain(
      "https://preprod.osapiens.cloud/capture/",
    );
    const safe =
      "go https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fdocs.example.com%2Fa&data=x";
    expect(normalizeBody(safe)).toContain("https://docs.example.com/a");
  });
});

describe("parseMailDate", () => {
  it("reads spanish outlook dates", () => {
    const parsed = parseMailDate("jueves, 18 de junio de 2026 18:10");
    expect(parsed?.toISOString()).toBe("2026-06-18T18:10:00.000Z");
  });

  it("reads german and numeric dates", () => {
    expect(parseMailDate("18. Juni 2026 09:05")?.getUTCMonth()).toBe(5);
    expect(parseMailDate("18/06/2026")?.getUTCDate()).toBe(18);
  });

  it("returns null for unparseable input", () => {
    expect(parseMailDate("sometime last week")).toBeNull();
    expect(parseMailDate(undefined)).toBeNull();
  });
});

describe("splitQuotedBlocks", () => {
  it("separates live text from each quoted hop and attributes it", () => {
    const body = [
      "Hemos recibido el fichero.",
      "",
      "________________________________",
      "De: Miguel Angel PONCE ALCANTARA <maponce@logista.com>",
      "Enviado: jueves, 18 de junio de 2026 18:10",
      "Para: Javier <j@t.com>",
      "Asunto: RE: EPCIS",
      "",
      "Buenas tardes Javier",
    ].join("\n");
    const blocks = splitQuotedBlocks(body);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].quoted).toBe(false);
    expect(blocks[0].text).toContain("Hemos recibido");
    expect(blocks[1].quoted).toBe(true);
    expect(blocks[1].from).toContain("Miguel Angel");
    expect(blocks[1].when?.toISOString()).toBe("2026-06-18T18:10:00.000Z");
    expect(blocks[1].text.trim()).toBe("Buenas tardes Javier");
  });

  it("handles the 'wrote:' attribution style", () => {
    const blocks = splitQuotedBlocks(
      "Gracias\n\nEl 18 de junio de 2026 18:10, Ana escribió:\n\nHola",
    );
    expect(blocks[1].quoted).toBe(true);
    expect(blocks[1].from).toContain("Ana");
  });

  it("splits plain-text '>' quoting and attributes it", () => {
    const body = [
      "Confirming we still see the error.",
      "",
      "> 7 авг. 2026 г., в 12:50, Alex Turuk <alex@quokka.global> написал(а):",
      ">",
      "> We had a communication with Bulgarian partners again",
      "> They referred to a missing MID",
    ].join("\n");
    const blocks = splitQuotedBlocks(body);
    expect(blocks[0].quoted).toBe(false);
    expect(blocks[0].text).toContain("Confirming we still see");
    const quoted = blocks.filter((b) => b.quoted);
    expect(quoted.length).toBeGreaterThan(0);
    const text = quoted.map((b) => b.text).join("\n");
    expect(text).toContain("Bulgarian partners");
    expect(text).toContain("missing MID");
    expect(text).not.toMatch(/^>/m);
    expect(quoted.some((b) => (b.from ?? "").includes("Alex Turuk"))).toBe(
      true,
    );
  });

  it("handles non-English 'wrote:' attributions", () => {
    for (const line of [
      "Le 7 août 2026 à 12:50, Ana a écrit :",
      "Em 7 de agosto de 2026, Ana escreveu:",
      "7 авг. 2026 г., в 12:50, Ana написал(а):",
    ]) {
      const blocks = splitQuotedBlocks(`nuevo texto\n\n${line}\n\nhistoria`);
      expect(blocks.some((b) => b.quoted)).toBe(true);
    }
  });

  it("does not treat a lone colon line as a quote header", () => {
    const blocks = splitQuotedBlocks("Estado: abierto\n\nseguimos revisando");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].quoted).toBe(false);
  });
});

describe("compactMessages", () => {
  it("keeps the first copy of a repeated block and drops the rest", () => {
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          bodyText: "El proceso rechaza los UIDs cargados hoy",
        }),
        message({
          externalId: "2",
          bodyText: "El proceso rechaza los UIDs cargados hoy",
        }),
        message({ externalId: "3", bodyText: "Confirmamos que ya funciona" }),
      ],
      meta,
    );
    expect(compacted.turns).toHaveLength(2);
    expect(compacted.compaction.dropped.exact_duplicate_blocks).toBe(1);
    expect(compacted.turns[0].text).toContain("rechaza los UIDs");
    expect(compacted.turns[1].text).toContain("ya funciona");
  });

  it("drops automated mail unless asked to keep it", () => {
    const messages = [
      message({
        externalId: "1",
        bodyText: "Tenemos un problema con el fichero",
      }),
      message({
        externalId: "2",
        automated: true,
        bodyText:
          "this is a friendly reminder that we have not received a response",
      }),
    ];
    expect(compactMessages(messages, meta).turns).toHaveLength(1);
    expect(compactMessages(messages, meta).compaction.dropped.automated).toBe(
      1,
    );
    expect(
      compactMessages(messages, meta, { keepAutomated: true }).turns,
    ).toHaveLength(2);
  });

  it("drops short out-of-office replies", () => {
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          bodyText: "Podéis revisar el envío de ayer?",
        }),
        message({
          externalId: "2",
          bodyText: "Estaré fuera de la oficina hasta el 31 de julio.",
        }),
      ],
      meta,
    );
    expect(compacted.turns).toHaveLength(1);
    expect(compacted.compaction.dropped.auto_reply).toBe(1);
  });

  it("strips banners, legal footers and repeated signature lines", () => {
    const footer = [
      "",
      "Advertencia: Este correo es de un remitente externo.",
      "CONFIDENTIALITY. This e-mail and any attachments are confidential.",
      "Javier Baños | IS Project Manager | : +34 629 56 38 07",
    ].join("\n");
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          bodyText: "Primer punto del analisis" + footer,
        }),
        message({
          externalId: "2",
          bodyText: "Segundo punto del analisis" + footer,
        }),
        message({
          externalId: "3",
          bodyText: "Tercer punto del analisis" + footer,
        }),
      ],
      meta,
    );
    const all = compacted.turns.map((t) => t.text).join("\n");
    expect(all).toContain("Primer punto");
    expect(all).toContain("Tercer punto");
    expect(all).not.toContain("remitente externo");
    expect(all).not.toContain("CONFIDENTIALITY");
    expect(all).not.toContain("629 56 38 07");
  });

  it("keeps the original of text that later mails quote back repeatedly", () => {
    const original =
      "Mañana vamos a realizar unas cargas de UIDs al repositorio";
    const compacted = compactMessages(
      [
        message({ externalId: "1", bodyText: original }),
        ...[2, 3, 4, 5].map((i) =>
          message({
            externalId: String(i),
            bodyText: [
              `Respuesta numero ${i} sobre el asunto`,
              "",
              "________________________________",
              "De: Javier <j@t.com>",
              "Para: soporte <s@o.com>",
              "",
              original,
            ].join("\n"),
          }),
        ),
      ],
      meta,
    );
    const all = compacted.turns.map((t) => t.text);
    expect(all[0]).toBe(original);
    expect(all.filter((t) => t.includes("cargas de UIDs"))).toHaveLength(1);
  });

  it("keeps every field of a pasted JSON payload, even when a near-copy came first", () => {
    const payload = (market: string, qty: number) =>
      [
        "Here is today's request",
        "",
        "[",
        "  {",
        '    "Code": "SVCR_3cd3efb9_0",',
        '    "EO_ID": "QCBDR+1DE651605",',
        `    "Intended_Market": "${market}",`,
        '    "Message_Type": "ISU",',
        `    "Req_Quantity": ${qty},`,
        '    "P_Brand": "MUSTH"',
        "  }",
        "]",
      ].join("\n");
    const compacted = compactMessages(
      [
        message({ externalId: "1", bodyText: payload("BG", 240) }),
        message({ externalId: "2", bodyText: payload("RO", 500) }),
      ],
      meta,
    );
    const all = compacted.turns.map((t) => t.text).join("\n");
    const fields = [
      "Code",
      "EO_ID",
      "Intended_Market",
      "Message_Type",
      "Req_Quantity",
      "P_Brand",
    ];
    // both payloads must survive whole: they differ in one field
    for (const field of fields)
      expect(all.match(new RegExp(`"${field}":`, "g"))).toHaveLength(2);
    expect(all).toContain('"Intended_Market": "BG"');
    expect(all).toContain('"Intended_Market": "RO"');
    expect(all).toContain('"Req_Quantity": 500');
  });

  it("does not shred indentation into paragraph breaks", () => {
    const code = "function f() {\n    const a = 1;\n    return a;\n}";
    expect(normalizeBody(code)).toBe(code);
  });

  it("drops an identical repeated payload but never a differing one", () => {
    const payload = ["{", '  "a": 1,', '  "b": 2,', '  "c": 3', "}"].join("\n");
    const compacted = compactMessages(
      [
        message({ externalId: "1", bodyText: payload }),
        message({ externalId: "2", bodyText: payload }),
      ],
      meta,
    );
    expect(compacted.turns).toHaveLength(1);
    expect(compacted.compaction.dropped.exact_duplicate_blocks).toBe(1);
  });

  it("skips a transcript it posted itself instead of compacting its own output", () => {
    const prior = renderCompactNotes(
      compactMessages(
        [message({ externalId: "1", bodyText: "the real issue" })],
        meta,
      ),
    )[0].replace(/<[^>]+>/g, " ");
    const compacted = compactMessages(
      [
        message({ externalId: "1", bodyText: "the real issue" }),
        message({ externalId: "2", visibility: "private", bodyText: prior }),
      ],
      meta,
    );
    expect(compacted.compaction.dropped.prior_transcript).toBe(1);
    expect(compacted.turns).toHaveLength(1);
    expect(compacted.turns[0].text).toBe("the real issue");
  });

  it("removes repeated tracking links but keeps one-off urls", () => {
    const messages = Array.from({ length: 6 }, (_, i) =>
      message({
        externalId: String(i),
        bodyText: `Punto numero ${i} del seguimiento <https://track.example/T0kq9fg0>`,
      }),
    );
    messages.push(
      message({
        externalId: "x",
        bodyText: "El endpoint es <https://preprod.osapiens.cloud/capture/>",
      }),
    );
    const all = compactMessages(messages, meta)
      .turns.map((t) => t.text)
      .join("\n");
    expect(all).not.toContain("track.example");
    expect(all).toContain("https://preprod.osapiens.cloud/capture/");
  });

  it("recovers quoted-only content attributed to its real sender and date", () => {
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          authorLabel: "javier@t.com",
          createdAt: "2026-06-22T06:50:00Z",
          bodyText: [
            "Hemos recibido el fichero.",
            "",
            "________________________________",
            "De: Alejandro Plaza <ap@osapiens.com>",
            "Enviado: 16 de diciembre de 2025 09:00",
            "Para: Javier <j@t.com>",
            "",
            "Muchos de los codigos no son reconocidos por el repositorio",
          ].join("\n"),
        }),
      ],
      meta,
    );
    const quoted = compacted.turns.find((t) => t.kind === "quoted")!;
    expect(quoted.speaker).toBe("Alejandro Plaza");
    expect(quoted.at).toBe("2025-12-16T09:00:00.000Z");
    expect(quoted.text).toContain("no son reconocidos");

    const { prologue, thread } = splitPrologue(compacted);
    expect(prologue.map((t) => t.speaker)).toEqual(["Alejandro Plaza"]);
    expect(thread.every((t) => t.kind !== "quoted")).toBe(true);
  });

  it("labels internal notes and falls back when no sender is known", () => {
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          visibility: "private",
          direction: "outgoing",
          authorLabel: "Borja Martinez",
          bodyText: "THEY ARE SENDING THE MESSAGES WITH WRONG EOID",
        }),
        message({
          externalId: "2",
          direction: "outgoing",
          bodyText: "Buenas tardes Javier",
        }),
      ],
      meta,
    );
    expect(compacted.turns[0]).toMatchObject({
      kind: "internal_note",
      speaker: "Borja Martinez",
      source_message: "1",
    });
    expect(compacted.turns[1]).toMatchObject({
      kind: "reply",
      speaker: "support",
    });
    expect(compacted.speakers).toEqual(["Borja Martinez", "support"]);
  });

  it("reports honest counters on an empty thread", () => {
    const compacted = compactMessages([], meta);
    expect(compacted.turns).toEqual([]);
    expect(compacted.compaction).toMatchObject({
      source_messages: 0,
      turns: 0,
      raw_chars: 0,
      compact_chars: 0,
    });
  });
});

describe("attachments", () => {
  const files = [
    {
      id: 1,
      name: "xml-bad-soap.xml",
      content_type: "application/xml",
      size: 67658,
    },
    { id: 2, name: "notes.txt", content_type: "text/plain", size: 900 },
  ];

  it("normalizes freshdesk, jira and junk shapes alike", () => {
    expect(normalizeAttachments(files)).toEqual([
      { name: "xml-bad-soap.xml", size: 67658, type: "application/xml" },
      { name: "notes.txt", size: 900, type: "text/plain" },
    ]);
    expect(
      normalizeAttachments([
        { filename: "screen.png", mimeType: "image/png", size: 2048 },
      ]),
    ).toEqual([{ name: "screen.png", size: 2048, type: "image/png" }]);
    expect(normalizeAttachments([{ id: 3 }, null, "x", 7])).toEqual([]);
    expect(normalizeAttachments(undefined)).toEqual([]);
  });

  it("formats sizes at human scale", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(67658)).toBe("66 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });

  it("hangs files off the message's own turn, never its quoted hops", () => {
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          attachments: files,
          bodyText: [
            "Adjunto el XML con el error",
            "",
            "De: Ana <a@x.com>",
            "Para: soporte <s@o.com>",
            "",
            "texto citado anterior",
          ].join("\n"),
        }),
      ],
      meta,
    );
    const own = compacted.turns.find((t) => t.kind !== "quoted")!;
    expect(own.attachments?.map((a) => a.name)).toEqual([
      "xml-bad-soap.xml",
      "notes.txt",
    ]);
    for (const quoted of compacted.turns.filter((t) => t.kind === "quoted"))
      expect(quoted.attachments).toBeUndefined();
    expect(compacted.compaction.attachments).toBe(2);
  });

  it("keeps file references when the message text is itself a duplicate", () => {
    const compacted = compactMessages(
      [
        message({ externalId: "1", bodyText: "aqui va el fichero" }),
        message({
          externalId: "2",
          bodyText: "aqui va el fichero",
          attachments: files,
        }),
      ],
      meta,
    );
    // the duplicate wording is dropped, but the file must not vanish with it
    expect(compacted.compaction.attachments).toBe(2);
    expect(
      compacted.turns.flatMap((t) => t.attachments ?? []).map((a) => a.name),
    ).toContain("xml-bad-soap.xml");
  });

  it("renders files in both the script and the note", () => {
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          attachments: files,
          bodyText: "adjunto va",
        }),
      ],
      meta,
    );
    expect(renderCompactScript(compacted)).toContain(
      "↳ files: xml-bad-soap.xml (66 KB, application/xml); notes.txt (900 B, text/plain)",
    );
    const [html] = renderCompactNotes(compacted);
    expect(html).toContain("xml-bad-soap.xml (66 KB, application/xml)");
    expect(summarizeCompaction(compacted).files).toBe(
      "2 files referenced by name - open them on the ticket.",
    );
  });

  it("marks where an image was instead of deleting it", () => {
    expect(normalizeBody("mira esto [cid:abc-1] y dime")).toBe(
      "mira esto [image] y dime",
    );
    expect(normalizeBody("firma [cid:a] [cid:b] [cid:c] [Image]")).toBe(
      "firma [image]",
    );
    expect(
      normalizeBody(
        "ver https://attachment.freshdesk.com/inline/attachment?token=xyz aqui",
      ),
    ).toBe("ver [image] aqui");
  });
});

describe("compactForLlm (ingest-path rule)", () => {
  const item = (messages: RawMessage[]): RawWorkItem => ({
    externalId: "42",
    kind: "ticket",
    title: "T",
    raw: {},
    sourceCreatedAt: meta.opened,
    sourceUpdatedAt: meta.updated,
    messages,
  });

  it("leaves a short ticket byte-for-byte alone", () => {
    const i = item([
      message({ externalId: "1", bodyText: "algo corto pero real" }),
    ]);
    const forLlm = compactForLlm(i);
    expect(forLlm.compacted).toBeUndefined();
    expect(forLlm.item).toBe(i);
  });

  it("leaves a long ticket alone when there is nothing to gain", () => {
    // distinct paragraphs, no quoting or repetition: compaction cannot help
    const i = item(
      Array.from({ length: 6 }, (_, n) =>
        message({
          externalId: String(n),
          bodyText: Array.from(
            { length: 40 },
            (_, p) =>
              `Mensaje ${n} parrafo ${p}: observacion unica sobre el incidente numero ${n * 40 + p}.`,
          ).join("\n\n"),
        }),
      ),
    );
    expect(
      i.messages.reduce((a, m) => a + m.bodyText.length, 0),
    ).toBeGreaterThan(COMPACT_MIN_CHARS);
    expect(compactForLlm(i).compacted).toBeUndefined();
  });

  it("compacts a long repetitive ticket and empties messages", () => {
    const quoted = [
      "",
      "De: Ana <a@x.com>",
      "Para: soporte <s@o.com>",
      "",
      "El proceso rechaza los UIDs cargados hoy y no sabemos por que motivo exacto. ".repeat(
        30,
      ),
    ].join("\n");
    const i = item(
      Array.from({ length: 8 }, (_, n) =>
        message({
          externalId: String(n),
          bodyText: `Respuesta ${n}.${quoted}`,
        }),
      ),
    );
    const forLlm = compactForLlm(i);
    expect(forLlm.compacted).toBeDefined();
    expect(forLlm.item.messages).toEqual([]);
    expect(forLlm.item.title).toBe("T");
    expect(forLlm.compacted!.turns.length).toBeGreaterThan(0);
  });
});

describe("summarizeCompaction", () => {
  const build = (bodies: string[]) =>
    compactMessages(
      bodies.map((bodyText, i) => message({ externalId: String(i), bodyText })),
      meta,
    );

  it("speaks in reading effort, not internal vocabulary", () => {
    const summary = summarizeCompaction(build(["algo pasa con el fichero"]));
    expect(summary.headline).toMatch(
      /^1 messages · \d+ KB to read instead of \d+ KB \(\d+% less\)$/,
    );
    expect(
      `${summary.headline} ${summary.removed} ${summary.recovered}`,
    ).not.toMatch(/turns?|blocks?|boilerplate|near-duplicate/i);
  });

  it("names only what it actually removed", () => {
    const summary = summarizeCompaction(
      build(["mismo texto repetido", "mismo texto repetido"]),
    );
    expect(summary.removed).toContain("1 repeated quote");
    expect(summary.removed).not.toContain("automated");
    expect(summary.removed).not.toContain("0 ");
    expect(summary.recovered).toBe("");
  });

  it("reports recovered history as the find that it is", () => {
    const compacted = compactMessages(
      [
        message({
          externalId: "1",
          bodyText: [
            "Seguimos igual",
            "",
            "De: Alejandro <ap@o.com>",
            "Enviado: 16 de diciembre de 2025 09:00",
            "",
            "los codigos no son reconocidos",
          ].join("\n"),
        }),
      ],
      meta,
    );
    expect(compacted.compaction.recovered_earlier).toBe(1);
    expect(summarizeCompaction(compacted).recovered).toBe(
      "Recovered 1 older message that survive only inside quoted replies.",
    );
  });
});

describe("replacing a previous transcript", () => {
  it("reports the ids of transcripts it posted before", () => {
    const prior = renderCompactNotes(
      compactMessages(
        [message({ externalId: "1", bodyText: "el problema real" })],
        meta,
      ),
    )[0].replace(/<[^>]+>/g, " ");
    const compacted = compactMessages(
      [
        message({ externalId: "1", bodyText: "el problema real" }),
        message({
          externalId: "note-9",
          visibility: "private",
          bodyText: prior,
        }),
      ],
      meta,
    );
    expect(compacted.prior_transcript_ids).toEqual(["note-9"]);
  });

  it("claims nothing to replace on a ticket it has never touched", () => {
    const compacted = compactMessages(
      [message({ externalId: "1", bodyText: "hola" })],
      meta,
    );
    expect(compacted.prior_transcript_ids).toEqual([]);
  });
});

describe("renderers", () => {
  const compacted = compactMessages(
    [
      message({
        externalId: "1",
        authorLabel: "javier@t.com",
        bodyText: [
          "Seguimos con el problema del fichero",
          "",
          "________________________________",
          "De: Alejandro Plaza <ap@osapiens.com>",
          "Enviado: 16 de diciembre de 2025 09:00",
          "Para: Javier <j@t.com>",
          "",
          "Los codigos no son reconocidos por el repositorio",
        ].join("\n"),
      }),
    ],
    meta,
  );

  it("renders the script with a prologue section", () => {
    const script = renderCompactScript(compacted);
    expect(script).toContain("# Report T&T   [#42]");
    expect(script).toContain(
      "Earlier mail, recovered from quoted replies - 1 message",
    );
    expect(script).toContain("Alejandro Plaza (2025-12-16):");
    expect(script).toContain("javier@t.com (2026-06-20)");
  });

  it("escapes html in the note body", () => {
    const recompacted = compactMessages(
      [
        message({
          externalId: "1",
          bodyText: "el bloque <epc>0108435</epc> falla",
        }),
      ],
      meta,
    );
    const [html] = renderCompactNotes(recompacted);
    expect(html).toContain("&lt;epc&gt;0108435&lt;/epc&gt;");
    expect(html).not.toContain("<epc>");
    expect(html).toContain("nothing was summarised or reworded");
  });

  it("gives each turn its own card, under a header with the figures", () => {
    const [html] = renderCompactNotes(compacted);
    expect(html).toContain(
      "<strong>Compacted transcript</strong> - Report T&amp;T",
    );
    expect(html).toContain(">messages</span>");
    expect(html.match(/border-left:3px solid/g)).toHaveLength(
      compacted.turns.length,
    );
    expect(html).toContain("Earlier mail, recovered from quoted replies");
    expect(html).toContain("The ticket thread");
    expect(html).toContain(TRANSCRIPT_MARKER);
  });

  it("badges an internal note and a quoted turn in the thread", () => {
    const [html] = renderCompactNotes(
      compactMessages(
        [
          message({ externalId: "1", bodyText: "no imprime la linea 3" }),
          message({
            externalId: "2",
            visibility: "private",
            direction: "outgoing",
            bodyText: "revisado con desarrollo, es el spooler",
          }),
        ],
        meta,
      ),
    );
    expect(html).toMatch(/text-transform:uppercase">internal<\/span>/);
    expect(html).toContain("background:#fff8e6");
  });

  it("keeps the structure inside a turn: lists, links and pasted payloads", () => {
    const [html] = renderCompactNotes(
      compactMessages(
        [
          message({
            externalId: "1",
            bodyText: [
              "Pasos para reproducir:",
              "- abrir el lote",
              "- pulsar imprimir",
              "",
              "1. primero",
              "2. segundo",
              "",
              "ver https://example.invalid/a?b=1&c=2.",
              "",
              "{",
              '"batch": 3,',
              '"state": "stalled"',
              "}",
            ].join("\n"),
          }),
        ],
        meta,
      ),
    );
    expect(html).toContain(
      "<li>abrir el lote</li><li>pulsar imprimir</li></ul>",
    );
    expect(html).toContain("<li>primero</li><li>segundo</li></ol>");
    expect(html).toContain(
      '<a href="https://example.invalid/a?b=1&amp;c=2">https://example.invalid/a?b=1&amp;c=2</a>.',
    );
    expect(html).toMatch(/<pre [^>]*>\{\n&quot;batch&quot;: 3,/);
  });

  it("posts one note when the transcript fits, and cuts between cards when not", () => {
    expect(renderCompactNotes(compacted)).toHaveLength(1);
    const parts = renderCompactNotes(compacted, 900);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain("part 1/");
    for (const part of parts) {
      expect(part.startsWith("<div>")).toBe(true);
      expect(part.endsWith("</div>")).toBe(true);
      expect(part.match(/<div/g)).toHaveLength(part.match(/<\/div>/g)!.length);
    }
  });
});

describe("a split transcript identifies itself", () => {
  const long = compactMessages(
    [
      message({
        externalId: "1",
        bodyText: Array.from(
          { length: 300 },
          (_, i) => `linea ${i} ${"y".repeat(300)}`,
        ).join("\n\n"),
      }),
    ],
    meta,
  );

  it("cuts one very long turn into continued cards that fit a note", () => {
    const parts = renderCompactNotes(long, 20000);
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) {
      expect(part).toContain(TRANSCRIPT_MARKER);
      expect(part.length).toBeLessThan(25000);
    }
    expect(parts[1]).toContain(">continued</span>");
    expect(parts.join("")).toContain("linea 299");
  });

  it("recognises every part it posted back on the next fetch", () => {
    const parts = renderCompactNotes(long, 20000);

    // Each part comes back as its own private note. All of them must be
    // recognised, or the next run compacts its own output and replace_previous
    // deletes part 1 while orphaning the rest.
    const again = compactMessages(
      [
        message({ externalId: "1", bodyText: "el problema real" }),
        ...parts.map((body, i) =>
          message({
            externalId: `note-${i}`,
            visibility: "private",
            bodyText: body.replace(/<[^>]+>/g, " "),
          }),
        ),
      ],
      meta,
    );
    expect(again.compaction.dropped.prior_transcript).toBe(parts.length);
    expect(again.prior_transcript_ids).toEqual(
      parts.map((_, i) => `note-${i}`),
    );
  });

  it("still recognises a transcript in the layout it posted before", () => {
    const again = compactMessages(
      [
        message({ externalId: "1", bodyText: "el problema real" }),
        message({
          externalId: "old-note",
          visibility: "private",
          bodyText:
            "Compacted transcript - Report T&T [#42] 3 messages. Generated by tachy",
        }),
      ],
      meta,
    );
    expect(again.prior_transcript_ids).toEqual(["old-note"]);
  });
});

describe("a summary note on the ticket", () => {
  it("is left out of the transcript and is not the compactor's to replace", () => {
    const compacted = compactMessages(
      [
        message({ externalId: "1", bodyText: "el problema real" }),
        message({
          externalId: "summary-1",
          visibility: "private",
          bodyText: `Summary - Report T&T Problem ... Generated by tachy ${SUMMARY_MARKER}`,
        }),
      ],
      meta,
    );
    expect(compacted.turns).toHaveLength(1);
    expect(compacted.compaction.dropped.prior_summary).toBe(1);
    expect(compacted.prior_transcript_ids).toEqual([]);
  });
});
