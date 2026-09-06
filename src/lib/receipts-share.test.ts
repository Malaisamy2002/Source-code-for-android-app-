import { describe, expect, it } from "vitest";
import {
  buildManifestEntry,
  isReceiptZipPath,
  receiptsArchiveFileName,
  resolveImportAction,
} from "./receipts-share";

describe("buildManifestEntry", () => {
  it("carries the traceability fields for one expense's receipt", () => {
    expect(
      buildManifestEntry({
        id: "e1",
        expense_no: "TX-20260904-0001",
        spent_at: "2026-09-04T10:00:00.000Z",
        category: "Maintenance",
        amount: 500,
        receipt_path: "Receipts/2026-09-04/abc.jpg",
      }),
    ).toEqual({
      path: "Receipts/2026-09-04/abc.jpg",
      expense_id: "e1",
      expense_no: "TX-20260904-0001",
      spent_at: "2026-09-04T10:00:00.000Z",
      category: "Maintenance",
      amount: 500,
    });
  });

  it("coerces amount to a number (Dexie can hand back a string)", () => {
    const entry = buildManifestEntry({
      id: "e1",
      expense_no: null,
      spent_at: "2026-09-04T10:00:00.000Z",
      category: "Other",
      amount: "500" as unknown as number,
      receipt_path: "Receipts/2026-09-04/abc.jpg",
    });
    expect(entry.amount).toBe(500);
  });
});

describe("isReceiptZipPath", () => {
  it("accepts a real receipt file under Receipts/", () => {
    expect(isReceiptZipPath("Receipts/2026-09-04/abc.jpg")).toBe(true);
  });

  it("rejects the manifest", () => {
    expect(isReceiptZipPath("manifest.json")).toBe(false);
  });

  it("rejects folder entries", () => {
    expect(isReceiptZipPath("Receipts/2026-09-04/")).toBe(false);
    expect(isReceiptZipPath("Receipts/")).toBe(false);
  });

  it("rejects anything outside Receipts/", () => {
    expect(isReceiptZipPath("Invoices/Turf/foo.pdf")).toBe(false);
    expect(isReceiptZipPath("readme.txt")).toBe(false);
  });
});

describe("resolveImportAction", () => {
  const known = new Set(["Receipts/2026-09-04/abc.jpg"]);

  it("restores a matched file that isn't already on this device", () => {
    expect(resolveImportAction("Receipts/2026-09-04/abc.jpg", known, false)).toBe("restore");
  });

  it("skips a matched file that's already saved (never overwrite)", () => {
    expect(resolveImportAction("Receipts/2026-09-04/abc.jpg", known, true)).toBe("skip-existing");
  });

  it("skips a file no current expense row points to, existing or not", () => {
    expect(resolveImportAction("Receipts/2026-09-04/orphan.jpg", known, false)).toBe(
      "skip-unmatched",
    );
    expect(resolveImportAction("Receipts/2026-09-04/orphan.jpg", known, true)).toBe(
      "skip-unmatched",
    );
  });
});

describe("receiptsArchiveFileName", () => {
  it("names the file turf-receipts-<timestamp>.zip", () => {
    expect(receiptsArchiveFileName()).toMatch(/^turf-receipts-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.zip$/);
  });
});
