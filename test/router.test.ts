import { describe, expect, it } from "vitest";
import { matchRoute, payPath } from "../src/lib/router";

describe("matchRoute", () => {
  it("matches home with or without a trailing slash", () => {
    expect(matchRoute("/")).toEqual({ name: "home" });
    expect(matchRoute("")).toEqual({ name: "home" });
  });

  it("matches the security and sign-in pages", () => {
    expect(matchRoute("/security")).toEqual({ name: "security" });
    expect(matchRoute("/auth/")).toEqual({ name: "auth" });
    expect(matchRoute("/security/extra").name).toBe("not_found");
  });

  it("reads the handle from a pay link, decoded", () => {
    expect(matchRoute("/pay/sani@lycanforge.com.ng")).toEqual({ name: "pay", handle: "sani@lycanforge.com.ng" });
    expect(matchRoute("/pay/sani%40lycanforge.com.ng/")).toEqual({ name: "pay", handle: "sani@lycanforge.com.ng" });
  });

  it("does not match deeper pay paths or unknown pages", () => {
    expect(matchRoute("/pay/a@b.c/extra").name).toBe("not_found");
    expect(matchRoute("/pay/").name).toBe("not_found");
    expect(matchRoute("/nope").name).toBe("not_found");
  });

  it("treats a malformed escape as not found instead of throwing", () => {
    expect(matchRoute("/pay/%E0%A4%A").name).toBe("not_found");
  });
});

describe("payPath", () => {
  it("keeps the @ readable and adds only the parameters given", () => {
    expect(payPath("sani@lycanforge.com.ng")).toBe("/pay/sani@lycanforge.com.ng");
    expect(payPath("sani@lycanforge.com.ng", { amount: "0.25", memo: "Invoice 7" })).toBe(
      "/pay/sani@lycanforge.com.ng?amount=0.25&memo=Invoice+7",
    );
  });

  it("round-trips through matchRoute", () => {
    const route = matchRoute(payPath("a/b@x.y").split("?")[0]);
    expect(route).toEqual({ name: "pay", handle: "a/b@x.y" });
  });
});
