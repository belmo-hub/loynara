import { afterEach, describe, expect, it, vi } from "vitest";
import { walletJsonBody } from "./body";
afterEach(()=>vi.useRealTimers());
describe("bounded Wallet request body",()=>{
  it("cancels a stalled upload at the request deadline without acquiring a database connection",async()=>{
    vi.useFakeTimers();let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
    const request=new Request("http://localhost/api/wallet/apple",{method:"POST",headers:{"content-type":"application/json"},body,duplex:"half"} as RequestInit);
    const result=expect(walletJsonBody(request,Date.now()+30)).rejects.toThrow("Wallet operation timed out");await vi.advanceTimersByTimeAsync(30);await result;expect(cancelled).toBe(true);
  });
  it("rejects oversized bodies and parses only bounded JSON",async()=>{
    const request=(body:string)=>new Request("http://localhost/api/wallet/apple",{method:"POST",headers:{"content-type":"application/json"},body});
    await expect(walletJsonBody(request(JSON.stringify({token:"synthetic"})),Date.now()+100)).resolves.toEqual({token:"synthetic"});
    await expect(walletJsonBody(request("x".repeat(1001)),Date.now()+100)).rejects.toThrow("Request too large");
  });
});
