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
