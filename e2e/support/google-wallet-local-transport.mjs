const realFetch=globalThis.fetch,classes=new Map(),objects=new Map();
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
 if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'synthetic-local-only',expires_in:3600});
 if(url.startsWith('https://walletobjects.googleapis.com/')){
  const method=init?.method??'GET',body=typeof init?.body==='string'?JSON.parse(init.body):undefined;
  const msg=/\/loyaltyObject\/([^/?]+)\/addMessage$/.exec(url),target=msg&&objects.get(decodeURIComponent(msg[1]));
  if(msg){if(method!=='POST'||!target)return new Response(null,{status:404});target.messages=[...(target.messages??[]),body.message];return Response.json({resource:target});}
  const m=/\/(loyaltyClass|loyaltyObject)(?:\/([^/?]+))?$/.exec(url);if(!m)return new Response(null,{status:404});
  const store=m[1]==='loyaltyClass'?classes:objects,id=m[2]?decodeURIComponent(m[2]):undefined;
  if(method==='GET')return id&&store.has(id)?Response.json(store.get(id)):new Response(null,{status:404});
  if(method==='POST'){if(store.has(body.id))return new Response(null,{status:409});store.set(body.id,body);return Response.json(body);}
  if(method==='PATCH'){if(!id||!store.has(id))return new Response(null,{status:404});store.set(id,{...store.get(id),...body});return Response.json(store.get(id));}
 }
 const u=new URL(url);if(!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw new Error('Only loopback or synthetic Google transport permitted');
 return realFetch(input,init);
};
