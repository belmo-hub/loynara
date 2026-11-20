import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ownerAcceptances } from "@/db/schema";
import { OWNER_AVV, OWNER_TERMS, SIGNUP_ACCEPTANCE_TEXT_VERSION } from "./owner-contract";
import { OWNER_PRIVACY_NOTICE } from "./owner-privacy";

/** ENG-277: the owner chose „Konto erstellen“ under Legal's sentence. Versions come from the server, the time from the database. */
export async function recordOwnerAcceptance(userId: string) {
  // Only for an account that exists: Better Auth answers an address already taken with a made-up user (ENG-283).
  await db.execute(sql`INSERT INTO ${ownerAcceptances} (user_id, terms_version, avv_version, privacy_version, text_version)
    SELECT ${userId}, ${OWNER_TERMS.version}, ${OWNER_AVV.version}, ${OWNER_PRIVACY_NOTICE.version}, ${SIGNUP_ACCEPTANCE_TEXT_VERSION}
    WHERE EXISTS (SELECT 1 FROM "user" WHERE id = ${userId})`);
}
