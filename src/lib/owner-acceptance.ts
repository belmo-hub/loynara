import { db } from "@/db";
import { ownerAcceptances } from "@/db/schema";
import { OWNER_AVV, OWNER_TERMS, SIGNUP_ACCEPTANCE_TEXT_VERSION } from "./owner-contract";
import { OWNER_PRIVACY_NOTICE } from "./owner-privacy";

/** ENG-277: the owner chose „Konto erstellen“ under Legal's sentence. Versions come from the server, the time from the database. */
export async function recordOwnerAcceptance(userId: string) {
  await db.insert(ownerAcceptances).values({ userId, termsVersion: OWNER_TERMS.version, avvVersion: OWNER_AVV.version, privacyVersion: OWNER_PRIVACY_NOTICE.version, textVersion: SIGNUP_ACCEPTANCE_TEXT_VERSION });
}
