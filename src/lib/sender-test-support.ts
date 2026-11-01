import { updateSender } from "./locations";

/** Test fixtures: a location's whole sender block in one call, saved part by part as the owner's screens do. */
export async function fillSender(actorUserId: string, input: { locationId: string; street: string; postalCode: string; city: string; representative: string;
  contactEmail?: string; contactPhone?: string; legalForm?: string; registerCourt?: string; registerNumber?: string; vatId?: string }) {
  const { locationId } = input;
  await updateSender(actorUserId, { part: "address", locationId, street: input.street, postalCode: input.postalCode, city: input.city });
  await updateSender(actorUserId, { part: "contact", locationId, contactEmail: input.contactEmail ?? "", contactPhone: input.contactPhone ?? "" });
  await updateSender(actorUserId, { part: "representative", representative: input.representative });
  await updateSender(actorUserId, { part: "register", legalForm: input.legalForm ?? "", registerCourt: input.registerCourt ?? "", registerNumber: input.registerNumber ?? "", vatId: input.vatId ?? "" });
}
