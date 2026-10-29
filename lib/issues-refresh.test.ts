import { describe, expect, it } from "vitest";
import { mergeRefreshedIssues } from "./issues-refresh";

type Row = { id: string; updated_at?: string; status: string };

const row = (id: string, updated_at: string, status = "pending"): Row => ({ id, updated_at, status });
const none = { isPending: () => false, removed: new Set<string>() };

describe("mergeRefreshedIssues", () => {
  it("returns the same array when nothing changed", () => {
    const local = [row("a", "1"), row("b", "1")];
    const merged = mergeRefreshedIssues(local, [row("b", "1"), row("a", "1")], none);
    expect(merged).toBe(local);
  });

  it("takes the server's copy of an issue that changed, keeping the local order", () => {
    const local = [row("a", "1"), row("b", "1")];
    const merged = mergeRefreshedIssues(local, [row("b", "2", "review"), row("a", "1")], none);
    expect(merged.map((i) => i.id)).toEqual(["a", "b"]);
    expect(merged[1]).toEqual(row("b", "2", "review"));
    expect(merged[0]).toBe(local[0]);
  });

  it("keeps the local copy of an issue with a pending change", () => {
    const local = [row("a", "1", "in_progress")];
    const merged = mergeRefreshedIssues(local, [row("a", "2", "review")], {
      ...none,
      isPending: (id) => id === "a",
    });
    expect(merged).toBe(local);
  });

  it("drops an issue deleted elsewhere, but not one just made here", () => {
    const local = [row("gone", "1"), row("new", "1")];
    const merged = mergeRefreshedIssues(local, [], {
      ...none,
      isPending: (id) => id === "new",
    });
    expect(merged.map((i) => i.id)).toEqual(["new"]);
  });

  it("adds issues new to the screen at the end, unless deleted here", () => {
    const local = [row("a", "1")];
    const merged = mergeRefreshedIssues(local, [row("x", "1"), row("a", "1"), row("y", "1")], {
      ...none,
      removed: new Set(["x"]),
    });
    expect(merged.map((i) => i.id)).toEqual(["a", "y"]);
  });

  it("replaces an issue whose server copy has no updated_at", () => {
    const local: Row[] = [{ id: "a", status: "pending" }];
    const merged = mergeRefreshedIssues(local, [{ id: "a", status: "review" }], none);
    expect(merged[0].status).toBe("review");
  });
});
