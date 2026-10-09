import { readFileSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { googleDirectStatus } from "./google-direct";
import { googleFixture } from "./test-support";
import { productionWalletRuntimeIssues } from "../../../scripts/wallet-runtime-config";

const issuer = "3388000000023201754";
const binding = { tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", programId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", classId: `${issuer}.synthetic`, issuanceEnabled: true, testAccountsApproved: true };
describe("Google Direct credential and deployment gates", () => {
  it("requires an explicit publication state and genuine service-account structure, without exposing material", () => {
    const fixture = googleFixture();
    try {
      const env: Record<string, string | undefined> = { ...fixture.env, GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_ISSUER_ID: issuer, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) };
      expect(googleDirectStatus(env).ready).toBe(true);
      for (const state of [undefined, "unknown"]) expect(googleDirectStatus({ ...env, GOOGLE_WALLET_PUBLISHING_STATUS: state }).ready).toBe(false);
      const json = JSON.parse(readFileSync(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, "utf8"));
      for (const change of [{ type: "authorized_user" }, { client_email: "person@example.test" }]) {
        writeFileSync(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, JSON.stringify({ ...json, ...change }));
        const status = googleDirectStatus(env);
        expect(status.ready).toBe(false);
        expect(JSON.stringify(status)).not.toContain(json.private_key);
      }
      writeFileSync(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, JSON.stringify(json));
      const link = join(fixture.dir, "linked.json"); symlinkSync(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, link);
      expect(googleDirectStatus({ ...env, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: link }).ready).toBe(false);
    } finally { fixture.cleanup(); }
  });
  it("permits explicitly approved published Direct Google in production, and rejects demo and missing approvals", () => {
    const fixture = googleFixture();
    try {
      const env = { ...fixture.env, NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "loynara-production", WALLET_PRODUCTION_APPROVED: "true", GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_ISSUER_ID: issuer, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) };
      expect(productionWalletRuntimeIssues(env)).toEqual([]);
      expect(productionWalletRuntimeIssues({ ...env, WALLET_PRODUCTION_APPROVED: undefined })).not.toEqual([]);
      expect(productionWalletRuntimeIssues({ ...env, GOOGLE_WALLET_PUBLISHING_STATUS: "demo" })).not.toEqual([]);
      expect(productionWalletRuntimeIssues({ ...env, GOOGLE_WALLET_PROVIDER: undefined })).not.toEqual([]);
    } finally { fixture.cleanup(); }
  });
});
