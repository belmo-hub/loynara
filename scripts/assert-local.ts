import "dotenv/config";
import { assertLocalTarget } from "./local-guard";

try {
  assertLocalTarget({
    databaseUrl: process.env.DATABASE_URL,
    authUrl: process.env.BETTER_AUTH_URL,
    baseUrl: process.env.PUBLIC_BASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : "Local configuration rejected");
  process.exitCode = 1;
}
