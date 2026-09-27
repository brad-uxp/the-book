import { describe, it, expect } from "vitest";
import { checkShapeChange, isBlankHtml, isCanvasNote } from "./notes";

const task = { category: "task", note_format: "text" } as const;
const note = { category: "note", note_format: "text" } as const;
const canvas = { category: "note", note_format: "canvas" } as const;

describe("checkShapeChange — crear", () => {
  it("crea tareas, notas de texto y notas canvas", () => {
    expect(checkShapeChange(null, task).ok).toBe(true);
    expect(checkShapeChange(null, note).ok).toBe(true);
    expect(checkShapeChange(null, canvas).ok).toBe(true);
  });

  it("una nota recién creada no tiene descripción que sembrar", () => {
    const r = checkShapeChange(null, canvas);
    expect(r.ok && r.seedFromDescription).toBe(false);
  });

  it("rechaza una tarea canvas — esquivaría todas las reglas de nota", () => {
    const r = checkShapeChange(null, { category: "task", note_format: "canvas" });
    expect(r).toMatchObject({ ok: false, status: 400 });
  });
});

describe("checkShapeChange — convertir", () => {
  it("tarea ↔ nota de texto sigue funcionando como siempre", () => {
    expect(checkShapeChange(task, note)).toEqual({
      ok: true,
      seedFromDescription: false,
    });
    expect(checkShapeChange(note, task)).toEqual({
      ok: true,
      seedFromDescription: false,
    });
  });

  it("nota de texto → canvas siembra el primer nodo con la descripción", () => {
    expect(checkShapeChange(note, canvas)).toEqual({
      ok: true,
      seedFromDescription: true,
    });
  });

  it("tarea → canvas en un solo paso también siembra", () => {
    expect(checkShapeChange(task, canvas)).toEqual({
      ok: true,
      seedFromDescription: true,
    });
  });

  it("canvas → texto se rechaza: aplanar perdería las conexiones", () => {
    expect(checkShapeChange(canvas, note)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("canvas → tarea se rechaza", () => {
    // Pedido como tarea a secas: el formato queda en canvas, y una tarea
    // canvas no existe.
    expect(
      checkShapeChange(canvas, { category: "task", note_format: "canvas" })
    ).toMatchObject({ ok: false });
    // Pedido como tarea de texto: es aplanar, que tampoco se permite.
    expect(checkShapeChange(canvas, task)).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("dejar un canvas como está no es un cambio", () => {
    expect(checkShapeChange(canvas, canvas)).toEqual({
      ok: true,
      seedFromDescription: false,
    });
  });
});

describe("isCanvasNote", () => {
  it("solo una nota con formato canvas", () => {
    expect(isCanvasNote(canvas)).toBe(true);
    expect(isCanvasNote(note)).toBe(false);
    expect(isCanvasNote(task)).toBe(false);
  });
});

describe("isBlankHtml", () => {
  it("vacío y el párrafo vacío que deja TipTap son lo mismo", () => {
    expect(isBlankHtml("")).toBe(true);
    expect(isBlankHtml("<p></p>")).toBe(true);
    expect(isBlankHtml("<p> </p><p>&nbsp;</p>")).toBe(true);
  });

  it("cualquier texto escrito no es vacío", () => {
    expect(isBlankHtml("<p>hola</p>")).toBe(false);
    expect(isBlankHtml("<h2>Idea</h2>")).toBe(false);
  });

  it("una nota con solo una mención no es vacía", () => {
    expect(
      isBlankHtml(
        '<p><span class="mention" data-mention-id="p1" data-mention-label="Ana">Ana</span></p>'
      )
    ).toBe(false);
  });
});
