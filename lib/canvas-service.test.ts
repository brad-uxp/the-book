import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { $transaction: vi.fn() } }));

import { prisma } from "@/lib/db";
import { createEdge, createNode, deleteEdge, deleteNode, updateEdge, updateLayout, updateNode } from "./canvas-service";
import type { Db, WriteContext } from "./issues-service";

// Un canvas es una nota, y un agente trabaja tareas: el servicio lo rechaza
// por su cuenta, aunque la ruta ya rechace su token. Sin tocar la base.
describe("canvas-service: un agente no escribe ideas ni conexiones", () => {
  const agent: WriteContext = { actor: "token:agent:claude (tb_agent001)", access: "agent", audit: vi.fn() };
  const db = new Proxy({}, { get: () => { throw new Error("touched the database"); } }) as unknown as Db;
  const node = { issue_id: "n1", x: 0, y: 0 };
  const edge = { issue_id: "n1", source_id: "a", target_id: "b" };

  it.each([
    ["createNode", () => createNode(db, node, agent)],
    ["updateNode", () => updateNode(db, "n1", "a", { content: "<p>x</p>" }, agent)],
    ["updateLayout", () => updateLayout("n1", [{ id: "a", x: 1, y: 1 }], agent)],
    ["deleteNode", () => deleteNode(db, "n1", "a", agent)],
    ["createEdge", () => createEdge(db, edge, agent)],
    ["updateEdge", () => updateEdge(db, "n1", "e1", { source_side: null }, agent)],
    ["deleteEdge", () => deleteEdge(db, "n1", "e1", agent)],
  ])("%s", async (_name, write) => {
    await expect(async () => write()).rejects.toThrow("An agent works tasks, not notes");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
