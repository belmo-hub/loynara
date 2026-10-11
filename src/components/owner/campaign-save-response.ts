/** Existing response identity aliases are supported; edits must acknowledge the submitted draft. */
export function campaignSaveId(value: unknown, expectedId?: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as { id?: unknown; campaignId?: unknown; campaign?: { id?: unknown } };
  const id = response.id ?? response.campaignId ?? response.campaign?.id;
  if (typeof id !== "string" || !id.trim() || (expectedId !== undefined && id !== expectedId)) return null;
  return id;
}
