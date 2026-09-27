export type DemoState={step:number;enrolled:boolean;identified:boolean;confirmed:boolean;later:0|6|7;redeemed:boolean};
export const initialDemo=():DemoState=>({step:0,enrolled:false,identified:false,confirmed:false,later:0,redeemed:false});
export type DemoAction='next'|'back'|'enroll'|'identify'|'award'|'jump'|'last'|'redeem'|'reset';
export function balance(s:DemoState){return s.redeemed?0:(s.confirmed?1:0)+s.later;}
export function canAdvance(s:DemoState){return s.step<4&&(s.step!==1||s.enrolled)&&(s.step!==3||s.confirmed);}
export function transition(s:DemoState,a:DemoAction):DemoState {
 switch(a){
 case 'reset':return initialDemo();
 case 'next':return canAdvance(s)?{...s,step:s.step+1}:s;
 case 'back':return {...s,step:Math.max(0,s.step-1)};
 case 'enroll':return s.step===1?{...s,enrolled:true}:s;
 case 'identify':return s.step===3&&s.enrolled?{...s,identified:true}:s;
 case 'award':return s.step===3&&s.identified&&!s.confirmed?{...s,confirmed:true}:s;
 case 'jump':return s.step===4&&s.confirmed&&!s.later?{...s,later:6}:s;
 case 'last':return s.step===4&&s.later===6&&!s.redeemed?{...s,later:7}:s;
 case 'redeem':return s.step===4&&balance(s)===8?{...s,redeemed:true}:s;
 }
}
