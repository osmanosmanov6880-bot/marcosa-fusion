import {readFile} from 'node:fs/promises';
import {assumptions} from './model.mjs';
import {stressScenarios} from './analysis.mjs';

const filename=process.argv[2];
const custom=filename?JSON.parse(await readFile(filename,'utf8')):{};
const results=[];
for(const mau of [10000,100000,1000000]){
 for(const [scenario,defaults] of Object.entries(assumptions)){
  const input={...defaults,...(custom.all||{}),...(custom[scenario]||{}),mau};
  results.push({scenario,mau,cases:stressScenarios(input)});
 }
}
process.stdout.write(JSON.stringify({
 status:'hypotheses only; not live revenue or payouts',
 currency:'illustrative RUB/month',calculation:'linear scenario sensitivity, not forecast',results
},null,2)+'\n');
