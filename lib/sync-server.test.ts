import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn(), getActorEmail: vi.fn() }));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { isTransientDbError } from "./sync-server";

// Qué corta un push (la base no responde: reintentar después) y qué es un
// fallo del cambio mismo (se responde server_error y el push sigue).
describe("isTransientDbError", () => {
  it.each([
    ["no se llega a la base (P1001)", Object.assign(new Error("Can't reach database server"), { code: "P1001" })],
    ["el pool no dio conexión a tiempo (P2024)", Object.assign(new Error("Timed out fetching a new connection"), { code: "P2024" })],
    ["conflicto de escritura / deadlock (P2034)", Object.assign(new Error("Transaction failed"), { code: "P2034" })],
    ["el adaptador: conexión cerrada", Object.assign(new Error("x"), { meta: { driverAdapterError: { cause: { kind: "ConnectionClosed" } } } })],
    ["el adaptador: demasiadas conexiones", Object.assign(new Error("x"), { cause: { kind: "TooManyConnections" } })],
    ["postgres: la conexión se cayó (08006)", Object.assign(new Error("x"), { cause: { kind: "postgres", code: "08006" } })],
    ["postgres: se está apagando (57P01)", Object.assign(new Error("x"), { cause: { kind: "postgres", code: "57P01" } })],
    ["el socket", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })],
    ["pg: timeout del pool", new Error("timeout exceeded when trying to connect")],
    ["envuelto en otra causa", new Error("outer", { cause: Object.assign(new Error("inner"), { code: "P1017" }) })],
  ])("reintentar después: %s", (_label, err) => {
    expect(isTransientDbError(err)).toBe(true);
  });

  it.each([
    ["un NUL en el texto (22021)", Object.assign(new Error("invalid byte sequence for encoding UTF8: 0x00"), { code: "P2010", meta: { driverAdapterError: { cause: { kind: "postgres", code: "22021" } } } })],
    ["un número fuera de rango", Object.assign(new Error("x"), { cause: { kind: "ValueOutOfRange" } })],
    ["validación de Prisma", Object.assign(new Error("Argument sort_order: Unable to fit value"), { name: "PrismaClientValidationError" })],
    ["un bug del código", new TypeError("Cannot read properties of undefined (reading 'id')")],
    ["nada", null],
  ])("fallo del cambio: %s", (_label, err) => {
    expect(isTransientDbError(err)).toBe(false);
  });
});
