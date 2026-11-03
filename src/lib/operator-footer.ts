/**
 * The last line of every owner email (Legal, Q-93): the operator as the Impressum names it, from operatorIdentity() (env,
 * never Stripe). An address set on several lines, or with „\n“ typed into a single-line setting, becomes one line.
 */
export function operatorFooter(operator: { name: string; address: string }) {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  return `${clean(operator.name)} · ${operator.address.split(/\r?\n|\\n/).map(clean).filter(Boolean).join(", ")}`;
}
