import {randomUUID} from 'node:crypto';import {writeFileSync} from 'node:fs';
import {auth} from '../src/lib/auth';import {createMerchant,enroll} from '../src/lib/product';import {pool} from '../src/db';import {googleFixture} from '../src/lib/wallet/test-support';
async function seed(){
const database=new URL(process.env.DATABASE_URL??'http://invalid');
if(database.hostname!=='localhost'||database.port!=='55433'||database.pathname!=='/looplocal_browser_wallet_103'||process.env.NODE_ENV==='production')throw new Error('Owned browser DB required');
if((await pool.query('SHOW data_directory')).rows[0].data_directory!=='/private/tmp/loynara-goal-133-pg')throw new Error('Owned PostgreSQL required');
const google=googleFixture('demo'),owner=(await auth.api.signUpEmail({body:{name:'Synthetic Wallet103',email:randomUUID()+'@example.test',password:'Synthetic!Wallet103Only'}})).user;
const shop=await createMerchant({userId:owner.id,businessName:'Synthetic Wallet103',city:'Kassel',country:'DE',timezone:'Europe/Berlin',locale:'de',currency:'EUR',programName:'Synthetic',programType:'stamp',rulesText:'One confirmed synthetic stamp',rewardTitle:'Coffee',rewardCost:5});
const cards=[];for(let i=0;i<6;i++)cards.push(await enroll({slug:shop.programSlug,acceptedTerms:true}));
const binding={tenantId:shop.tenantId,locationId:shop.locationId,programId:shop.programId,classId:'3388000000023201754.program_'+shop.programId,issuanceEnabled:true,testAccountsApproved:true};
writeFileSync('/tmp/loy-103-browser-fixture.json',JSON.stringify({shop,cards,googleEnv:{...google.env,GOOGLE_WALLET_LOCATION_CLASSES:JSON.stringify([binding])},fixtureDirectory:google.dir}),{mode:0o600});}
void seed().finally(()=>pool.end());
