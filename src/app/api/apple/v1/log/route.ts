// Wallet's optional client log endpoint. We deliberately do not persist device diagnostics or tokens.
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return new Response(null, { status: 413 });
  return new Response(null, { status: 200 });
}
