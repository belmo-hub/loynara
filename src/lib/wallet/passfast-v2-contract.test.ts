import { describe, expect, it } from "vitest";
import template from "./fixtures/passfast-v2-contract.json";
import { passFastData, passFastVoidData } from "./passfast";
import type { WalletPassData } from "./types";
const pass: WalletPassData={tenantId:"synthetic-tenant",membershipId:"synthetic-member",programId:"synthetic-program",merchantName:"Synthetic café",programName:"Coffee",locationName:"Mitte",brandColor:"#214739",country:"DE",locale:"de",programType:"stamp",balance:5,scanCode:"sc_synthetic",cardLocator:"K-ABCDEF",reward:{title:"Coffee",cost:5}};
// Templates published since Oct 2026 (the demo café binding) type every field as a string; v2 itself only accepts numbers,
// so rebinding a shop to v2 now also needs the numeric code back.
describe("retained published PassFast V2 contract, offline only",()=>{
  it.each(["de","fr"] as const)("supplies every required field with the published type (%s)",locale=>{
    expect(template.id).toBe("0d283e79-17ba-48ca-9b2d-438487644190");
    expect(template.app_id).toBe("fe0f1e68-4655-41d2-b805-813281911f79");
    expect(template.is_published).toBe(true);expect(template.is_archived).toBe(false);
    const data=passFastData({...pass,locale});
    expect(Object.keys(data).sort()).toEqual(Object.keys(template.field_schema).sort());
    for(const [key,field] of Object.entries(template.field_schema)) {
      expect(field.required).toBe(true);expect(typeof data[key as keyof typeof data]).toBe("string");
    }
    expect(data.rewardReady).toBe(locale==="de"?"Prämie bereit":"Récompense disponible");
  });
  it("keeps barcode, numeric balance and reward presentation bindings compatible after retirement",()=>{
    expect(template.structure.barcode).toEqual({format:"PKBarcodeFormatQR",messageDataKey:"scanCode",altTextDataKey:"cardLocator"});
    expect(template.structure.backFields.find(f=>f.key==="rewardReady")).toMatchObject({label:"",dataKey:"rewardReady"});
    expect(template.structure.headerFields[0]).toMatchObject({dataKey:"balance",numberStyle:"PKNumberStyleDecimal"});
    expect(template.structure.loyaltyPointsDataKey).toBe("balance");
    expect({...passFastData(pass),...passFastVoidData}).toMatchObject({balance:"0",scanCode:"",cardLocator:"",rewardReady:""});
  });
});
