import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    mobileRelease: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/audit", () => ({ auditLog: vi.fn(), getActorEmail: vi.fn(async () => "token:book-release") }));
vi.mock("@/lib/r2", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/r2")>()),
  getReleaseUploadUrl: vi.fn(async (key: string) => `https://r2.test/${key}?put`),
  getReleaseDownloadUrl: vi.fn(async (key: string) => `https://r2.test/${key}?get`),
  releaseObjectSize: vi.fn(),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  requireReleaseToken: vi.fn(),
  requireAppSession: vi.fn(),
}));
vi.mock("@/auth", () => ({ auth: vi.fn(), isAllowedSession: () => false }));

import { NextRequest, NextResponse } from "next/server";
import { POST as create } from "./route";
import { POST as publish } from "./[code]/publish/route";
import { GET as latest } from "./latest/route";
import { prisma } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { releaseObjectSize } from "@/lib/r2";
import { requireAppSession, requireReleaseToken } from "@/lib/api";

const db = vi.mocked(prisma.mobileRelease);
const SHA = "a".repeat(64);
const body = (over: Record<string, unknown> = {}) => ({ version: "0.4.3", version_code: 7, sha256: SHA, size_bytes: 1000, ...over });
const req = (json: unknown) =>
  new NextRequest("http://localhost/api/mobile/releases", { method: "POST", body: JSON.stringify(json), headers: { "content-type": "application/json" } });
const params = (code: string) => ({ params: Promise.resolve({ code }) });
const row = (over: Record<string, unknown> = {}) => ({
  id: "r7", version: "0.4.3", version_code: 7, sha256: SHA, size_bytes: 1000,
  r2_key: "mobile/releases/book-0.4.3-7.apk", notes: "", created_at: new Date(), published_at: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireReleaseToken).mockResolvedValue(null);
  vi.mocked(requireAppSession).mockResolvedValue(null);
  db.findFirst.mockResolvedValue(null as never);
  db.findUnique.mockResolvedValue(null as never);
  db.create.mockImplementation((async ({ data }: { data: object }) => ({ ...row(), ...data })) as never);
  db.update.mockImplementation((async ({ data }: { data: object }) => ({ ...row(), ...data })) as never);
  db.updateMany.mockResolvedValue({ count: 1 } as never);
});

describe("POST /api/mobile/releases", () => {
  it("registra la versión y devuelve la URL de subida con la clave del servidor", async () => {
    const res = await create(req(body({ notes: " Canvas arreglado " })));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.upload_url).toBe("https://r2.test/mobile/releases/book-0.4.3-7.apk?put");
    expect(db.create.mock.calls[0][0]).toMatchObject({ data: { r2_key: "mobile/releases/book-0.4.3-7.apk", notes: "Canvas arreglado" } });
    expect(vi.mocked(auditLog).mock.calls[0][0]).toMatchObject({ entity_type: "mobile_release", action: "create" });
  });

  it("versionCode que no supera a la última publicada → 409", async () => {
    db.findFirst.mockResolvedValue({ version_code: 7 } as never);
    expect((await create(req(body()))).status).toBe(409);
    expect(db.create).not.toHaveBeenCalled();
  });

  it("reintento de una no publicada → reusa la fila (200)", async () => {
    db.findUnique.mockResolvedValue({ id: "r7", published_at: null } as never);
    const res = await create(req(body({ sha256: "b".repeat(64) })));
    expect(res.status).toBe(200);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.create).not.toHaveBeenCalled();
  });

  it.each([
    ["sha256 inválido", { sha256: "XYZ" }],
    ["versión con otra forma", { version: "0.4" }],
    ["tamaño cero", { size_bytes: 0 }],
    ["tamaño enorme", { size_bytes: 400 * 1024 * 1024 }],
    ["campos que son del servidor", { r2_key: "invoices/x/y.pdf" }],
  ])("%s → 400", async (_label, over) => {
    expect((await create(req(body(over)))).status).toBe(400);
    expect(db.create).not.toHaveBeenCalled();
  });

  it("cuerpo demasiado grande → 413", async () => {
    expect((await create(req(body({ notes: "x".repeat(6000) })))).status).toBe(413);
  });

  it("sin token de release → lo que diga requireReleaseToken", async () => {
    vi.mocked(requireReleaseToken).mockResolvedValue(NextResponse.json({ error: "x" }, { status: 403 }));
    expect((await create(req(body()))).status).toBe(403);
    expect(db.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/mobile/releases/[code]/publish", () => {
  it("publica si R2 tiene los bytes declarados", async () => {
    db.findUnique.mockResolvedValue(row() as never);
    vi.mocked(releaseObjectSize).mockResolvedValue(1000);
    const res = await publish(new Request("http://x"), params("7"));
    expect(res.status).toBe(200);
    expect(db.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "r7", published_at: null } });
  });

  it("sin subir → 409; tamaño distinto → 409", async () => {
    db.findUnique.mockResolvedValue(row() as never);
    vi.mocked(releaseObjectSize).mockResolvedValue(null);
    expect((await publish(new Request("http://x"), params("7"))).status).toBe(409);
    vi.mocked(releaseObjectSize).mockResolvedValue(999);
    expect((await publish(new Request("http://x"), params("7"))).status).toBe(409);
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it("inexistente → 404; código con otra forma → 400", async () => {
    expect((await publish(new Request("http://x"), params("7"))).status).toBe(404);
    expect((await publish(new Request("http://x"), params("7; drop"))).status).toBe(400);
  });

  it("dos publicaciones a la vez: la segunda → 409", async () => {
    db.findUnique.mockResolvedValue(row() as never);
    vi.mocked(releaseObjectSize).mockResolvedValue(1000);
    db.updateMany.mockResolvedValue({ count: 0 } as never);
    expect((await publish(new Request("http://x"), params("7"))).status).toBe(409);
  });
});

describe("GET /api/mobile/releases/latest", () => {
  it("antes de la primera → { release: null }", async () => {
    const res = await latest();
    expect(await res.json()).toEqual({ release: null });
  });

  it("la última publicada, con un enlace de descarga corto", async () => {
    db.findFirst.mockResolvedValue(row({ published_at: new Date("2026-09-29T12:00:00Z") }) as never);
    const json = await (await latest()).json();
    expect(json.release).toMatchObject({ version: "0.4.3", version_code: 7, sha256: SHA, size_bytes: 1000 });
    expect(json.release.download_url).toBe("https://r2.test/mobile/releases/book-0.4.3-7.apk?get");
    expect(db.findFirst.mock.calls[0][0]).toMatchObject({ where: { published_at: { not: null } }, orderBy: { version_code: "desc" } });
  });

  it("sin credencial de la app → lo que diga requireAppSession", async () => {
    vi.mocked(requireAppSession).mockResolvedValue(NextResponse.json({ error: "x" }, { status: 401 }));
    expect((await latest()).status).toBe(401);
  });
});
