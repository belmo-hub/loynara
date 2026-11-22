/**
 * Customer-experience flags (docs/2026-11-10-customer-experience-design.md). Each is on only when it is exactly "true";
 * unset or anything else is off, which is today's behaviour. Read on the server only: a page learns about a feature
 * through props or API fields that exist only while its flag is on.
 */
export const EXPERIENCE_FLAGS = ["FIRST_TAP_HOOK_ENABLED", "STAMP_ANIMATION_ENABLED", "HEAD_START_ENABLED", "SURPRISE_BONUS_ENABLED", "OWNER_WEEKLY_LINE_ENABLED"] as const;
export type ExperienceFlag = typeof EXPERIENCE_FLAGS[number];
export const experienceFlag = (name: ExperienceFlag, env: Record<string, string | undefined> = process.env) => env[name] === "true";
