import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";

// Runs a Python snippet against scripts/ticket-cycle.py and returns what it prints as JSON.
function python(body: string) {
  const runs = mkdtempSync(path.join(tmpdir(), "ticket-cycle-test-"));
  const script = [
    "import importlib.util, json, os, subprocess, sys",
    `spec = importlib.util.spec_from_file_location("ticket_cycle", ${JSON.stringify(path.resolve("scripts/ticket-cycle.py"))})`,
    "tc = importlib.util.module_from_spec(spec); spec.loader.exec_module(tc)",
    body,
  ].join("\n");
  const out = execFileSync("python3", ["-I", "-B", "-c", script], { env: { NODE_ENV: "test", PATH: process.env.PATH ?? "", HOME: runs, RUNS: runs }, encoding: "utf8" });
  return JSON.parse(out.trim().split("\n").pop()!);
}

it("trusts a ticket's text only when the reporter and every summary or description author are allowed", () => {
  expect(python(`print(json.dumps([
    tc.untrusted_authors("founder", ["founder", "founder"], {"founder"}),
    tc.untrusted_authors("founder", ["founder", "outsider"], {"founder"}),
    tc.untrusted_authors("outsider", [], {"founder"}),
    tc.untrusted_authors("founder", [None], {"founder"}),
    tc.untrusted_authors("founder", [], set()),
  ]))`)).toEqual([[], ["outsider"], ["outsider"], ["(unknown)"], ["founder"]]);
});

it("never starts the command for a ticket whose text came from outside the allowlist", () => {
  const result = python(`
calls = []
class FakeTracker:
    def text_authors(self, issue): return ("founder", ["founder", "outsider"])
    def comment(self, issue, text): calls.append(("comment", text))
    def add_tag(self, issue, name): calls.append(("tag+", name))
    def remove_tag(self, issue, name): calls.append(("tag-", name))
def refuse(*args, **kwargs): raise AssertionError("the command must not run")
cfg = tc.load_config(); cfg.update(RUNS_DIR=os.environ["RUNS"], ALLOWED_AUTHORS="founder", BASE_REF="origin/x")
loop = tc.Loop(cfg); loop.tracker = FakeTracker(); subprocess.run = refuse
loop.process("LOY-1", "Do something")
print(json.dumps(calls))`);
  expect(result).toContainEqual(["tag+", "needs-founder"]);
  expect(result).toContainEqual(["tag-", "agent-ready"]);
  expect(result.filter(([kind, value]: string[]) => kind === "tag+" && value === "agent-working")).toEqual([]);
});

it("keeps branches that touch CI, the loop, install configuration or images from being pushed", () => {
  expect(python(`print(json.dumps(tc.protected_paths([
    ".github/workflows/ci.yml", "scripts/ticket-cycle.py", "scripts/ticket-run.sh", "package.json", "package-lock.json",
    "marketing-site/package.json", ".npmrc", "Dockerfile", "Dockerfile.backup", ".vscode/settings.json",
    "src/lib/staff.ts", "src/.hidden-looking/file.ts", "scripts/seed.ts", "docs/package-notes.md", "drizzle/0025_x.sql",
  ])))`)).toEqual([".github/workflows/ci.yml", "scripts/ticket-cycle.py", "scripts/ticket-run.sh", "package.json", "package-lock.json",
    "marketing-site/package.json", ".npmrc", "Dockerfile", "Dockerfile.backup", ".vscode/settings.json"]);
});

it("hands the command only an allowlisted environment, so tokens exported in a shell stay out of its reach", () => {
  const env = python(`print(json.dumps(tc.agent_env({"PATH": "/bin", "HOME": "/h", "GH_TOKEN": "x", "RAILWAY_TOKEN": "y", "CLOUDFLARE_API_TOKEN": "z", "AWS_SECRET_ACCESS_KEY": "w"}, {"TICKET_FILE": "/t"})))`);
  expect(env).toEqual({ PATH: "/bin", HOME: "/h", TICKET_FILE: "/t" });
});

it("flags implementation commands that can run arbitrary code", () => {
  expect(python(`print(json.dumps([
    len(tc.implement_cmd_warnings('x --allowedTools "Read Bash(npx *) Bash(npm run *)"')) > 0,
    len(tc.implement_cmd_warnings('x --permission-mode bypassPermissions')) > 0,
    tc.implement_cmd_warnings('x --allowedTools "Read Edit Grep"'),
  ]))`)).toEqual([true, true, []]);
});
