import { describe, it, expect } from "vitest";
import {
  isArchived,
  ARCHIVED_WHERE,
  ARCHIVED_STATUS,
  ARCHIVED_CATEGORY,
} from "./issues";

describe("isArchived", () => {
  it("una tarea en done está archivada", () => {
    expect(isArchived({ category: "task", status: "done" })).toBe(true);
  });

  it.each(["pending", "in_progress", "blocked"])(
    "una tarea en %s no está archivada",
    (status) => {
      expect(isArchived({ category: "task", status })).toBe(false);
    }
  );

  it("una NOTA en done no está archivada — su estado no se muestra nunca", () => {
    // Una nota convertida desde una tarea terminada arrastra status=done. Si
    // contara como archivada, el texto desaparecería de la lista sin que haya
    // forma de encontrarlo: la lista es justamente donde viven las notas.
    expect(isArchived({ category: "note", status: "done" })).toBe(false);
  });

  it("una nota nunca se archiva, en ningún estado", () => {
    for (const status of ["pending", "in_progress", "blocked", "done"]) {
      expect(isArchived({ category: "note", status })).toBe(false);
    }
  });
});

describe("ARCHIVED_WHERE", () => {
  it("es exactamente el mismo criterio que el predicado", () => {
    // La UI filtra con isArchived y la API consulta con ARCHIVED_WHERE. Si se
    // separan, el borrado masivo deja de coincidir con lo que se ve en pantalla.
    expect(ARCHIVED_WHERE).toEqual({
      status: ARCHIVED_STATUS,
      category: ARCHIVED_CATEGORY,
    });
    expect(
      isArchived({
        category: ARCHIVED_WHERE.category,
        status: ARCHIVED_WHERE.status,
      })
    ).toBe(true);
  });
});
