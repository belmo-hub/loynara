import "dotenv/config";
import { deviceTestPreparationIssues, deviceTestRuntimeIssues } from "./device-test-config";

const mode = process.argv[2];
if (mode !== "--prepare" && mode !== "--runtime") {
  console.error("Usage: tsx scripts/device-test-assert.ts --prepare|--runtime");
  process.exit(2);
}

const issues = mode === "--prepare" ? deviceTestPreparationIssues(process.env) : deviceTestRuntimeIssues(process.env);
if (issues.length) {
  console.error("Separate synthetic device-test configuration rejected:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
}
