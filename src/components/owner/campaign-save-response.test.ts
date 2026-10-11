import { describe, expect, it } from "vitest";
import { campaignSaveId } from "./campaign-save-response";
describe("campaign persistence acknowledgment", () => {
  it.each([undefined, null, {}, [], "saved", { campaign: {} }, { campaign: { id: null } }, { id: 42 }, { id: " " }])("refuses missing or malformed identity %j", value => { expect(campaignSaveId(value)).toBeNull(); });
  it.each([{ id: "draft-a" }, { campaignId: "draft-a" }, { campaign: { id: "draft-a", status: "draft" } }])("preserves existing identity response forms %j", value => { expect(campaignSaveId(value)).toBe("draft-a"); expect(campaignSaveId(value, "draft-a")).toBe("draft-a"); expect(campaignSaveId(value, "draft-b")).toBeNull(); });
});
