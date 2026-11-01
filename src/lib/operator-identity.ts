// The operator's name and postal address from configuration (founder's G0); null while either is unset.
export function operatorIdentity(): { name: string; address: string } | null {
  const name = process.env.OPERATOR_NAME?.trim(), address = process.env.OPERATOR_ADDRESS?.trim();
  return name && address ? { name, address } : null;
}
