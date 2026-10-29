import { McpServer, type CallToolResult, type ToolAnnotations } from "@modelcontextprotocol/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { ARCHIVED_STATUS, ISSUE_STATUSES } from "@/lib/issues";
import {
  AGENT_STATUSES,
  agentBase,
  appendAgentLog,
  inTransaction,
  updateAgentState,
  updateIssue,
  type Writer,
} from "@/lib/issues-service";
import { htmlToMarkdown, markdownDiff, markdownToHtml } from "@/lib/rich-text/markdown";
import { AGENT_REF_MAX } from "@/lib/text-limits";
import {
  AgentLogEntrySchema,
  AgentNoteMarkdownSchema,
  IssueAgentStateSchema,
  IssueUpdateSchema,
} from "@/lib/validations";

/**
 * theBook's MCP: the issue tools an agent works an epic with (F2 of
 * docs/product/features/agentes-y-mcp.md). One server per request, for one
 * caller — always an agent token (requireAgentToken), held to an agent's
 * rules by lib/issues-service.ts, which every write goes through.
 *
 * Built to cost few tokens: short descriptions, compact JSON answers with
 * only what an agent uses, markdown instead of HTML, and diffs computed here
 * so an agent never keeps copies between passes. An agent sees tasks only;
 * notes are the owner's own.
 */

type Refusal = { ok: false; status: number; error: string };

/** A tool's answer: compact JSON, no indentation. */
const reply = (data: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

/** A refusal the agent can act on: the status says which (403, 404, 409…). */
const refuse = ({ status, error }: { status: number; error: string }): CallToolResult => ({
  content: [{ type: "text", text: `${status}: ${error}` }],
  isError: true,
});

/** Thrown inside a transaction to roll back what it already wrote. */
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.error);
  }
}

const NOT_FOUND = { status: 404, error: "Not found" };

/** `2026-10-28T15:04Z`: minutes are enough to tell what moved. */
const minute = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;

const Id = z.string().min(1).max(100).regex(/^[\w-]+$/, "Not an id").describe("Task id");

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export function issuesMcpServer(writer: Writer): McpServer {
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
        "Brad's tasks (epics) as rows: id, title, status, progress (0-100), updated. Leaves out done (archived) unless `status` asks for it.",
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
      description:
        "One task: its description and your note as markdown, `changes` (what Brad changed in each since your last note, as a diff) and `base`, which issue_update_note needs. `log_lines` adds the end of your log.",
      inputSchema: z.object({
        id: Id,
        log_lines: z.number().int().min(1).max(500).optional().describe("Last lines of your log to include"),
      }),
      annotations: READ,
    },
    async ({ id, log_lines }) => {
      const issue = await prisma.issue.findUnique({
        where: { id },
        select: {
          id: true,
          title: true,
          category: true,
          status: true,
          progress: true,
          updated_at: true,
          description: true,
          agent_note: true,
          agent_state: { select: { log: true, last_note: true, description_seen: true, work_dir: true, session_url: true } },
        },
      });
      // A note does not exist for an agent: it sees tasks only.
      if (!issue || issue.category !== "task") return refuse(NOT_FOUND);

      const state = issue.agent_state;
      const description = htmlToMarkdown(issue.description);
      const note = htmlToMarkdown(issue.agent_note);
      // Both sides through the same converter (markdownDiff says why).
      const changes = {
        description: state?.description_seen != null ? markdownDiff(htmlToMarkdown(state.description_seen), description) : null,
        note: state?.last_note != null ? markdownDiff(htmlToMarkdown(state.last_note), note) : null,
      };

      return reply({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        progress: issue.progress,
        updated: minute(issue.updated_at),
        description,
        note,
        ...(changes.description || changes.note ? { changes: dropNulls(changes) } : {}),
        base: agentBase(issue),
        ...(state?.work_dir ? { work_dir: state.work_dir } : {}),
        ...(state?.session_url ? { session_url: state.session_url } : {}),
        ...(log_lines && state?.log ? { log: state.log.split("\n").slice(-log_lines).join("\n") } : {}),
      });
    }
  );

  tool(
    "issue_update_note",
    {
      description:
        "Replaces your note on a task (markdown). Pass the `base` issue_get returned: if Brad changed the note or the description since, it fails with 409 — read again, keep his answers, retry. Returns the new base.",
      inputSchema: z.object({ id: Id, note: AgentNoteMarkdownSchema, base: z.string().max(64) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, note, base }) => {
      const html = markdownToHtml(note);
      // The HTML is what gets stored: held to the same rule as the REST API's.
      if (!IssueUpdateSchema.pick({ agent_note: true }).safeParse({ agent_note: html }).success) {
        return refuse({ status: 400, error: "Note too long" });
      }
      const result = await inTransaction(writer, (tx, ctx) =>
        updateIssue(tx, id, { agent_note: html }, ctx, { base })
      );
      if (!result.ok) return refuse(result);
      return reply({ base: agentBase(result.value) });
    }
  );

  tool(
    "issue_update_state",
    {
      description:
        "Sets a task's status, progress (0-100), working folder or session link — any of them. Status: in_progress, review (Brad's turn: questions or delivery) or blocked (waiting on someone else); done and pending are Brad's.",
      inputSchema: z.object({
        id: Id,
        status: z
          .enum(AGENT_STATUSES, { error: "Status must be in_progress, review or blocked: done and pending are Brad's" })
          .optional(),
        progress: z.number().int().min(0).max(100).optional(),
        work_dir: z.string().max(AGENT_REF_MAX).nullable().optional().describe("Folder you work in; null clears it"),
        session_url: z.string().max(AGENT_REF_MAX).nullable().optional().describe("http(s) link to your session; null clears it"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, status, progress, ...refs }) => {
      const issuePatch = { ...(status !== undefined ? { status } : {}), ...(progress !== undefined ? { progress } : {}) };
      const parsedRefs = IssueAgentStateSchema.safeParse(refs);
      if (!parsedRefs.success) return refuse({ status: 400, error: JSON.stringify(parsedRefs.error.flatten().fieldErrors) });
      const statePatch = parsedRefs.data;
      if (Object.keys(issuePatch).length === 0 && Object.keys(statePatch).length === 0) {
        return refuse({ status: 400, error: "Nothing to change" });
      }

      try {
        await inTransaction(writer, async (tx, ctx) => {
          // The agent state first: it locks the task's row, so the issue's own
          // checks see the same row until both have landed, or neither has.
          if (Object.keys(statePatch).length > 0) {
            const r = await updateAgentState(tx, id, statePatch, ctx);
            if (!r.ok) throw new Refused(r);
          }
          if (Object.keys(issuePatch).length > 0) {
            const r = await updateIssue(tx, id, issuePatch, ctx);
            if (!r.ok) throw new Refused(r);
          }
        });
      } catch (err) {
        if (err instanceof Refused) return refuse(err.refusal);
        throw err;
      }
      return reply({ ok: true });
    }
  );

  tool(
    "issue_write_log",
    {
      description:
        "Adds an entry (markdown, a line or a few) to your log on a task. The server stamps the time and drops the oldest lines past its limit.",
      inputSchema: z.object({ id: Id, entry: AgentLogEntrySchema }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, entry }) => {
      const result = await inTransaction(writer, (tx, ctx) => appendAgentLog(tx, id, entry, ctx));
      if (!result.ok) return refuse(result);
      return reply({ ok: true });
    }
  );

  return server;
}

/** The object without its null fields. */
function dropNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null)) as Partial<T>;
}
