import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerExportError, readCustomerExport } from "./customer-export-download";

afterEach(() => { vi.restoreAllMocks(); });
const body = JSON.stringify({ formatVersion: 1, scope: "pseudonymous-card-activity-without-contact-records", membership: { id: "synthetic-member", balance: 2 }, program: { name: "Synthetic Card" }, ledger: [{ delta: 2 }], redemptions: [], consentEvents: [] });
const signal = new AbortController().signal;

describe("customer export response validation", () => {
  it("preserves the successful bytes and existing request privacy settings", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8" } }));
    const blob = await readCustomerExport("/api/card/synthetic/export", signal);
    expect(await blob.text()).toBe(body);
    expect(blob.type).toBe("application/json;charset=utf-8");
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/card/synthetic/export", { credentials: "same-origin", cache: "no-store", signal });
  });
  it.each([[404, "invalid-card"], [429, "rate-limit"], [401, "unavailable"], [403, "unavailable"], [503, "unavailable"]])("rejects HTTP %i without exposing or reading a server diagnostic", async (status, kind) => {
    const response = new Response("private synthetic diagnostic", { status: Number(status) });
    const read = vi.spyOn(response, "blob");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(readCustomerExport("/api/card/synthetic/export", signal)).rejects.toMatchObject({ kind, message: "Customer export unavailable" });
    expect(read).not.toHaveBeenCalled();
  });
  it.each(['{"formatVersion":1,', '{"error":"private synthetic diagnostic"}', 'null', '[]', '{"formatVersion":1,"scope":"merchant-data"}'])("refuses malformed, incomplete or unrelated successful JSON: %s", async data => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(data));
    await expect(readCustomerExport("/api/card/synthetic/export", signal)).rejects.toMatchObject({ kind: "incomplete" });
  });
  it("classifies a failed request as unconfirmed receipt rather than server rejection", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("private synthetic transport detail"));
    await expect(readCustomerExport("/api/card/synthetic/export", signal)).rejects.toEqual(new CustomerExportError("incomplete"));
  });
  it("refuses an interrupted body after successful response headers", async () => {
    const response = new Response(body);
    vi.spyOn(response, "blob").mockRejectedValue(new TypeError("private body transport detail"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(readCustomerExport("/api/card/synthetic/export", signal)).rejects.toMatchObject({ kind: "incomplete", message: "Customer export unavailable" });
  });
});
