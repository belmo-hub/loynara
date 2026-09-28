import { describe, expect, it } from "vitest";
import { outboxHealth } from "./production-ops-check";

describe("production outbox alert decision", () => {
  it("requires no failed, blocked or overdue jobs", () => {
    expect(outboxHealth({ failed: 0, blocked: 0, overdue: 0 })).toBe(true);
    expect(outboxHealth({ failed: 1, blocked: 0, overdue: 0 })).toBe(false);
    expect(outboxHealth({ failed: 0, blocked: 1, overdue: 0 })).toBe(false);
    expect(outboxHealth({ failed: 0, blocked: 0, overdue: 1 })).toBe(false);
  });
});
