import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate,assumptions} from './model.mjs';
test('revenue, payout, refund, contribution and tax calculations stay distinct',()=>{
 const input={...assumptions.base,mau:100000,refundRate:0,taxRate:.2,fixedDevelopment:0,fixedMarketing:0,fixedOperations:0};
 const r=calculate(input);
 assert.equal(r.impressions,800000);
 assert.equal(r.streams.ads,80000);
 assert.equal(r.creatorGmv,3000000);
 assert.equal(r.streams.creatorSubscriptions,300000);
 assert.equal(r.streams.premium,300000);
 assert.equal(r.variable.creatorAdPayouts,16000);
 assert.equal(r.contributionMargin,r.revenue-r.variableTotal);
 assert.equal(r.profitAfterIllustrativeTax,r.operatingProfit-Math.max(0,r.operatingProfit)*.2);
});
test('zero users and invalid rates are explicit',()=>{
 assert.equal(calculate({...assumptions.base,mau:0}).contributionPerMau,null);
 assert.throws(()=>calculate({...assumptions.base,mau:1,fill:2}));
 assert.throws(()=>calculate({...assumptions.base,mau:1,ecpm:NaN}));
});
