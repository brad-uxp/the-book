import { describe, it, expect } from "vitest";
import {
  countMentions,
  deletedMentionLabel,
  mentionNeedle,
  plainTextSnippet,
  stripDeletedSuffix,
} from "./mentions";

const person = (id: string) =>
  `<span class="mention" data-mention-id="${id}" data-mention-label="x">x</span>`;
const invoice = (id: string) =>
  `<span class="invoice-mention" data-invoice-id="${id}" data-invoice-label="F">F</span>`;

describe("mentionNeedle", () => {
  it("es exactamente el atributo que escribe el editor", () => {
    expect(mentionNeedle("person", "p1")).toBe('data-mention-id="p1"');
    expect(mentionNeedle("invoice", "i1")).toBe('data-invoice-id="i1"');
  });
});

describe("countMentions", () => {
  it("cuenta una vez por issue, no por aparición", () => {
    const counts = countMentions(
      [
        { issue_id: "a", html: `<p>${person("p1")} y ${person("p1")}</p>` },
        { issue_id: "b", html: `<p>${person("p1")}</p>` },
      ],
      "person"
    );
    expect(counts).toEqual({ p1: 2 });
  });

  it("una mención en la descripción y en un nodo del mismo canvas es un solo issue", () => {
    const counts = countMentions(
      [
        { issue_id: "canvas", html: `<p>${person("p1")}</p>` }, // descripción
        { issue_id: "canvas", html: `<p>${person("p1")}</p>` }, // nodo 1
        { issue_id: "canvas", html: `<p>${person("p2")}</p>` }, // nodo 2
      ],
      "person"
    );
    expect(counts).toEqual({ p1: 1, p2: 1 });
  });

  it("no mezcla personas con facturas", () => {
    const docs = [{ issue_id: "a", html: `${person("p1")}${invoice("i1")}` }];
    expect(countMentions(docs, "person")).toEqual({ p1: 1 });
    expect(countMentions(docs, "invoice")).toEqual({ i1: 1 });
  });

  it("sin menciones no hay conteos", () => {
    expect(countMentions([{ issue_id: "a", html: "<p>hola</p>" }], "person")).toEqual(
      {}
    );
  });
});

describe("plainTextSnippet", () => {
  it("quita las etiquetas y junta los bloques con un espacio", () => {
    expect(plainTextSnippet("<h2>Idea</h2><p>con detalle</p>")).toBe(
      "Idea con detalle"
    );
  });

  it("decodifica las entidades que escribe el editor", () => {
    expect(plainTextSnippet("<p>A &amp; B &lt;3&nbsp;ok</p>")).toBe("A & B <3 ok");
  });

  it("corta con elipsis al pasar el máximo", () => {
    const s = plainTextSnippet(`<p>${"palabra ".repeat(20)}</p>`, 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith("…")).toBe(true);
  });

  it("un nodo vacío da un texto vacío", () => {
    expect(plainTextSnippet("<p></p>")).toBe("");
  });
});

describe("sufijo de mención borrada", () => {
  it("marca una mención borrada con (deleted)", () => {
    expect(deletedMentionLabel("Ana Pérez")).toBe("Ana Pérez (deleted)");
  });
  it("una nota vieja con (eliminado) pasa al sufijo nuevo, sin duplicar", () => {
    expect(deletedMentionLabel("Ana Pérez (eliminado)")).toBe("Ana Pérez (deleted)");
  });
  it("marcar dos veces no agrega un segundo sufijo", () => {
    expect(deletedMentionLabel(deletedMentionLabel("Ana"))).toBe("Ana (deleted)");
  });
  it("quita sufijos acumulados de ambas versiones", () => {
    expect(stripDeletedSuffix("Inv 0142 (eliminado) (deleted)")).toBe("Inv 0142");
  });
  it("no toca un nombre que solo contiene la palabra", () => {
    expect(stripDeletedSuffix("Deleted Scenes Ltd")).toBe("Deleted Scenes Ltd");
  });
});
