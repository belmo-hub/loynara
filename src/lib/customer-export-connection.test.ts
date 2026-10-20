import { createServer, type Socket } from "node:net";
import { Pool, type PoolClient } from "pg";
import { afterEach, expect, it, vi } from "vitest";
import { checkoutCustomerExportConnection } from "./customer-export-connection";
import { stageCustomerExport } from "./customer-export-stage";
afterEach(()=>vi.useRealTimers());
async function halfOpenPeer(){
 const sockets=new Set<Socket>();let querySeen!:()=>void;
 const queried=new Promise<void>(resolve=>{querySeen=resolve;});
 const server=createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
  let startup=true,buffer=Buffer.alloc(0);
  socket.on('data',chunk=>{
   if(!startup){querySeen();return;}
   buffer=Buffer.concat([buffer,typeof chunk==='string'?Buffer.from(chunk):chunk]);if(buffer.length<4||buffer.length<buffer.readInt32BE(0))return;
   startup=false;
   // AuthenticationOk + ReadyForQuery. All subsequent SQL is deliberately unanswered.
   socket.write(Buffer.from([0x52,0,0,0,8,0,0,0,0,0x5a,0,0,0,5,0x49]));
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const address=server.address();if(!address||typeof address==='string')throw Error('Synthetic peer unavailable');
 const pool=new Pool({host:'127.0.0.1',port:address.port,user:'synthetic',password:'synthetic',database:'synthetic',ssl:false,max:1,connectionTimeoutMillis:1000,idleTimeoutMillis:0});
 pool.on('error',()=>{});pool.on('connect',client=>client.on('error',()=>{}));
 return {pool,sockets,queried,close:async()=>{for(const socket of sockets)socket.destroy();await pool.end();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
it.each(['internal deadline','caller abort'] as const)('destroys a real half-open PostgreSQL protocol connection on %s before releasing export capacity',async mode=>{
 const peer=await halfOpenPeer(),caller=new AbortController();let producerStopped=false,exportSignal:AbortSignal|undefined;
 const pending=stageCustomerExport(async(_append,signal)=>{
  exportSignal=signal;const client=await checkoutCustomerExportConnection(peer.pool,signal);
  try{await client.query('SELECT synthetic_half_open_export');}finally{client.release();producerStopped=true;}
 },caller.signal,{deadlineMs:mode==='internal deadline'?200:120_000});
 const failed=expect(pending).rejects.toThrow('Export interrupted');
 try{
  await peer.queried;if(mode==='caller abort')caller.abort();await failed;
  await expect.poll(()=>({clients:peer.pool.totalCount,sockets:peer.sockets.size,producerStopped})).toEqual({clients:0,sockets:0,producerStopped:true});
  expect(exportSignal?.aborted).toBe(true);
  const next=await stageCustomerExport(async append=>append('{}'));await next.dispose();
 }finally{caller.abort();await pending.catch(()=>{});await peer.close();}
});
it.each(['deadline','abort'] as const)('bounds checkout and destroys an acquisition arriving after %s',async mode=>{
 vi.useFakeTimers();let acquired!:(client:PoolClient)=>void;
 const connection=new Promise<PoolClient>(resolve=>{acquired=resolve;}),connect=vi.fn(()=>connection),controller=new AbortController();
 const pending=checkoutCustomerExportConnection({connect} as unknown as Pick<Pool,'connect'>,controller.signal),failed=expect(pending).rejects.toThrow(mode==='abort'?'interrupted':'unavailable');
 if(mode==='abort')controller.abort();else await vi.advanceTimersByTimeAsync(5000);
 await failed;const release=vi.fn();acquired({release} as unknown as PoolClient);await Promise.resolve();
 expect(release).toHaveBeenCalledExactlyOnceWith(true);
});
it('does not acquire a connection for an already aborted request',async()=>{
 const controller=new AbortController();controller.abort();const connect=vi.fn();
 await expect(checkoutCustomerExportConnection({connect} as unknown as Pick<Pool,'connect'>,controller.signal)).rejects.toThrow('interrupted');expect(connect).not.toHaveBeenCalled();
});
