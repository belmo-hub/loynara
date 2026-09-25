import { pool } from "@/db";

export async function GET() {
  try {
    await pool.query("select 1");
    return Response.json({ status: "ok", database: "reachable" }, { headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ status: "degraded", database: "unreachable" }, { status: 503 }); }
}
