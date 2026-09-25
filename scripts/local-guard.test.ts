import { describe, expect, it } from "vitest";
import { assertLocalTarget } from "./local-guard";

const local = {
  databaseUrl: "postgresql://looplocal:password@localhost:54329/looplocal",
  authUrl: "http://localhost:3000",
  baseUrl: "http://127.0.0.1:3000",
  nodeEnv: "development",
};

describe("local operations target guard", () => {
  it("accepts the explicit local development database", () => {
    expect(() => assertLocalTarget(local)).not.toThrow();
  });

  it("rejects a remote database even if the web URL is local", () => {
    expect(() => assertLocalTarget({ ...local, databaseUrl: "postgresql://looplocal:password@db.example.com/looplocal" })).toThrow();
  });

  it("rejects a production process and nonlocal web URLs", () => {
    expect(() => assertLocalTarget({ ...local, nodeEnv: "production" })).toThrow();
    expect(() => assertLocalTarget({ ...local, baseUrl: "https://looplocal.example.com" })).toThrow();
  });

  it("rejects a different database name so seed cannot touch a test or customer DB", () => {
    expect(() => assertLocalTarget({ ...local, databaseUrl: "postgresql://looplocal:password@localhost:54329/looplocal_test" })).toThrow();
  });
});
