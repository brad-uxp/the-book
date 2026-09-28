import { describe, it, expect } from "vitest";
import { lockedKeyCount, withKeyLock } from "./keyed-lock";

const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

describe("withKeyLock", () => {
  it("con la misma clave, uno por vez y en orden", async () => {
    const log: string[] = [];
    const run = (name: string) =>
      withKeyLock("a", async () => {
        log.push(`${name}:start`);
        await tick();
        log.push(`${name}:end`);
      });
    await Promise.all([run("1"), run("2"), run("3")]);
    expect(log).toEqual(["1:start", "1:end", "2:start", "2:end", "3:start", "3:end"]);
  });

  it("claves distintas corren a la vez", async () => {
    const log: string[] = [];
    const run = (key: string) =>
      withKeyLock(key, async () => {
        log.push(`${key}:start`);
        await tick();
        log.push(`${key}:end`);
      });
    await Promise.all([run("a"), run("b")]);
    expect(log.slice(0, 2).sort()).toEqual(["a:start", "b:start"]);
  });

  it("un error libera la clave para el siguiente, y no queda nada guardado", async () => {
    const first = withKeyLock("a", async () => {
      throw new Error("boom");
    });
    const second = withKeyLock("a", async () => "ok");
    await expect(first).rejects.toThrow("boom");
    await expect(second).resolves.toBe("ok");
    expect(lockedKeyCount()).toBe(0);
  });
});
