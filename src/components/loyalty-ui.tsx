export type ProgramType = "stamps" | "points";
export type UiLocale = "de" | "fr";

export function BrandIcon({ className = "", inverse = false }: { className?: string; inverse?: boolean }) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect width="64" height="64" rx="17" fill={inverse ? "#f5efdf" : "#16473f"} /><path d="M17 16v33h30" fill="none" stroke={inverse ? "#16473f" : "#f5efdf"} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="45" cy="21" r="6" fill="#f2a078" /></svg>;
}
