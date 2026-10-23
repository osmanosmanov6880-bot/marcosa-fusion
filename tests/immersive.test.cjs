'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseQuality, summarizeFrames, sceneGeometry } = require('../site/immersive.js');

test('quality selection respects accessibility and network constraints', () => {
  assert.equal(chooseQuality({width:1440,cores:12,memory:8,reducedMotion:false,saveData:false}), 'cinema');
  assert.equal(chooseQuality({width:930,cores:8,memory:8,reducedMotion:false,saveData:false}), 'balanced');
  assert.equal(chooseQuality({width:390,cores:8,memory:8,reducedMotion:false,saveData:false}), 'eco');
  assert.equal(chooseQuality({width:1440,cores:2,memory:8,reducedMotion:false,saveData:false}), 'eco');
  assert.equal(chooseQuality({width:1440,cores:8,memory:8,reducedMotion:true,saveData:false}), 'static');
  assert.equal(chooseQuality({width:1440,cores:8,memory:8,reducedMotion:false,saveData:true}), 'static');
});

test('frame timing report gives measurable p95, fps and jank without identifiers', () => {
  const values = [16,16,17,18,34.5,20];
  const a=summarizeFrames(values);
  assert.equal(a.samples,6);
  assert.ok(a.fps>20&&a.fps<60);
  assert.equal(a.jankRate,16.7);
  assert.ok(a.p95ms>=18);
  assert.deepEqual(summarizeFrames([]), {samples:0,fps:0,p50ms:0,p95ms:0,jankRate:0});
});

test('generated architecture uses packed finite geometry and LOD budgets', () => {
  const low=sceneGeometry('eco');const med=sceneGeometry('balanced');const high=sceneGeometry('cinema');
  for(const mesh of [low,med,high]){
    assert.equal(mesh.length%33,0,'3 vertices per triangle, 11 floats per vertex');
    assert.ok(mesh.length>10000);
    assert.ok(mesh.length/33<40000,'do not flood mobile GPU with geometry');
    assert.ok(mesh.every(Number.isFinite));
  }
  assert.ok(low.length<med.length,'low LOD reduces load');
  assert.deepEqual(sceneGeometry('eco'),low,'deterministic procedural city');
});

test('zero network/tracking dependencies in the stand-alone engine', () => {
  const fs=require('node:fs');const path=require('node:path');
  const text=fs.readFileSync(path.join(__dirname,'../site/immersive.js'),'utf8');
  for(const banned of ['fetch(', 'XMLHttpRequest','sendBeacon','document.cookie','localStorage.setItem','https://cdn','new Image('])
    assert.equal(text.includes(banned),false,`forbidden API: ${banned}`);
});