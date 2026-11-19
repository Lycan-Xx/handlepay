import { describe, expect, it } from "vitest";
import {
  MEMO_MAX,
  cleanMemo,
  parseBchAmount,
  parsePayParams,
  paymentErrorMessage,
  paymentStage,
  receiptText,
} from "../src/lib/paylink";
import { formatBch } from "../src/lib/wallet";

const params = (q: string) => parsePayParams(new URLSearchParams(q));

describe("parsePayParams", () => {
  it("reads a dollar amount and a memo", () => {
    expect(params("amount=0.25&memo=Invoice%207")).toEqual({ amountUsd: 0.25, memo: "Invoice 7", ignored: [] });
  });

  it("accepts a leading $ and rejects junk amounts without dropping the rest", () => {
    expect(params("amount=$1.50").amountUsd).toBe(1.5);
    expect(params("amount=-3&memo=hi")).toEqual({ amountUsd: null, badAmount: "-3", memo: "hi", ignored: [] });
    expect(params("amount=1.234").badAmount).toBe("1.234");
  });

  it("names address-like parameters so the page can say they were ignored", () => {
    const p = params("amount=1&to=bitcoincash:qevil&Address=x&to=y");
    expect(p.ignored).toEqual(["to", "Address"]);
    expect(p.amountUsd).toBe(1);
  });

  it("has no amount when the link sets none", () => {
    expect(params("")).toEqual({ amountUsd: null, ignored: [] });
  });
});

describe("parseBchAmount", () => {
  it("converts BCH decimals to whole satoshis without float rounding", () => {
    expect(parseBchAmount("0.00052")).toBe(52_000n);
    expect(parseBchAmount("1")).toBe(100_000_000n);
    expect(parseBchAmount(" 0.12345678 ")).toBe(12_345_678n);
  });

  it("rejects zero, negatives, too many decimals and junk", () => {
    for (const bad of ["", "0", "0.0", "-1", "0.123456789", "1e-3", "abc", ".5", null]) {
      expect(parseBchAmount(bad)).toBeNull();
    }
  });
});

describe("cleanMemo", () => {
  it("strips control characters, collapses whitespace, and caps the length", () => {
    expect(cleanMemo("  line one\nline\ttwo  ")).toBe("line one line two");
    expect(cleanMemo("   ")).toBeUndefined();
    const long = cleanMemo("x".repeat(500))!;
    expect(long).toHaveLength(MEMO_MAX);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("paymentStage", () => {
  it("never says confirmed before a block", () => {
    expect(paymentStage(false, 0)).toBe("submitted");
    expect(paymentStage(true, 0)).toBe("seen");
    expect(paymentStage(true, 1)).toBe("confirmed");
    expect(paymentStage(false, 3)).toBe("confirmed");
  });
});

describe("receiptText", () => {
  it("lists everything a payer needs to keep", () => {
    const text = receiptText(
      {
        handle: "sani@lycanforge.com.ng",
        address: "bchtest:qqxeuaneldpe2awghfsy5h9pahhm5dwwxyx2q6ymcn",
        sats: 120_000n,
        usd: 0.25,
        memo: "Invoice 7",
        txid: "ab".repeat(32),
        network: "chipnet",
        at: Date.UTC(2026, 10, 19, 12, 0, 0),
        explorerUrl: "https://example.test/tx",
      },
      formatBch,
    );
    expect(text).toContain("Paid sani@lycanforge.com.ng");
    expect(text).toContain("Amount: 0.00120000 BCH (about $0.25)");
    expect(text).toContain("Memo: Invoice 7");
    expect(text).toContain("Time: 2026-11-19T12:00:00.000Z");
  });
});

describe("paymentErrorMessage: wallet on the other network", () => {
  const cashonize =
    "The transaction was rejected because one of its UTXOs is missing or already spent. Nothing was sent. The dApp has to build the transaction again: refresh the dApp and repeat the action.";

  it("names the likely network mismatch instead of calling it a cancellation", () => {
    const text = paymentErrorMessage(new Error(cashonize), false, "chipnet");
    expect(text).toContain("couldn't find the coins");
    expect(text).toContain("set to mainnet while this page is on chipnet");
    expect(text).not.toContain("cancelled");
  });

  it("recognises node wording too", () => {
    for (const m of ["Missing inputs", "missing-inputs", "bad-txns-inputs-missingorspent"]) {
      expect(paymentErrorMessage(new Error(m), false, "mainnet")).toContain("set to chipnet while this page is on mainnet");
    }
  });
});

describe("paymentErrorMessage", () => {
  it("says plainly when nothing was sent", () => {
    expect(paymentErrorMessage(new Error("x"), true)).toBe("Payment cancelled. Nothing was sent.");
    expect(paymentErrorMessage(new Error("User rejected the request"), false)).toBe(
      "Payment cancelled in your wallet. Nothing was sent.",
    );
    expect(paymentErrorMessage(new Error("You have 0.1 BCH; this needs about 0.2."), false)).toBe(
      "You have 0.1 BCH; this needs about 0.2.",
    );
  });
});
