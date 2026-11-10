import { generateDrizzleJson } from "drizzle-kit/api";
import * as schema from "/Users/youssefbelmokhtar/Desktop/Loynara/.claude/worktrees/loynara-termin-booking-aec389/src/db/schema";
import { readFileSync, writeFileSync } from "node:fs";
const prev = JSON.parse(readFileSync("/Users/youssefbelmokhtar/Desktop/Loynara/.claude/worktrees/loynara-termin-booking-aec389/drizzle/meta/0049_snapshot.json", "utf8"));
const next = generateDrizzleJson(schema as never, prev.id);
writeFileSync("/tmp/0050_snapshot.json", JSON.stringify(next, null, 2));
console.log(Object.keys(next.tables).length, next.id, next.prevId);
