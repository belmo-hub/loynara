import { describe, expect, it } from "vitest";
import { previewConfigIssues } from "./preview-config";

const preview = {
  DATABASE_URL: "postgresql://looplocal_preview:looplocal_preview_local_only@127.0.0.1:54330/looplocal_preview",
  BETTER_AUTH_URL: "http://localhost:3001",
  PUBLIC_BASE_URL: "http://localhost:3001",
  BETTER_AUTH_SECRET: "a".repeat(64),
  PUBLIC_REGISTRATION_ENABLED: "false",
  EXTERNAL_EMAIL_ENABLED: "false",
  LIVE_BILLING_ENABLED: "false",
  APPLE_WALLET_ENABLED: "false",
  GOOGLE_WALLET_ENABLED: "false",
  TRUST_PROXY_CLIENT_IP: "false",
  SMTP_HOST: "disabled",
};

describe("compiled local preview configuration", () => {
  it("accepts only the isolated loopback synthetic configuration", () => {
    expect(previewConfigIssues(preview)).toEqual([]);
  });

  it("rejects remote or ordinary development databases", () => {
    expect(previewConfigIssues({ ...preview, DATABASE_URL: "postgresql://user:secret@db.example.com/real" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, DATABASE_URL: "postgresql://looplocal:looplocal_local_only@localhost:54329/looplocal" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, DATABASE_URL: `${preview.DATABASE_URL}?host=db.example.com&port=5432` })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, DATABASE_URL: `${preview.DATABASE_URL}?user=other` })).not.toEqual([]);
  });

  it("rejects network URLs and enabled external services", () => {
    expect(previewConfigIssues({ ...preview, PUBLIC_BASE_URL: "https://preview.example.com" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, PUBLIC_REGISTRATION_ENABLED: "true" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, EXTERNAL_EMAIL_ENABLED: "true" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, LIVE_BILLING_ENABLED: "true" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, APPLE_WALLET_ENABLED: "true" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, GOOGLE_WALLET_ENABLED: "true" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, GOOGLE_WALLET_ASSET_ENABLED: "true" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, TRUST_PROXY_CLIENT_IP: "true" })).not.toEqual([]);
  });

  it("rejects placeholder secrets and live-mail configuration", () => {
    expect(previewConfigIssues({ ...preview, BETTER_AUTH_SECRET: "replace-this" })).not.toEqual([]);
    expect(previewConfigIssues({ ...preview, SMTP_HOST: "smtp.example.com" })).not.toEqual([]);
  });
});
