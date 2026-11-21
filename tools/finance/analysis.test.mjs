import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeAssumptions,stressScenarios,exampleSensitivity} from '../finance/analysis.mjs';
import {assumptions,calculate} from '../finance/model.mjs';

test('break-even estimate respects fixed costs and positive per-user margin',()=>{
 const input={...assumptions.base,mau:10000,brandDeals:0,boostSpend:0,proUsers:0,smbUsers:0};
 const out=analyzeAssumptions(input);
 const z=calculate({...input,mau:0});
 const o=calculate({...input,mau:1});
 assert.equal(out.incrementalProfitPerMau,o.operatingProfit-z.operatingProfit);
 assert.ok(out.breakEvenMau===null||Number.isSafeInteger(out.breakEvenMau));
 if(out.breakEvenMau!==null){
  assert.ok(calculate({...input,mau:out.breakEvenMau}).operatingProfit>=-0.01);
  if(out.breakEvenMau>0)assert.ok(calculate({...input,mau:out.breakEvenMau-1}).operatingProfit<=0.01);
 }
});
test('cost escalation never masquerades as increased profitability',()=>{
 const input={...assumptions.base,mau:100000};
 const reports=stressScenarios(input);
 assert.equal(reports.length,6);
 const baseline=reports.find(x=>x.scenario==='baseline').result.operatingProfit;
 for(const name of ['expensiveInfrastructure','higherSupportAndModeration']){
  assert.ok(reports.find(x=>x.scenario===name).result.operatingProfit<=baseline);
 }
});
test('no margin means scaling cannot fix fixed losses',()=>{
 const input={...assumptions.base,mau:1000,premiumRate:0,creatorBuyerRate:0,eventBuyerRate:0,fill:0,brandDeals:0,boostSpend:0};
 const report=analyzeAssumptions(input);
 assert.equal(report.reachableByScaling,false);
 assert.equal(report.breakEvenMau,null);
});
test('scenario matrix includes nine audiences with six variations each',()=>{
 const matrix=exampleSensitivity();
 assert.equal(matrix.length,9);
 assert.ok(matrix.every(row=>row.cases.length===6));
 assert.ok(matrix.every(row=>row.cases.every(x=>x.result.status.includes('illustrative'))));
});
