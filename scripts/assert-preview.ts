import "dotenv/config";
import { previewConfigIssues } from "./preview-config";

const issues = previewConfigIssues(process.env);
if (issues.length) {
  console.error("Local compiled preview rejected:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
}
