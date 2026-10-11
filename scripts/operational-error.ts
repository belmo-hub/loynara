/** Fixed classifications only: never reflect exception fields, including nested driver causes. */
export function databaseFailureDiagnostic(error: unknown): string | null {
  let current = error;
  // Driver wrappers can carry a cause; bound traversal even for cyclic objects.
  for (let depth = 0; depth < 3; depth++) {
    if (!current || typeof current !== "object") return null;
    try {
      const code = "code" in current ? current.code : undefined;
      switch (code) {
        case "28P01": case "28000":
          return "Database authentication failed; check reviewed database credentials";
        case "ECONNREFUSED": case "ENOTFOUND": case "EAI_AGAIN": case "ETIMEDOUT":
        case "08000": case "08001": case "08003": case "08004": case "08006": case "08007": case "08P01":
          return "Database connection failed; check database availability and reviewed connection configuration";
        case "42501":
          return "Database permission denied; check reviewed database access";
        case "42P01": case "42703":
          return "Database schema mismatch; check reviewed migration and release identity";
        case "57014":
          return "Database query cancelled or timed out; check database availability";
        default:
          break;
      }
      current = "cause" in current ? current.cause : undefined;
    } catch { return null; } // Hostile accessors must not escape the logging boundary.
  }
  return null;
}
