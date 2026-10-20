import { vi } from "vitest";

// Integration suites exercise local transactions without an outside storage call.
// The real encrypted closure transport is exercised by erasure-manifest.test.py
// and the encrypted restore drill; closure-archive.integration tests prove that
// failed/unacknowledged transport cannot commit closure. No runtime test bypass.
vi.mock("../lib/closure-manifest", () => ({ recordClosureIntent: vi.fn(async () => undefined) }));
