import { describe, expect, it } from "vitest";

import {
  compactMessages,
  normalizeBody,
  parseMailDate,
  splitQuotedBlocks,
  splitPrologue,
  renderCompactScript,
  renderCompactHtml,
  splitNoteBody,
  summarizeCompaction,
  normalizeAttachments,
  formatBytes,
  compactForLlm,
  COMPACT_MIN_CHARS,
  type RawMessage,
  type RawWorkItem,
} from "@tachy/core";

const msg = (over: Partial<RawMessage> & { bodyText: string }): RawMessage => ({
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
    const t = normalizeBody("Hola [cid:abc-1] Javier<mailto:j@x.com> [Image]");
    expect(t).not.toContain("cid:");
    expect(t).not.toContain("mailto:");
    expect(t).not.toContain("[Image]");
    expect(t).toContain("Javier");
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
    const d = parseMailDate("jueves, 18 de junio de 2026 18:10");
    expect(d?.toISOString()).toBe("2026-06-18T18:10:00.000Z");
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
    const c = compactMessages(
      [
        msg({
          externalId: "1",
          bodyText: "El proceso rechaza los UIDs cargados hoy",
        }),
        msg({
          externalId: "2",
          bodyText: "El proceso rechaza los UIDs cargados hoy",
        }),
        msg({ externalId: "3", bodyText: "Confirmamos que ya funciona" }),
      ],
      meta,
    );
    expect(c.turns).toHaveLength(2);
    expect(c.compaction.dropped.exact_duplicate_blocks).toBe(1);
    expect(c.turns[0].text).toContain("rechaza los UIDs");
    expect(c.turns[1].text).toContain("ya funciona");
  });

  it("drops automated mail unless asked to keep it", () => {
    const messages = [
      msg({ externalId: "1", bodyText: "Tenemos un problema con el fichero" }),
      msg({
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
    const c = compactMessages(
      [
        msg({ externalId: "1", bodyText: "Podéis revisar el envío de ayer?" }),
        msg({
          externalId: "2",
          bodyText: "Estaré fuera de la oficina hasta el 31 de julio.",
        }),
      ],
      meta,
    );
    expect(c.turns).toHaveLength(1);
    expect(c.compaction.dropped.auto_reply).toBe(1);
  });

  it("strips banners, legal footers and repeated signature lines", () => {
    const footer = [
      "",
      "Advertencia: Este correo es de un remitente externo.",
      "CONFIDENTIALITY. This e-mail and any attachments are confidential.",
      "Javier Baños | IS Project Manager | : +34 629 56 38 07",
    ].join("\n");
    const c = compactMessages(
      [
        msg({
          externalId: "1",
          bodyText: "Primer punto del analisis" + footer,
        }),
        msg({
          externalId: "2",
          bodyText: "Segundo punto del analisis" + footer,
        }),
        msg({
          externalId: "3",
          bodyText: "Tercer punto del analisis" + footer,
        }),
      ],
      meta,
    );
    const all = c.turns.map((t) => t.text).join("\n");
    expect(all).toContain("Primer punto");
    expect(all).toContain("Tercer punto");
    expect(all).not.toContain("remitente externo");
    expect(all).not.toContain("CONFIDENTIALITY");
    expect(all).not.toContain("629 56 38 07");
  });

  it("keeps the original of text that later mails quote back repeatedly", () => {
    const original =
      "Mañana vamos a realizar unas cargas de UIDs al repositorio";
    const c = compactMessages(
      [
        msg({ externalId: "1", bodyText: original }),
        ...[2, 3, 4, 5].map((i) =>
          msg({
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
    const all = c.turns.map((t) => t.text);
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
    const c = compactMessages(
      [
        msg({ externalId: "1", bodyText: payload("BG", 240) }),
        msg({ externalId: "2", bodyText: payload("RO", 500) }),
      ],
      meta,
    );
    const all = c.turns.map((t) => t.text).join("\n");
    const fields = [
      "Code",
      "EO_ID",
      "Intended_Market",
      "Message_Type",
      "Req_Quantity",
      "P_Brand",
    ];
    // both payloads must survive whole: the differing field is the whole point
    for (const f of fields)
      expect(all.match(new RegExp(`"${f}":`, "g"))).toHaveLength(2);
    expect(all).toContain('"Intended_Market": "BG"');
    expect(all).toContain('"Intended_Market": "RO"');
    expect(all).toContain('"Req_Quantity": 500');
  });

  it("does not shred indentation into paragraph breaks", () => {
    const code = "function f() {\n    const a = 1;\n    return a;\n}";
    expect(normalizeBody(code)).toBe(code);
  });

  it("drops an identical repeated payload but never a differing one", () => {
    const p = ["{", '  "a": 1,', '  "b": 2,', '  "c": 3', "}"].join("\n");
    const c = compactMessages(
      [
        msg({ externalId: "1", bodyText: p }),
        msg({ externalId: "2", bodyText: p }),
      ],
      meta,
    );
    expect(c.turns).toHaveLength(1);
    expect(c.compaction.dropped.exact_duplicate_blocks).toBe(1);
  });

  it("skips a transcript it posted itself instead of compacting its own output", () => {
    const prior = renderCompactHtml(
      compactMessages(
        [msg({ externalId: "1", bodyText: "the real issue" })],
        meta,
      ),
    ).replace(/<[^>]+>/g, " ");
    const c = compactMessages(
      [
        msg({ externalId: "1", bodyText: "the real issue" }),
        msg({ externalId: "2", visibility: "private", bodyText: prior }),
      ],
      meta,
    );
    expect(c.compaction.dropped.prior_transcript).toBe(1);
    expect(c.turns).toHaveLength(1);
    expect(c.turns[0].text).toBe("the real issue");
  });

  it("removes repeated tracking links but keeps one-off urls", () => {
    const messages = Array.from({ length: 6 }, (_, i) =>
      msg({
        externalId: String(i),
        bodyText: `Punto numero ${i} del seguimiento <https://track.example/T0kq9fg0>`,
      }),
    );
    messages.push(
      msg({
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
    const c = compactMessages(
      [
        msg({
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
    const quoted = c.turns.find((t) => t.kind === "quoted")!;
    expect(quoted.speaker).toBe("Alejandro Plaza");
    expect(quoted.at).toBe("2025-12-16T09:00:00.000Z");
    expect(quoted.text).toContain("no son reconocidos");

    const { prologue, thread } = splitPrologue(c);
    expect(prologue.map((t) => t.speaker)).toEqual(["Alejandro Plaza"]);
    expect(thread.every((t) => t.kind !== "quoted")).toBe(true);
  });

  it("labels internal notes and falls back when no sender is known", () => {
    const c = compactMessages(
      [
        msg({
          externalId: "1",
          visibility: "private",
          direction: "outgoing",
          authorLabel: "Borja Martinez",
          bodyText: "THEY ARE SENDING THE MESSAGES WITH WRONG EOID",
        }),
        msg({
          externalId: "2",
          direction: "outgoing",
          bodyText: "Buenas tardes Javier",
        }),
      ],
      meta,
    );
    expect(c.turns[0]).toMatchObject({
      kind: "internal_note",
      speaker: "Borja Martinez",
      source_message: "1",
    });
    expect(c.turns[1]).toMatchObject({ kind: "reply", speaker: "support" });
    expect(c.speakers).toEqual(["Borja Martinez", "support"]);
  });

  it("reports honest counters on an empty thread", () => {
    const c = compactMessages([], meta);
    expect(c.turns).toEqual([]);
    expect(c.compaction).toMatchObject({
      source_messages: 0,
      turns: 0,
      raw_chars: 0,
      compact_chars: 0,
    });
  });
});

describe("attachments", () => {
  const fd = [
    {
      id: 1,
      name: "xml-bad-soap.xml",
      content_type: "application/xml",
      size: 67658,
    },
    { id: 2, name: "notes.txt", content_type: "text/plain", size: 900 },
  ];

  it("normalizes freshdesk, jira and junk shapes alike", () => {
    expect(normalizeAttachments(fd)).toEqual([
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
    const c = compactMessages(
      [
        msg({
          externalId: "1",
          attachments: fd,
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
    const own = c.turns.find((t) => t.kind !== "quoted")!;
    expect(own.attachments?.map((a) => a.name)).toEqual([
      "xml-bad-soap.xml",
      "notes.txt",
    ]);
    for (const q of c.turns.filter((t) => t.kind === "quoted"))
      expect(q.attachments).toBeUndefined();
    expect(c.compaction.attachments).toBe(2);
  });

  it("keeps file references when the message text is itself a duplicate", () => {
    const c = compactMessages(
      [
        msg({ externalId: "1", bodyText: "aqui va el fichero" }),
        msg({
          externalId: "2",
          bodyText: "aqui va el fichero",
          attachments: fd,
        }),
      ],
      meta,
    );
    // the duplicate wording is dropped, but the file must not vanish with it
    expect(c.compaction.attachments).toBe(2);
    expect(
      c.turns.flatMap((t) => t.attachments ?? []).map((a) => a.name),
    ).toContain("xml-bad-soap.xml");
  });

  it("renders files in both the script and the note", () => {
    const c = compactMessages(
      [msg({ externalId: "1", attachments: fd, bodyText: "adjunto va" })],
      meta,
    );
    expect(renderCompactScript(c)).toContain(
      "↳ files: xml-bad-soap.xml (66 KB, application/xml); notes.txt (900 B, text/plain)",
    );
    const html = renderCompactHtml(c);
    expect(html).toContain("xml-bad-soap.xml (66 KB, application/xml)");
    expect(summarizeCompaction(c).files).toBe(
      "2 files referenced by name — open them on the ticket.",
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
      msg({ externalId: "1", bodyText: "algo corto pero real" }),
    ]);
    const r = compactForLlm(i);
    expect(r.compacted).toBeUndefined();
    expect(r.item).toBe(i);
  });

  it("leaves a long ticket alone when there is nothing to gain", () => {
    // distinct paragraphs, no quoting or repetition: compaction cannot help
    const i = item(
      Array.from({ length: 6 }, (_, n) =>
        msg({
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
        msg({ externalId: String(n), bodyText: `Respuesta ${n}.${quoted}` }),
      ),
    );
    const r = compactForLlm(i);
    expect(r.compacted).toBeDefined();
    expect(r.item.messages).toEqual([]);
    expect(r.item.title).toBe("T");
    expect(r.compacted!.turns.length).toBeGreaterThan(0);
  });
});

describe("summarizeCompaction", () => {
  const build = (bodies: string[]) =>
    compactMessages(
      bodies.map((bodyText, i) => msg({ externalId: String(i), bodyText })),
      meta,
    );

  it("speaks in reading effort, not internal vocabulary", () => {
    const s = summarizeCompaction(build(["algo pasa con el fichero"]));
    expect(s.headline).toMatch(
      /^1 messages · \d+ KB to read instead of \d+ KB \(\d+% less\)$/,
    );
    expect(`${s.headline} ${s.removed} ${s.recovered}`).not.toMatch(
      /turns?|blocks?|boilerplate|near-duplicate/i,
    );
  });

  it("names only what it actually removed", () => {
    const s = summarizeCompaction(
      build(["mismo texto repetido", "mismo texto repetido"]),
    );
    expect(s.removed).toContain("1 repeated quote");
    expect(s.removed).not.toContain("automated");
    expect(s.removed).not.toContain("0 ");
    expect(s.recovered).toBe("");
  });

  it("reports recovered history as the find that it is", () => {
    const c = compactMessages(
      [
        msg({
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
    expect(c.compaction.recovered_earlier).toBe(1);
    expect(summarizeCompaction(c).recovered).toBe(
      "Recovered 1 older message that survive only inside quoted replies.",
    );
  });
});

describe("replacing a previous transcript", () => {
  it("reports the ids of transcripts it posted before", () => {
    const prior = renderCompactHtml(
      compactMessages(
        [msg({ externalId: "1", bodyText: "el problema real" })],
        meta,
      ),
    ).replace(/<[^>]+>/g, " ");
    const c = compactMessages(
      [
        msg({ externalId: "1", bodyText: "el problema real" }),
        msg({ externalId: "note-9", visibility: "private", bodyText: prior }),
      ],
      meta,
    );
    expect(c.prior_transcript_ids).toEqual(["note-9"]);
  });

  it("claims nothing to replace on a ticket it has never touched", () => {
    const c = compactMessages(
      [msg({ externalId: "1", bodyText: "hola" })],
      meta,
    );
    expect(c.prior_transcript_ids).toEqual([]);
  });
});

describe("renderers", () => {
  const c = compactMessages(
    [
      msg({
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
    const md = renderCompactScript(c);
    expect(md).toContain("# Report T&T   [#42]");
    expect(md).toContain(
      "Earlier mail, recovered from quoted replies — 1 message",
    );
    expect(md).toContain("Alejandro Plaza (2025-12-16):");
    expect(md).toContain("javier@t.com (2026-06-20)");
  });

  it("escapes html in the note body", () => {
    const c2 = compactMessages(
      [
        msg({
          externalId: "1",
          bodyText: "el bloque <epc>0108435</epc> falla",
        }),
      ],
      meta,
    );
    const html = renderCompactHtml(c2);
    expect(html).toContain("&lt;epc&gt;0108435&lt;/epc&gt;");
    expect(html).not.toContain("<epc>");
    expect(html).toContain("nothing was summarised or reworded");
  });

  it("splits an oversized note at paragraph boundaries", () => {
    const html = renderCompactHtml(c);
    expect(splitNoteBody(html)).toHaveLength(1);
    const parts = splitNoteBody(html, 120);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain("[compacted transcript 1/");
    const stripped = parts
      .map((p) =>
        p.replace(
          /^<p style="color:#888">\[compacted transcript \d+\/\d+\]<\/p>\n/,
          "",
        ),
      )
      .join("\n");
    expect(stripped).toBe(html);
  });
});
