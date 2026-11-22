import { describe, expect, it } from "vitest";
import { qrSvg, SUGGESTED_USD } from "../src/lib/qr";

describe("funding QR", () => {
  it("draws a QR as an svg for a chipnet address, and differs per address", () => {
    const a = qrSvg("bchtest:qpdtcwv9yanxkg5yms9mxxa3dxuamj6wjv4gsnh876");
    const b = qrSvg("bchtest:qq0000000000000000000000000000000000000000");
    expect(a.startsWith("<svg")).toBe(true);
    expect(a).not.toBe(b);
  });
  it("suggests a small, sensible dollar amount", () => {
    expect(SUGGESTED_USD).toBeGreaterThan(0);
    expect(SUGGESTED_USD).toBeLessThanOrEqual(1);
  });
});

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FundAddress } from "../src/components/FundAddress";

describe("FundAddress", () => {
  const addr = "bchtest:qpdtcwv9yanxkg5yms9mxxa3dxuamj6wjv4gsnh876";
  it("shows the address, a QR, a copy button and the sats minimum on chipnet", () => {
    const html = renderToString(createElement(FundAddress, { address: addr, network: "chipnet", minSats: 2000n }));
    expect(html).toContain(addr);
    expect(html).toContain("<svg");
    expect(html).toContain("Copy address");
    expect(html).toContain("2,000 sats");
    expect(html).toContain("no dollar value");
  });
  it("suggests dollars on mainnet", () => {
    const html = renderToString(createElement(FundAddress, { address: "bitcoincash:qq" + "0".repeat(40), network: "mainnet", minSats: 2000n }));
    expect(html).toContain("$0.25");
  });
});
