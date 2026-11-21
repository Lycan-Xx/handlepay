import { describe, expect, it } from "vitest";
import { diagnoseNip05 } from "../src/lib/nip05diagnose";
import { parseHandle } from "../src/lib/nostr";

const handle = parseHandle("sani@example.org")!;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const diagnose = (fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) => diagnoseNip05(handle, { fetchImpl });

describe("diagnoseNip05", () => {
  it("names a missing file", async () => {
    expect((await diagnose(async () => new Response("", { status: 404 }))).problem).toBe("no_file");
  });

  it("names a server error", async () => {
    expect((await diagnose(async () => new Response("", { status: 503 }))).problem).toBe("server_error");
  });

  it("spots an HTML page served in place of the file", async () => {
    expect((await diagnose(async () => new Response("<html></html>", { status: 200 }))).problem).toBe("not_json");
  });

  it("spots a file without a names section, and a names section without the name", async () => {
    expect((await diagnose(async () => json({ hello: 1 }))).problem).toBe("no_names");
    expect((await diagnose(async () => json({ names: { other: "x" } }))).problem).toBe("name_absent");
  });

  it("says the file looks right when the name is listed", async () => {
    expect((await diagnose(async () => json({ names: { sani: "x" } }))).problem).toBe("ok");
  });

  it("tells a blocked answer from an unreachable site", async () => {
    // The checker's own request fails; whether a no-cors probe gets any answer says which it was.
    const fail = (probe: () => Promise<Response>) => async (_url: string, init?: RequestInit) => {
      if (init?.mode === "no-cors") return probe();
      throw new TypeError("Failed to fetch");
    };
    expect((await diagnose(fail(async () => new Response("", { status: 200 })))).problem).toBe("blocked_cors");
    expect(
      (
        await diagnose(
          fail(async () => {
            throw new TypeError("Failed to fetch");
          }),
        )
      ).problem,
    ).toBe("unreachable");
  });
});
