import { McpServer, type CallToolResult, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ARCHIVED_STATUS, ISSUE_STATUSES } from "@/lib/issues";
import { htmlToMarkdown } from "@/lib/rich-text/markdown";

/**
 * theBook's MCP: read-only tools over the owner's tasks
 * (docs/product/features/agentes-y-mcp.md). One server per request, for one
 * caller — always an agent token (requireAgentToken). Nothing here writes:
 * an agent reads, and lib/issues-service.ts refuses any write by one anyway.
 *
 * Built to cost few tokens: short descriptions, compact JSON answers with
 * only what an agent uses, markdown instead of HTML. An agent sees tasks
 * only; notes are the owner's own.
 */

/** A tool's answer: compact JSON, no indentation. */
const reply = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

/** A refusal the agent can act on: the status says which (404, 500…). */
const refuse = ({ status, error }: { status: number; error: string }): CallToolResult => ({
  content: [{ type: "text", text: `${status}: ${error}` }],
  isError: true,
});

const NOT_FOUND = { status: 404, error: "Not found" };

/** `2026-10-28T15:04Z`: minutes are enough to tell what moved. */
const minute = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;

const Id = z.string().min(1).max(100).regex(/^[\w-]+$/, "Not an id").describe("Task id");

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function issuesMcpServer(): McpServer {
  const server = new McpServer({ name: "thebook", title: "theBook", version: "1.0.0" });

  /**
   * registerTool, with what a tool throws logged here and answered as a bare
   * 500: the SDK would send the exception's message — a Prisma query, a
   * stack — to the agent.
   */
  function tool<S extends z.ZodObject>(
    name: string,
    config: { description: string; inputSchema: S; annotations: ToolAnnotations },
    run: (args: z.infer<S>) => Promise<CallToolResult>
  ) {
    const guarded = async (args: z.infer<S>) => {
      try {
        return await run(args);
      } catch (err) {
        console.error(`[mcp] ${name} failed:`, err);
        return refuse({ status: 500, error: "Internal error" });
      }
    };
    // `guarded` takes what the SDK parsed with `inputSchema` (z.infer<S>);
    // TypeScript cannot match that to the SDK's own type for a generic S.
    server.registerTool(name, config, guarded as never);
  }

  tool(
    "issues_list",
    {
      description:
        "Brad's tasks as rows: id, title, status, progress (0-100), updated. Leaves out done (archived) unless `status` asks for it.",
      inputSchema: z.object({
        status: z.array(z.enum(ISSUE_STATUSES)).min(1).max(ISSUE_STATUSES.length).optional().describe("Only these statuses"),
      }),
      annotations: READ,
    },
    async ({ status }) => {
      const rows = await prisma.issue.findMany({
        where: {
          category: "task",
          status: status ? { in: status } : { not: ARCHIVED_STATUS },
        },
        orderBy: [{ sort_order: "asc" }, { created_at: "desc" }],
        select: { id: true, title: true, status: true, progress: true, updated_at: true },
      });
      return reply(rows.map(({ updated_at, ...row }) => ({ ...row, updated: minute(updated_at) })));
    }
  );

  tool(
    "issue_get",
    {
      description: "One task: id, title, status, progress, updated, and its description as markdown.",
      inputSchema: z.object({ id: Id }),
      annotations: READ,
    },
    async ({ id }) => {
      const issue = await prisma.issue.findUnique({
        where: { id },
        select: { id: true, title: true, category: true, status: true, progress: true, updated_at: true, description: true },
      });
      // A note does not exist for an agent: it sees tasks only.
      if (!issue || issue.category !== "task") return refuse(NOT_FOUND);

      return reply({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        progress: issue.progress,
        updated: minute(issue.updated_at),
        description: htmlToMarkdown(issue.description),
      });
    }
  );

  return server;
}
