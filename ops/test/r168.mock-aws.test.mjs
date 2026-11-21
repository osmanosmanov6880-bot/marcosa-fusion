import test from 'node:test';
import assert from 'node:assert/strict';
import {createR168SimulatedAws,R168_SIMULATED_COMMANDS} from '../r168/mock-aws.mjs';
test('R168 simulated AWS denies unintended commands and never claims real cloud',async()=>{
 const aws=createR168SimulatedAws();
 assert.equal(aws.productionAuthorized,false);
 assert.equal(aws.realCloudProviderConnected,false);
 await assert.rejects(aws.kmsClient.send({kind:'DeleteBucketCommand'}),/Unrecognised/);
 assert.equal(typeof R168_SIMULATED_COMMANDS.GenerateDataKeyCommand,'function');
 assert.throws(()=>aws.alter({allowProduction:true}),/arbitrary privilege/);
 aws.dispose();
});
