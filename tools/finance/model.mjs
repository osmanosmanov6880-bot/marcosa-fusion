/** Monthly scenario model. Inputs are hypotheses in a single currency, excluding tax. */
export function calculate(i) {
 const required=['mau','impressionsPerUser','fill','ecpm','premiumRate','premiumPrice','creatorBuyerRate','creatorSpend','creatorFee','eventBuyerRate','eventSpend','eventFee','brandDeals','brandDealValue','brandFee','proUsers','proPrice','smbUsers','smbPrice','boostSpend','boostMargin','cdnPerMau','storagePerMau','transcodePerMau','databasePerMau','pushPerMau','moderationPerMau','supportPerMau','paymentRate','creatorAdShare','refundRate','fixedDevelopment','fixedMarketing','fixedOperations','taxRate'];
 for (const key of required) if (!Number.isFinite(i[key]) || i[key]<0) throw Error(`Invalid nonnegative input: ${key}`);
 for (const key of ['fill','premiumRate','creatorBuyerRate','creatorFee','eventBuyerRate','eventFee','brandFee','boostMargin','paymentRate','creatorAdShare','refundRate','taxRate']) if(i[key]>1)throw Error(`Rate must be between 0 and 1: ${key}`);
 const impressions=i.mau*i.impressionsPerUser*i.fill;
 const creatorGmv=i.mau*i.creatorBuyerRate*i.creatorSpend*(1-i.refundRate);
 const eventGmv=i.mau*i.eventBuyerRate*i.eventSpend*(1-i.refundRate);
 const brandGmv=i.brandDeals*i.brandDealValue*(1-i.refundRate);
 const premiumGross=i.mau*i.premiumRate*i.premiumPrice*(1-i.refundRate);
 const streams={ads:impressions*i.ecpm/1000,boosts:i.boostSpend*i.boostMargin,premium:premiumGross,creatorSubscriptions:creatorGmv*i.creatorFee,events: eventGmv*i.eventFee,brandMarketplace:brandGmv*i.brandFee,creatorPro:i.proUsers*i.proPrice,smbTools:i.smbUsers*i.smbPrice};
 const revenue=Object.values(streams).reduce((a,b)=>a+b,0);
 // Provider costs use gross processed sale values; assumed borne by MARCOSA here.
 const processed=(i.mau*i.creatorBuyerRate*i.creatorSpend+i.mau*i.eventBuyerRate*i.eventSpend+i.brandDeals*i.brandDealValue+i.mau*i.premiumRate*i.premiumPrice+i.proUsers*i.proPrice+i.smbUsers*i.smbPrice+i.boostSpend);
 const variable={cdn:i.mau*i.cdnPerMau,storage:i.mau*i.storagePerMau,transcoding:i.mau*i.transcodePerMau,database:i.mau*i.databasePerMau,push:i.mau*i.pushPerMau,moderation:i.mau*i.moderationPerMau,support:i.mau*i.supportPerMau,payments:processed*i.paymentRate,creatorAdPayouts:streams.ads*i.creatorAdShare};
 const variableTotal=Object.values(variable).reduce((a,b)=>a+b,0);
 const contributionMargin=revenue-variableTotal;
 const operatingProfit=contributionMargin-i.fixedDevelopment-i.fixedMarketing-i.fixedOperations;
 return {mau:i.mau,impressions,creatorGmv,eventGmv,brandGmv,streams,revenue,variable,variableTotal,contributionMargin,contributionPerMau:i.mau?contributionMargin/i.mau:null,operatingProfit,illustrativeProfitTax:Math.max(0,operatingProfit)*i.taxRate,profitAfterIllustrativeTax:operatingProfit-Math.max(0,operatingProfit)*i.taxRate};
}

export const assumptions={
 // Pure illustrative inputs; no measured MARCOSA revenue or users.
 pessimistic:{impressionsPerUser:8,fill:.2,ecpm:50,premiumRate:.003,premiumPrice:300,creatorBuyerRate:.005,creatorSpend:500,creatorFee:.1,eventBuyerRate:.002,eventSpend:500,eventFee:.1,brandDeals:0,brandDealValue:30000,brandFee:.1,proUsers:0,proPrice:500,smbUsers:0,smbPrice:1000,boostSpend:0,boostMargin:.8,cdnPerMau:4,storagePerMau:1,transcodePerMau:1,databasePerMau:1,pushPerMau:.1,moderationPerMau:1,supportPerMau:.5,paymentRate:.03,creatorAdShare:.2,refundRate:.05,fixedDevelopment:500000,fixedMarketing:100000,fixedOperations:100000,taxRate:0},
 base:{impressionsPerUser:20,fill:.4,ecpm:100,premiumRate:.01,premiumPrice:300,creatorBuyerRate:.03,creatorSpend:1000,creatorFee:.1,eventBuyerRate:.01,eventSpend:500,eventFee:.1,brandDeals:0,brandDealValue:30000,brandFee:.1,proUsers:0,proPrice:500,smbUsers:0,smbPrice:1000,boostSpend:0,boostMargin:.8,cdnPerMau:4,storagePerMau:1,transcodePerMau:1,databasePerMau:1,pushPerMau:.1,moderationPerMau:1,supportPerMau:.5,paymentRate:.03,creatorAdShare:.2,refundRate:.03,fixedDevelopment:500000,fixedMarketing:100000,fixedOperations:100000,taxRate:0},
 optimistic:{impressionsPerUser:35,fill:.65,ecpm:150,premiumRate:.03,premiumPrice:300,creatorBuyerRate:.06,creatorSpend:1000,creatorFee:.1,eventBuyerRate:.02,eventSpend:500,eventFee:.1,brandDeals:0,brandDealValue:30000,brandFee:.1,proUsers:0,proPrice:500,smbUsers:0,smbPrice:1000,boostSpend:0,boostMargin:.8,cdnPerMau:4,storagePerMau:1,transcodePerMau:1,databasePerMau:1,pushPerMau:.1,moderationPerMau:1,supportPerMau:.5,paymentRate:.03,creatorAdShare:.2,refundRate:.02,fixedDevelopment:500000,fixedMarketing:100000,fixedOperations:100000,taxRate:0}
};
