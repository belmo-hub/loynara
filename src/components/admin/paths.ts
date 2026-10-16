export function sanitizeAdminNext(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || /[\\\u0000-\u001f]/.test(value)) return "/admin";
  try {
    const url = new URL(value, "https://admin.invalid");
    if (url.origin !== "https://admin.invalid" || !(url.pathname === "/admin" || url.pathname.startsWith("/admin/"))) return "/admin";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return "/admin"; }
}
