import {readFile} from 'node:fs/promises';
import {calculate,assumptions} from './model.mjs';
const custom=process.argv[2] ? JSON.parse(await readFile(process.argv[2],'utf8')) : {};
const results=[];
for(const mau of [10000,100000,1000000]) for(const [scenario,defaults] of Object.entries(assumptions)) {
 const input={...defaults,...(custom.all||{}),...(custom[scenario]||{}),mau};
 results.push({scenario,input,result:calculate(input)});
}
process.stdout.write(JSON.stringify({currency:'illustrative RUB/month',status:'hypotheses, not actual data',results},null,2)+'\n');
