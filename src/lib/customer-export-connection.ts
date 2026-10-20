import type { Pool, PoolClient } from "pg";

/** Abort destroys the checked-out connection, forcing half-open queries to reject. */
export function checkoutCustomerExportConnection(database: Pick<Pool,"connect">, signal?: AbortSignal): Promise<PoolClient> {
  const unavailable = () => new Error(signal?.aborted ? "Export interrupted" : "Export database unavailable");
  if (signal?.aborted) return Promise.reject(unavailable());
  const pending = database.connect();
  return new Promise((resolve,reject) => {
    let settled=false;
    const cancel = () => {
      if (settled) return; settled=true; clearTimeout(timer); signal?.removeEventListener("abort",cancel); reject(unavailable());
    };
    const timer=setTimeout(cancel,5000);
    signal?.addEventListener("abort",cancel,{once:true});
    pending.then(client=>{
      if (settled) { client.release(true); return; }
      settled=true; clearTimeout(timer); signal?.removeEventListener("abort",cancel);
      const release=client.release.bind(client); let released=false;
      const abortClient=()=>client.release(true);
      client.release=(destroy?: Error | boolean)=>{
        if(released)return;released=true;signal?.removeEventListener("abort",abortClient);release(destroy);
      };
      signal?.addEventListener("abort",abortClient,{once:true});
      if(signal?.aborted){abortClient();reject(unavailable());return;}
      resolve(client);
    },()=>{if(!settled){settled=true;clearTimeout(timer);signal?.removeEventListener("abort",cancel);reject(unavailable());}});
  });
}
