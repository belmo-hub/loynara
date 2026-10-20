import { describe, expect, it } from "vitest";
import { assertTestDatabaseIdentity, assertTestDatabaseUrl, checkedTestContainer } from "./test-database-guard";

const env = {
  NODE_ENV: "test", DATABASE_URL: "postgresql://looplocal:looplocal_local_only@localhost:54348/looplocal_test",
  TEST_PG_PORT: "54348", TEST_PG_DATA_DIRECTORY: "/var/lib/postgresql/data",
  TEST_PG_CONTAINER_ID: "a".repeat(64),
};
const identity = { database: "looplocal_test", username: "looplocal", data_directory: "/var/lib/postgresql/data" };
const container = {
  Id: "a".repeat(64), State: { Running: true },
  Config: { Env: ["POSTGRES_USER=looplocal", "POSTGRES_PASSWORD=looplocal_local_only", "POSTGRES_DB=looplocal"] },
  NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54348" }] } },
};

describe("checked synthetic database identity", () => {
  it.each(["localhost", "127.0.0.1"])("allows the runner's checked loopback container on a portable port (%s)", hostname => {
    expect(assertTestDatabaseUrl({ ...env, DATABASE_URL: env.DATABASE_URL.replace("localhost", hostname) }).port).toBe("54348");
    expect(() => assertTestDatabaseIdentity(identity, env)).not.toThrow();
  });
  it("keeps the default Compose port usable when explicitly checked", () => {
    expect(assertTestDatabaseUrl({ ...env, TEST_PG_PORT: "54329", DATABASE_URL: env.DATABASE_URL.replace("54348", "54329") }).port).toBe("54329");
  });
  it.each([
    "https://looplocal:looplocal_local_only@localhost:54348/looplocal_test",
    "postgresql://looplocal:looplocal_local_only@production.invalid:54348/looplocal_test",
    "postgresql://looplocal:looplocal_local_only@localhost:54347/looplocal_test",
    "postgresql://looplocal:looplocal_local_only@localhost:54348/looplocal",
    "postgresql://other:looplocal_local_only@localhost:54348/looplocal_test",
    "postgresql://looplocal:different@localhost:54348/looplocal_test",
    "postgresql://looplocal:looplocal_local_only@localhost:54348/looplocal_test?host=production.invalid",
    "postgresql://looplocal:looplocal_local_only@localhost:54348/looplocal_test?options=-csearch_path=private",
    "postgresql://looplocal:looplocal_local_only@localhost:54348/looplocal_test#ignored",
  ])("refuses unsafe or overridden connection %s", DATABASE_URL => {
    expect(() => assertTestDatabaseUrl({ ...env, DATABASE_URL })).toThrow();
  });
  it.each([
    { NODE_ENV: "production" }, { NODE_ENV: "development" }, { TEST_PG_PORT: undefined },
    { TEST_PG_PORT: "0" }, { TEST_PG_PORT: "65536" }, { TEST_PG_CONTAINER_ID: undefined },
    { TEST_PG_DATA_DIRECTORY: undefined }, { TEST_PG_DATA_DIRECTORY: "relative" },
  ])("refuses missing or invalid runner attestation %j", overrides => {
    expect(() => assertTestDatabaseUrl({ ...env, ...overrides })).toThrow();
  });
  it.each([
    { ...identity, database: "looplocal" }, { ...identity, username: "postgres" },
    { ...identity, data_directory: "/private/tmp/unowned" }, null,
  ])("refuses database identity mismatch before destructive fixture setup %j", actual => {
    expect(() => assertTestDatabaseIdentity(actual, env)).toThrow();
  });
});

describe("Docker test target attestation", () => {
  it("accepts the running fixed-credential container with an exact private port binding", () => {
    expect(checkedTestContainer([container], "54348")).toBe("a".repeat(64));
  });
  it.each([
    [], [container, container], [{ ...container, State: { Running: false } }],
    [{ ...container, Config: { Env: ["POSTGRES_USER=looplocal", "POSTGRES_PASSWORD=real-password", "POSTGRES_DB=looplocal"] } }],
    [{ ...container, Config: { Env: ["POSTGRES_USER=postgres", "POSTGRES_PASSWORD=looplocal_local_only", "POSTGRES_DB=looplocal"] } }],
    [{ ...container, Config: { Env: ["POSTGRES_USER=looplocal", "POSTGRES_PASSWORD=looplocal_local_only", "POSTGRES_DB=production"] } }],
    [{ ...container, NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "0.0.0.0", HostPort: "54348" }] } } }],
    [{ ...container, NetworkSettings: { Ports: { "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54347" }] } } }],
    [{ ...container, NetworkSettings: { Ports: {} } }],
  ].map(inspection => ({ inspection })))("refuses an unverified container %j", ({ inspection }) => {
    expect(() => checkedTestContainer(inspection, "54348")).toThrow();
  });
});
