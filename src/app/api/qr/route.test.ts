import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("public QR generation", () => {
  it("rejects oversized or malformed checkout codes before QR work", async () => {
    const tooLong = new Request(`http://localhost:3000/api/qr?value=${encodeURIComponent(`sc_${"A".repeat(5000)}`)}`);
    expect((await GET(tooLong)).status).toBe(400);
    const short = new Request("http://localhost:3000/api/qr?value=sc_123");
    expect((await GET(short)).status).toBe(400);
  });

  it("rejects join URLs with a different origin or added query", async () => {
    const foreign = new Request(`http://localhost:3000/api/qr?value=${encodeURIComponent("https://elsewhere.example/join/program")}`);
    expect((await GET(foreign)).status).toBe(400);
    const extra = new Request(`http://localhost:3000/api/qr?value=${encodeURIComponent("http://localhost:3000/join/program?next=evil")}`);
    expect((await GET(extra)).status).toBe(400);
  });
});
