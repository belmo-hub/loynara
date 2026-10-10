import { tapMemberSession } from "./secure-tap";
import { returningMemberSession } from "./returning-card";

/** Both scopes reach customer tap routes. Never lose a signed root or shared-device restriction. */
export function effectiveTapSession(request: Request, programId: string) {
  const tap = tapMemberSession(request, programId), broad = returningMemberSession(request, programId);
  if (!tap) return;
  const matching = [tap, broad].filter(session => session?.token === tap.token);
  return { ...tap, issued: Math.min(...matching.map(session => session!.issued!)), lastActivity: Math.max(...matching.map(session => session!.lastActivity!)),
    shared: tap.shared || broad?.shared === true || (!!broad && broad.token !== tap.token) };
}
