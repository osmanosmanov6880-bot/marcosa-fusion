import {calculate,assumptions} from './model.mjs';

/**
 * Break-even is a *linear, hypothetical* MAU estimate with all per-user
 * assumptions held constant. It is not a forecast or a pricing promise.
 */
export function analyzeAssumptions(input){
 const zero=calculate({...input,mau:0});
 const one=calculate({...input,mau:1});
 const perUser=one.operatingProfit-zero.operatingProfit;
 const fixedGap=-zero.operatingProfit;
 const breakEvenMau=zero.operatingProfit>=0?0:(perUser>0?Math.ceil(fixedGap/perUser):null);
 const present=calculate(input);
 for(const value of [zero.operatingProfit,one.operatingProfit,perUser,present.operatingProfit]){
  if(!Number.isFinite(value))throw Error('Scenario produces a non-finite result');
 }
 return {
  status:'illustrative, not actual receipts or users',
  mau:input.mau,operatingProfit:present.operatingProfit,
  contributionPerMau:present.contributionPerMau,
  incrementalProfitPerMau:perUser,
  fixedGapAtZeroMau:fixedGap,
  breakEvenMau,
  reachableByScaling:breakEvenMau!==null,
  cashRunwayMonths:null,
  caveat:'Linear estimate only. Actual acquisition, retention, payment processing, tax, refunds and fixed costs require independent validation.'
 };
}
export function stressScenarios(input){
 const scenarios={
  baseline:{},
  weakAds:{fill:input.fill*.5,ecpm:input.ecpm*.5},
  expensiveInfrastructure:{cdnPerMau:input.cdnPerMau*2,storagePerMau:input.storagePerMau*2,databasePerMau:input.databasePerMau*2},
  weakerMonetization:{premiumRate:input.premiumRate*.5,creatorBuyerRate:input.creatorBuyerRate*.5,eventBuyerRate:input.eventBuyerRate*.5},
  higherRefunds:{refundRate:Math.min(1,input.refundRate*2)},
  higherSupportAndModeration:{supportPerMau:input.supportPerMau*2,moderationPerMau:input.moderationPerMau*2}
 };
 return Object.entries(scenarios).map(([scenario,overrides])=>{
  const assumptions={...input,...overrides};
  return {scenario,overrides,result:analyzeAssumptions(assumptions)};
 });
}
export function exampleSensitivity(){
 return [10000,100000,1000000].flatMap(mau=>Object.entries(assumptions).map(([scenario,base])=>({
  scenario,mau,cases:stressScenarios({...base,mau})
 })));
}
