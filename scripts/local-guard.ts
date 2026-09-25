export type LocalTarget = {
  databaseUrl?: string;
  authUrl?: string;
  baseUrl?: string;
  nodeEnv?: string;
};

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function assertLocalTarget(target: LocalTarget): void {
  if (target.nodeEnv === "production") throw new Error("Local operations refuse NODE_ENV=production");
  if (!target.databaseUrl || !target.authUrl || !target.baseUrl) throw new Error("Local operations require DATABASE_URL, BETTER_AUTH_URL, and PUBLIC_BASE_URL");

  let database: URL;
  let auth: URL;
  let base: URL;
  try {
    database = new URL(target.databaseUrl);
    auth = new URL(target.authUrl);
    base = new URL(target.baseUrl);
  } catch {
    throw new Error("Invalid local configuration URL");
  }

  if (!["postgres:", "postgresql:"].includes(database.protocol) || !localHosts.has(database.hostname) || decodeURIComponent(database.pathname) !== "/looplocal" || database.search || database.hash) {
    throw new Error("Local operations require the localhost looplocal database");
  }
  if (auth.protocol !== "http:" || base.protocol !== "http:" || !localHosts.has(auth.hostname) || !localHosts.has(base.hostname)) {
    throw new Error("Local operations require localhost HTTP application URLs");
  }
}
