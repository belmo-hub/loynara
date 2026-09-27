import {test} from 'node:test';import assert from 'node:assert/strict';
import {initialDemo,transition,balance} from '../src/demo.js';
test('identification alone cannot award; explicit confirmation is idempotent',()=>{
 let s=initialDemo(); assert.equal(balance(transition(s,'award')),0);
 s=transition(s,'next'); assert.equal(transition(s,'next').step,1);
 s=transition(s,'enroll');s=transition(s,'next');s=transition(s,'next');
 assert.equal(balance(transition(s,'award')),0);s=transition(s,'identify');assert.equal(balance(s),0);
 s=transition(s,'award');assert.equal(balance(s),1);assert.equal(balance(transition(s,'award')),1);
 s=transition(s,'next');s=transition(s,'jump');assert.equal(balance(s),7);
 assert.equal(balance(transition(s,'redeem')),7);s=transition(s,'last');assert.equal(balance(s),8);
 s=transition(s,'redeem');assert.equal(balance(s),0);assert.equal(balance(transition(s,'redeem')),0);
 assert.deepEqual(transition(s,'reset'),initialDemo());
});
test('back navigation preserves confirmed history',()=>{let s={...initialDemo(),step:4,enrolled:true,identified:true,confirmed:true};s=transition(s,'back');assert.equal(balance(s),1);assert.equal(balance(transition(s,'award')),1);});

test('each industry threshold has a consistent award, time jump and redemption',async()=>{
 const {industries}=await import('../src/config.js');
 const {demoScreens}=await import('../src/views.js');
 for(const [key,industry] of Object.entries(industries)){
  let s=initialDemo(industry.threshold);
  for(const action of ['next','enroll','next','next','identify','award','next','jump','last'] as const)s=transition(s,action);
  assert.equal(balance(s),industry.threshold);
  assert.match(demoScreens(s,key as keyof typeof industries,''),new RegExp(`Besuch ${industry.threshold}`));
  s=transition(s,'redeem');assert.equal(balance(s),0);
  assert.match(demoScreens(s,key as keyof typeof industries,''),new RegExp(`−${industry.threshold} Stempel`));
  assert.equal(transition(s,'reset').threshold,industry.threshold);
 }
});
