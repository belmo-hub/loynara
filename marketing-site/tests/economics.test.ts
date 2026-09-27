import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, calculate, trafficScenario } from '../src/economics.js';
import { periodCost } from '../src/config.js';
test('whole visits and contribution after every specified cost',()=>{
 assert.equal(calculate(4900,800,0,0,10,null).required,7);
 assert.equal(calculate(4900,800,2000,1000,10,1800).required,10);
 assert.equal(calculate(4900,800,2000,1000,10,1800).change,100);
 assert.equal(calculate(4900,800,2000,1000,0,1800).change,-7900);
 assert.equal(calculate(4900,800,2000,1000,10,1800).revenue,18000);
});
test('missing cost assumptions stay unknown',()=>{
 assert.equal(calculate(4900,800,null,null,10,null).complete,false);
 assert.equal(calculate(4900,800,null,null,10,null).change,null);
 assert.equal(calculate(4900,800,null,null,10,null).required,7);
 assert.equal(calculate(4900,800,2000,null,10,null).required,9);
});
test('blank, German decimals, negative and bounded monetary input',()=>{
 assert.equal(parseMoney(''),null); assert.equal(parseMoney('  '),null);
 assert.equal(parseMoney('8,50'),850); assert.equal(parseMoney('1.234,56'),123456);
 assert.equal(parseMoney('8.50'),850); assert.equal(parseMoney('-2'),-200);
 for(const v of ['1e9','Infinity','acht','1,234','1000000,01','1.2.3']) assert.throws(()=>parseMoney(v));
 assert.equal(parseMoney('1000000'),100000000);
});
test('nonpositive contribution has no finite break even; invalid costs refused',()=>{
 assert.equal(calculate(4900,0,0,0,10,null).required,null);
 assert.equal(calculate(4900,-800,0,0,10,null).required,null);
 assert.equal(calculate(4900,null,0,0,10,null).required,null);
 assert.throws(()=>calculate(4900,800,-1,0,10,null));
 assert.throws(()=>calculate(4900,800,0,0,-1,null));
 assert.throws(()=>calculate(4900,800,0,0,100001,null));
});
test('initial package never double-counts month one',()=>{
 assert.equal(periodCost('introDraft','first'),9900);
 assert.equal(periodCost('introDraft','recurring'),4900);
 assert.equal(periodCost('founding','first'),14800);
 assert.equal(periodCost('standard','first'),16800);
 assert.equal(periodCost('standard','recurring'),6900);
});
test('traffic scenario reproduces the observed four-input arithmetic',()=>{
 const result=trafficScenario(50,7000,26,10,39700);
 assert.deepEqual(result,{monthlyRevenue:910000,revenueLessFee:870300,revenueToFee:23,annualRevenueLessFees:10443600});
});
test('zero assumed uplift still charges the fee and does not predict a gain',()=>{
 assert.deepEqual(trafficScenario(50,7000,26,0,4900),{monthlyRevenue:0,revenueLessFee:-4900,revenueToFee:0,annualRevenueLessFees:-58800});
});
test('traffic scenario validates input bounds and half-cent rounding',()=>{
 assert.equal(trafficScenario(3,101,1,50,4900).monthlyRevenue,152);
 for(const args of [[-1,7000,26,10,4900],[50,-1,26,10,4900],[50,7000,0,10,4900],[50,7000,26,-1,4900],[50,7000,26,101,4900],[50,7000,26,10,0]])
  assert.throws(()=>trafficScenario(...args as [number,number,number,number,number]));
});
