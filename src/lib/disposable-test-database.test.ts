import { afterEach, describe, expect, it, vi } from "vitest";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl, DISPOSABLE_DATABASE_MARKER } from "./disposable-test-database";

describe("guard for suites that truncate or end database connections", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("accepts only a plain local looplocal_test URL", () => {
    expect(() => assertLocalTestDatabaseUrl("postgresql://looplocal:secret@localhost:54329/looplocal_test")).not.toThrow();
    expect(() => assertLocalTestDatabaseUrl("postgresql://looplocal:secret@127.0.0.1:55481/looplocal_test")).not.toThrow();
    for (const url of [
      "", "not a url",
      "postgresql://looplocal:secret@db.railway.internal:5432/looplocal_test",
      "postgresql://looplocal:secret@localhost:54329/loynara",
      // node-postgres lets query parameters override the host the URL appears to name.
      "postgresql://looplocal:secret@localhost:54329/looplocal_test?host=db.railway.internal",
      "postgresql://looplocal:secret@localhost:54329/looplocal_test?options=-c%20search_path%3Dother",
      "mysql://looplocal:secret@localhost:3306/looplocal_test",
    ]) expect(() => assertLocalTestDatabaseUrl(url), String(url)).toThrow(/disposable/i);
  });

  it("refuses everything in production mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertLocalTestDatabaseUrl("postgresql://looplocal:secret@localhost:54329/looplocal_test")).toThrow(/disposable/i);
  });

  it("requires the marker the test setup puts on the database it created", async () => {
    const database = (row: Record<string, unknown> | undefined) => ({ query: async () => ({ rows: row ? [row] : [] }) });
    await expect(assertDisposableDatabase(database({ name: "looplocal_test", marker: DISPOSABLE_DATABASE_MARKER }))).resolves.toBeUndefined();
    // A restore or forward that is merely named looplocal_test has no such marker.
    await expect(assertDisposableDatabase(database({ name: "looplocal_test", marker: null }))).rejects.toThrow(/disposable/i);
    await expect(assertDisposableDatabase(database({ name: "loynara", marker: DISPOSABLE_DATABASE_MARKER }))).rejects.toThrow(/disposable/i);
    await expect(assertDisposableDatabase(database(undefined))).rejects.toThrow(/disposable/i);
  });
});
