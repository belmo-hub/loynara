/**
 * The operator as owner emails name it in their footer (Legal, Q-93): the contract partner's name and postal address. Read
 * from OPERATOR_NAME and OPERATOR_ADDRESS (lines separated by line breaks), which the founder sets once he decides the
 * operator. It is the one source for these emails, so a cancellation's text-form confirmation never waits on live billing
 * (CTO, 1 Nov); Stripe's public business details may cross-check it but are never needed. Null while either is missing or
 * malformed; scripts/config-check.ts refuses production without both while the email lane is on.
 */
export function operatorIdentity(env: Record<string, string | undefined> = process.env) {
  const name = clean(env.OPERATOR_NAME);
  const lines = (env.OPERATOR_ADDRESS ?? "").split(/\r?\n|\\n/).map(clean).filter(Boolean);
  if (name.length < 2 || name.length > 120 || !lines.length || lines.length > 4 || lines.some(line => line.length > 120)) return null;
  // A control character or markup in either value is a mistake, never a footer.
  if ([name, ...lines].some(value => /[\u0000-\u001f<>]/.test(value))) return null;
  return { name, address: lines.join(", ") };
}

const clean = (value: string | undefined) => (value ?? "").replace(/[ \t]+/g, " ").trim();

/** For config-check: what is wrong, by setting name, never by value. */
export function operatorIdentityIssues(env: Record<string, string | undefined>) {
  return operatorIdentity(env) ? [] : ["OPERATOR_NAME and OPERATOR_ADDRESS (the operator's name and postal address for owner emails) must both be set"];
}
