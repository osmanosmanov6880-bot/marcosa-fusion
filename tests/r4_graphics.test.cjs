'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const r4 = require('../site/immersive.js');

test('R4 render budget respects device pixel caps and adaptive resolution', () => {
  for (const tier of ['eco','balanced','cinema']) {
    for (const dims of [[390,844,3],[1440,900,2],[3840,2160,3],[7680,4320,2]]) {
      const q=r4.renderBudget(...dims,tier,1);
      assert.ok(q.width>=2 && q.height>=2);
      assert.ok(q.pixels<=q.budget, JSON.stringify({tier,dims,q}));
      assert.equal(q.pixels,q.width*q.height);
      assert.ok(Number.isFinite(q.scale));
    }
    const native=r4.renderBudget(1920,1080,2,tier,1);
    const reduced=r4.renderBudget(1920,1080,2,tier,.72);
    assert.ok(reduced.pixels<=native.pixels,'adaptive downscaling is monotonic');
  }
});

test('R4 GPU queries report data availability honestly',()=>{
  assert.deepEqual(r4.summarizeGpuSamples([]), {available:false,samples:0,p50ms:0,p95ms:0});
  const m=r4.summarizeGpuSamples([2.5,3.1,4.7,6.5,NaN,Infinity,-12,600]);
  assert.equal(m.available,true);
  assert.equal(m.samples,4);
  assert.ok(m.p95ms>=m.p50ms);
  assert.ok(m.p95ms<=6.5);
});

test('R4 architectural LODs are finite, deterministic and under triangle budget',()=>{
  const meshA=r4.sceneGeometry('eco');
  const meshB=r4.sceneGeometry('balanced');
  const meshC=r4.sceneGeometry('cinema');
  assert.ok(meshA.length<meshB.length);
  assert.ok(meshB.length<meshC.length);
  for(const mesh of [meshA,meshB,meshC]){
    assert.equal(mesh.length%33,0);
    assert.ok(mesh.length/33<40000, 'R4 must avoid oversized geometry on mobile/desktop');
    assert.ok(mesh.every(Number.isFinite));
  }
  assert.deepEqual(r4.sceneGeometry('cinema'),meshC,'seeded geometry is reproducible');
});

test('R4 WebGL2 shaders use material BRDF and quarter-res three-pass bloom',()=>{
  const s=fs.readFileSync(path.join(__dirname,'../site/immersive.js'),'utf8');
  for(const token of [
    'smithGGX','brdf(vec3 n','uDetail','valueNoise','uBloomTex',
    'const BLOOM_F','bloomSize=[bw,bh]','quarter_resolution_separable_bloom',
    "gl.getExtension('EXT_disjoint_timer_query_webgl2')",
    "marcosa-graphics-benchmark/v2",
    "tier==='eco'?0:tier==='cinema'?1:.5"
  ])assert.ok(s.includes(token),'R4 shader or instrumentation missing: '+token);
  assert.ok(!s.includes('smoothstep(.54,.23'),'GLSL smoothstep arguments must ascend');
  assert.ok(!s.includes('fetch('),'preview must remain local and non-tracking');
});

test('R4 desktop and mobile UI document physical device acceptance and fallback',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../site/index.html'),'utf8');
  const css=fs.readFileSync(path.join(__dirname,'../site/immersive.css'),'utf8');
  assert.match(html,/MARCOSA R[45]/); // R5 reuses the validated R4 WebGL materials pipeline
  assert.match(html,/GPU \+ FRAME PROFILING/);
  assert.match(html,/Targets are acceptance|figures are acceptance targets/i);
  assert.match(html,/id="mi-benchmark"/);
  assert.match(html,/data-mn-open/);
  assert.match(html,/id="mn-grid"/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/\.mi-material-legend/);
  assert.match(css,/\.mi-test-matrix/);
});
