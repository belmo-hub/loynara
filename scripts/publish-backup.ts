import { linkSync } from "node:fs";

// The validated temporary archive is created beside its destination. Linking
// publishes it atomically only if that exact destination does not exist; unlike
// mv, it cannot replace a concurrent archive or move into a new directory.
const [temporary, output, ...extra] = process.argv.slice(2);
if (!temporary || !output || extra.length) {
  console.error("Backup publication requires a temporary archive and destination.");
  process.exitCode = 1;
} else {
  try { linkSync(temporary, output); }
  catch (error) {
    const exists = error instanceof Error && "code" in error && error.code === "EEXIST";
    console.error(exists ? "Backup target already exists; choose another path." : "Backup could not be published; no destination was replaced.");
    process.exitCode = 1;
  }
}
