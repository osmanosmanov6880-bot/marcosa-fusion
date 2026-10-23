/* MARCOSA Cinematic Environment R3. Static standalone WebGL2, no trackers or external dependencies. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.MarcosaImmersive = api;
    const run = () => api.mount(root.document, root);
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }
})(typeof window !== 'undefined' ? window : undefined, function () {
  'use strict';
  const QUALITY = Object.freeze({eco: {scale:0.68,maxPixels:550000,glow:0,frames:30}, balanced:{scale:1,maxPixels:950000,glow:1,frames:60},cinema:{scale:1.35,maxPixels:1800000,glow:1,frames:60}});
  function chooseQuality(info) {
    if (info.reducedMotion || info.saveData) return 'static';
    if (info.width < 680 || (info.cores && info.cores <= 4) || (info.memory && info.memory <= 2)) return 'eco';
    if (info.width < 1100 || (info.memory && info.memory <= 4)) return 'balanced';
    return 'cinema';
  }
  function percentile(values, pct) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a,b)=>a-b);
    return sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*pct))];
  }
  function summarizeFrames(values) {
    const valid = values.filter(x=>Number.isFinite(x)&&x>0&&x<1000);
    if(!valid.length) return {samples:0,fps:0,p50ms:0,p95ms:0,jankRate:0};
    const sorted=valid.slice().sort((a,b)=>a-b);
    const total=valid.reduce((a,b)=>a+b,0);
    return {samples:valid.length,fps:Math.round((1000*valid.length/total)*10)/10,
      p50ms:Math.round(percentile(sorted,.5)*100)/100,
      p95ms:Math.round(percentile(sorted,.95)*100)/100,
      jankRate:Math.round(valid.filter(x=>x>34).length/valid.length*1000)/10};
  }
  function sceneGeometry(tier) {
    const list=[];let state=19860717;const rnd=()=>{state=(1664525*state+1013904223)>>>0;return state/4294967296;};
    const v=(p,n,c,e,r)=>list.push(...p,...n,...c,e,r);
    const quad=(a,b,c,d,n,color,e=0,r=.45)=>{v(a,n,color,e,r);v(b,n,color,e,r);v(c,n,color,e,r);v(a,n,color,e,r);v(c,n,color,e,r);v(d,n,color,e,r);};
    function box(x,y,z,w,h,d,color,emission=0,rough=.42) {
      if(h<=0||w<=0||d<=0)return;
      const a=x-w/2,b=x+w/2,c=y,f=y+h,g=z-d/2,i=z+d/2;
      quad([a,c,i],[b,c,i],[b,f,i],[a,f,i],[0,0,1],color,emission,rough);
      quad([b,c,g],[a,c,g],[a,f,g],[b,f,g],[0,0,-1],color,emission,rough);
      quad([b,c,i],[b,c,g],[b,f,g],[b,f,i],[1,0,0],color,emission,rough);
      quad([a,c,g],[a,c,i],[a,f,i],[a,f,g],[-1,0,0],color,emission,rough);
      quad([a,f,i],[b,f,i],[b,f,g],[a,f,g],[0,1,0],color,emission,rough);
    }
    // Basalt foundation, polished plazas, metallic inlays and light paths.
    box(0,-.3,0,31,.24,29,[.055,.086,.11],0,.7);
    box(0,-.055,0,10,.035,10,[.15,.19,.21],0,.17);
    for(let k=-5;k<=5;k++){
      box(k*2.5,-.047,0,.018,.007,29,[.18,.46,.5],.37,.3);
      box(0,-.046,k*2.5,31,.008,.018,[.19,.42,.46],.3,.3);
    }
    box(0,0,0,4,.27,4,[.19,.25,.27],0,.27);
    box(0,.27,0,3.25,.21,3.25,[.34,.36,.34],0,.22);
    box(0,.48,0,1.34,5.35,1.34,[.19,.29,.33],0,.12);
    for(let j=0;j<15;j++){
      const y=.65+j*.33;
      box(0,y,0,1.43,.033,1.43,[.28,.68,.72],.25,.18);
    }
    box(0,5.83,0,1.6,.22,1.6,[.65,.51,.29],.5,.17);
    box(0,6.05,0,.23,1.9,.23,[.64,.82,.88],.95,.1);
    // Ringed beacon: architectural halo geometry with emissive metal edges.
    for(let layer=0;layer<3;layer++){
      const y=.7+layer*1.85,rad=1.85+layer*.15;
      for(let a=0;a<48;a++){
        const t=a*2*Math.PI/48,u=(a+1)*2*Math.PI/48;
        const outer=.07;
        quad([Math.cos(t)*rad,y,Math.sin(t)*rad],[Math.cos(u)*rad,y,Math.sin(u)*rad],
          [Math.cos(u)*(rad+outer),y,Math.sin(u)*(rad+outer)],[Math.cos(t)*(rad+outer),y,Math.sin(t)*(rad+outer)],
          [0,1,0],[.29,.7,.77],.62,.11);
      }
    }
    // A seeded, non-random-at-runtime skyline. Facade geometry represents hundreds of glass panels.
    const density=tier==='eco'?2:3;
    for(let xi=-5;xi<=5;xi++)for(let zi=-4;zi<=4;zi++){
      if(Math.abs(xi)<2&&Math.abs(zi)<2)continue;
      if((Math.abs(xi)===5||Math.abs(zi)===4)&&rnd()<.18)continue;
      if(tier==='eco' && ((Math.abs(xi)+Math.abs(zi))%3===0))continue;
      const x=xi*2.55+(rnd()-.5)*.3,z=zi*2.72+(rnd()-.5)*.25;
      const w=.95+rnd()*.7,d=.9+rnd()*.7,h=1.8+Math.pow(rnd(),.5)*7.8;
      const tint=.73+rnd()*.27;
      const body=[(.09+rnd()*.06)*tint,(.16+rnd()*.07)*tint,(.23+rnd()*.08)*tint];
      box(x,.04,z,w,h,d,body,0,.12+rnd()*.14);
      box(x,h+.04,z,w+.12,.09,d+.12,[.34,.42,.43],.04,.37);
      if(h>5&&rnd()>.35)box(x,h+.14,z,.05,.55,.05,[.35,.7,.72],.35,.28);
      const floors=Math.min(17,Math.floor(h/.51));
      const cols=tier==='eco'?2:Math.max(3,Math.floor(w/.3));
      for(let row=0;row<floors;row++)for(let col=0;col<cols;col++){
        if(row%density===0&&rnd()<.09)continue;
        const px=x-w*.5 + (col+.5)*w/cols,py=.35+row*(h-.42)/floors;
        const width=w/cols*.68,height=Math.max(.085,(h-.55)/floors*.51);
        const light=rnd()>.63;
        const c=light?[.27+rnd()*.3,.51+rnd()*.27,.57+rnd()*.34]:[.10,.21,.28];
        const glow=light?.22+rnd()*.52:.025;
        quad([px-width/2,py,z+d/2+.008],[px+width/2,py,z+d/2+.008],
          [px+width/2,py+height,z+d/2+.008],[px-width/2,py+height,z+d/2+.008],
          [0,0,1],c,glow,.06);
        if(tier!=='eco'){
          const pz=z-d*.5+(col+.5)*d/cols;
          quad([x+w/2+.009,py,pz-width/2],[x+w/2+.009,py,pz+width/2],
            [x+w/2+.009,py+height,pz+width/2],[x+w/2+.009,py+height,pz-width/2],
            [1,0,0],c,glow*.66,.07);
        }
      }
      // Ground-floor luminous door, facade columns and overhangs.
      box(x,.05,z+d*.53,.15,.43,.025,[.32,.68,.65],.55,.08);
      if(tier!=='eco') for(let k=-1;k<=1;k++)box(x+k*w*.28,.08,z+d*.51,.026,h-.25,.025,[.27,.36,.42],.02,.26);
    }
    // Elevated bridges and pedestrian light guide rails.
    for(let s of [-1,1]){
      box(s*7.1,2.2,-.4,.25,.16,7.4,[.22,.34,.38],.03,.33);
      box(s*7.1,2.4,-.4,.055,.055,7.4,[.35,.82,.79],.65,.14);
    }
    return new Float32Array(list);
  }
  const VERT=`#version 300 es
  precision highp float;
  layout(location=0) in vec3 aPos;
  layout(location=1) in vec3 aNormal;
  layout(location=2) in vec3 aColor;
  layout(location=3) in float aEmission;
  layout(location=4) in float aRough;
  uniform mat4 uPV;
  out vec3 vWorld;out vec3 vNormal;out vec3 vColor;out float vEmission;out float vRough;
  void main(){vWorld=aPos;vNormal=aNormal;vColor=aColor;vEmission=aEmission;vRough=aRough;gl_Position=uPV*vec4(aPos,1.);}`;
  const FRAG=`#version 300 es
  precision highp float;
  in vec3 vWorld;in vec3 vNormal;in vec3 vColor;in float vEmission;in float vRough;
  uniform vec3 uEye;uniform float uTime;
  out vec4 outColor;
  void main(){
    vec3 n=normalize(vNormal),v=normalize(uEye-vWorld),l=normalize(vec3(-.48,.89,.5));
    float ndl=max(dot(n,l),0.);float ambient=.22+.09*n.y;
    vec3 h=normalize(l+v);
    float spec=pow(max(dot(h,n),0.),mix(92.,10.,vRough))*(1.-vRough*.7);
    float fresnel=pow(1.-max(dot(n,v),0.),5.);
    float sky=.5+.5*n.y;
    vec3 base=vColor*(ambient+ndl*.87);
    base+=vec3(.91,.7,.39)*spec*.72+vec3(.19,.39,.43)*fresnel*(1.-vRough);
    base+=vEmission*(.78+.12*sin(uTime*.8+vWorld.x*.35))*vec3(.30,.89,1.12);
    float dist=distance(uEye,vWorld);
    float fog=1.-exp(-.0012*dist*dist);
    outColor=vec4(mix(base,vec3(.06,.12,.19)+vec3(.08,.06,.03)*sky,min(.83,fog)),1.);
  }`;
  const SCREEN_V=`#version 300 es
    precision highp float;
    const vec2 vertices[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));
    out vec2 uv;
    void main(){vec2 p=vertices[gl_VertexID];uv=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
  const SKY_F=`#version 300 es
    precision highp float;in vec2 uv;uniform float uTime;out vec4 outColor;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    void main(){
      vec3 horizon=vec3(.12,.17,.20),zenith=vec3(.008,.017,.038);
      vec3 sky=mix(horizon,zenith,smoothstep(.02,1.,uv.y));
      float glow=exp(-pow((uv.x-.78)*3.4,2.)-pow((uv.y-.50)*9.,2.));
      sky+=glow*vec3(.37,.23,.09);
      float haze=exp(-pow((uv.y-.4)*13.,2.));
      sky+=haze*vec3(.05,.10,.13);
      float stars=step(.99978,hash(floor(uv*vec2(1300.,640.))))*(.5+.5*hash(floor(uv*vec2(320.,210.))));
      sky+=stars*vec3(.42,.58,.66)*smoothstep(.55,.9,uv.y);
      outColor=vec4(sky,1.);
    }`;
  const POST_F=`#version 300 es
    precision highp float;in vec2 uv;uniform sampler2D uScene;uniform vec2 uSize;uniform float uTime;uniform float uBloom;out vec4 outColor;
    vec3 bloom(vec2 p,vec2 k){vec3 c=max(texture(uScene,p).rgb-.52,0.);
      c+=max(texture(uScene,p+vec2(k.x,0.)).rgb-.52,0.);
      c+=max(texture(uScene,p-vec2(k.x,0.)).rgb-.52,0.);
      c+=max(texture(uScene,p+vec2(0.,k.y)).rgb-.52,0.);
      c+=max(texture(uScene,p-vec2(0.,k.y)).rgb-.52,0.);
      c+=max(texture(uScene,p+vec2(k.x,k.y)).rgb-.52,0.);
      c+=max(texture(uScene,p-vec2(k.x,k.y)).rgb-.52,0.);
      return c/7.;}
    void main(){
      vec2 k=vec2(5.)/uSize;vec3 c=texture(uScene,uv).rgb;
      if(uBloom>.5)c+=bloom(uv,k)*.55+bloom(uv,k*3.)*.3;
      c=max(c,0.);c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);
      float vig=1.-.45*pow(length((uv-.5)*vec2(1.17,1.)),1.75);
      float grain=(fract(sin(dot(uv*uSize+uTime,vec2(12.9898,78.233)))*43758.5453)-.5)*.012;
      outColor=vec4(pow(clamp(c*vig+grain,0.,1.),vec3(.94)),1.);
    }`;
  function perspective(fov,aspect,n,f){const t=1/Math.tan(fov/2);return new Float32Array([t/aspect,0,0,0,0,t,0,0,0,0,(f+n)/(n-f),-1,0,0,2*f*n/(n-f),0]);}
  function sub(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function dot(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function cross(a,b){return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];}
  function norm(v){const n=Math.sqrt(dot(v,v))||1;return v.map(x=>x/n);}
  function viewMatrix(eye,at){const z=norm(sub(eye,at)),x=norm(cross([0,1,0],z)),y=cross(z,x);return new Float32Array([
    x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);}
  function mul(a,b){const m=new Float32Array(16);for(let col=0;col<4;col++)for(let row=0;row<4;row++){let value=0;for(let k=0;k<4;k++)value+=a[k*4+row]*b[col*4+k];m[col*4+row]=value;}return m;}
  function mount(doc,win){
    const canvas=doc.getElementById('mi-world-canvas');if(!canvas)return null;
    const wrap=doc.getElementById('mi-stage');const fpsNode=doc.getElementById('mi-fps');const statusNode=doc.getElementById('mi-quality-status');
    const output=doc.getElementById('mi-diagnostic-output');const benchButton=doc.getElementById('mi-benchmark');const downloadButton=doc.getElementById('mi-report');
    const qualityButton=doc.getElementById('mi-quality');const modal=doc.getElementById('mn-dialog');
    const nav=win.navigator||{};const reduced=win.matchMedia?.('(prefers-reduced-motion: reduce)').matches||false;
    const saveData=nav.connection?.saveData===true;
    const profile={width:win.innerWidth,cores:nav.hardwareConcurrency||0,memory:nav.deviceMemory||0,reducedMotion:reduced,saveData};
    let mode='auto',tier=chooseQuality(profile),gl=null,sceneProgram,skyProgram,postProgram,vbo,vao,screenVao,fb,fbColor,depth,count=0;
    let shaderLoc=null; const geometryCache=new Map();
    let active=false,visible=true,raf=0,last=0,frames=[],bench=null,lastReport=null,resizeObserver=null,glError=null,failures=0;
    let pointer=[0,0],smoothed=[0,0],targetPixels=[1,1],frameN=0,rendered=0,lastHud=0,slowWindows=0;
    const fixedFrame=t=>t==='eco'?1000/30:1000/60;
    function qualityText(){return tier==='static'?'2D / ACCESSIBLE':tier.toUpperCase();}
    function ui(){statusNode.textContent=qualityText();qualityButton.textContent='QUALITY  /  '+mode.toUpperCase();qualityButton.setAttribute('aria-label','Graphics quality: '+mode);}
    function makeShader(type,source){const sh=gl.createShader(type);gl.shaderSource(sh,source);gl.compileShader(sh);if(!gl.getShaderParameter(sh,gl.COMPILE_STATUS)){const err=gl.getShaderInfoLog(sh);gl.deleteShader(sh);throw Error('WebGL shader compile: '+err);}return sh;}
    function program(a,b){const v=makeShader(gl.VERTEX_SHADER,a),f=makeShader(gl.FRAGMENT_SHADER,b),p=gl.createProgram();gl.attachShader(p,v);gl.attachShader(p,f);gl.linkProgram(p);gl.deleteShader(v);gl.deleteShader(f);if(!gl.getProgramParameter(p,gl.LINK_STATUS)){const e=gl.getProgramInfoLog(p);gl.deleteProgram(p);throw Error('WebGL link: '+e);}return p;}
    function freeTargets(){if(fb)gl.deleteFramebuffer(fb);if(fbColor)gl.deleteTexture(fbColor);if(depth)gl.deleteRenderbuffer(depth);fb=fbColor=depth=null;}
    function setupTargets(w,h){freeTargets();fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
      fbColor=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,fbColor);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,fbColor,0);
      depth=gl.createRenderbuffer();gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,w,h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('Incomplete render target');
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    }
    function resize(){if(!gl||tier==='static')return;
      const rect=wrap.getBoundingClientRect();if(rect.width<20||rect.height<20)return;
      const q=QUALITY[tier]||QUALITY.eco;let scale=Math.min(q.scale,win.devicePixelRatio||1.0),w=Math.max(2,Math.round(rect.width*scale)),h=Math.max(2,Math.round(rect.height*scale));
      const multiplier=Math.min(1,Math.sqrt(q.maxPixels/(w*h)));w=Math.max(2,Math.floor(w*multiplier));h=Math.max(2,Math.floor(h*multiplier));
      if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;setupTargets(w,h);}targetPixels=[w,h];
    }
    function geometryUpload(){let data=geometryCache.get(tier);if(!data){data=sceneGeometry(tier);geometryCache.set(tier,data);}
      if(vbo)gl.deleteBuffer(vbo);if(vao)gl.deleteVertexArray(vao);
      vbo=gl.createBuffer();vao=gl.createVertexArray();gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,vbo);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
      for(const [index,size,offset] of [[0,3,0],[1,3,12],[2,3,24],[3,1,36],[4,1,40]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,size,gl.FLOAT,false,44,offset);}
      gl.bindVertexArray(null);count=data.length/11;
    }
    function initialize(){if(tier==='static')return false;
      gl=canvas.getContext('webgl2',{alpha:false,antialias:false,depth:true,stencil:false,powerPreference:'high-performance'});
      if(!gl)return false;
      sceneProgram=program(VERT,FRAG);skyProgram=program(SCREEN_V,SKY_F);postProgram=program(SCREEN_V,POST_F);
      shaderLoc={
        scene:{pv:gl.getUniformLocation(sceneProgram,'uPV'),eye:gl.getUniformLocation(sceneProgram,'uEye'),time:gl.getUniformLocation(sceneProgram,'uTime')},
        sky:{time:gl.getUniformLocation(skyProgram,'uTime')},
        post:{scene:gl.getUniformLocation(postProgram,'uScene'),size:gl.getUniformLocation(postProgram,'uSize'),time:gl.getUniformLocation(postProgram,'uTime'),bloom:gl.getUniformLocation(postProgram,'uBloom')}
      };
      screenVao=gl.createVertexArray();geometryUpload();resize();canvas.classList.add('mi-ready');wrap.classList.add('mi-webgl-active');return true;
    }
    function draw(now){
      const t=now*.001;const w=canvas.width,h=canvas.height;
      smoothed[0]+=(pointer[0]-smoothed[0])*.02;smoothed[1]+=(pointer[1]-smoothed[1])*.02;
      const cam=[19.5+Math.sin(t*.09)*1.7+smoothed[0]*2.6,14.5+smoothed[1]*2,21.5+Math.cos(t*.09)*2];
      const pv=mul(perspective(Math.PI/4,w/h,.1,95),viewMatrix(cam,[0,2.5,0]));
      gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.viewport(0,0,w,h);gl.disable(gl.DEPTH_TEST);gl.useProgram(skyProgram);gl.bindVertexArray(screenVao);
      gl.uniform1f(shaderLoc.sky.time,t);gl.drawArrays(gl.TRIANGLES,0,3);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LESS);gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(sceneProgram);gl.bindVertexArray(vao);
      gl.uniformMatrix4fv(shaderLoc.scene.pv,false,pv);gl.uniform3fv(shaderLoc.scene.eye,cam);
      gl.uniform1f(shaderLoc.scene.time,t);gl.drawArrays(gl.TRIANGLES,0,count);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.DEPTH_TEST);gl.viewport(0,0,w,h);gl.useProgram(postProgram);gl.bindVertexArray(screenVao);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,fbColor);gl.uniform1i(shaderLoc.post.scene,0);
      gl.uniform2f(shaderLoc.post.size,w,h);gl.uniform1f(shaderLoc.post.time,t);
      gl.uniform1f(shaderLoc.post.bloom,QUALITY[tier].glow);gl.drawArrays(gl.TRIANGLES,0,3);
      gl.bindVertexArray(null);
    }
    function enabled(){return Boolean(gl&&visible&&!doc.hidden&&!modal?.open&&tier!=='static');}
    function loop(ts){raf=0;if(!enabled()){active=false;return;}
      if(last && ts-last<fixedFrame(tier)*.9){raf=win.requestAnimationFrame(loop);return;}
      const elapsed=last?Math.min(500,ts-last):0;last=ts;
      if(elapsed>0&&elapsed<250){frames.push(elapsed);if(frames.length>180)frames.shift();if(bench)bench.samples.push(elapsed);}
      draw(ts);rendered++;
      if(ts-lastHud>1500){lastHud=ts;const report=summarizeFrames(frames.slice(-90));fpsNode.textContent=report.fps?Math.round(report.fps)+' FPS':'-- FPS';
        if(mode==='auto'&&frames.length>=85&&tier!=='eco'){
          // Lower quality only after sustained under-performance, never oscillate in one sampling window.
          slowWindows=report.fps<38?slowWindows+1:0;
          if(slowWindows>=3){tier=tier==='cinema'?'balanced':'eco';slowWindows=0;frames=[];geometryUpload();resize();ui();}
        }
      }
      if(bench && ts>=bench.deadline){finishBenchmark();}
      raf=win.requestAnimationFrame(loop);
    }
    function start(){if(enabled()&&!raf){active=true;last=0;raf=win.requestAnimationFrame(loop);} }
    function stop(){if(raf)win.cancelAnimationFrame(raf);raf=0;active=false;last=0;}
    function setMode(value){mode=value;const next=value==='auto'?chooseQuality({...profile,width:win.innerWidth}):value==='off'?'static':value==='high'?'cinema':'eco';
      if(next===tier){ui();return;}tier=next;stop();frames=[];
      if(tier!=='static'){if(!gl){try{if(!initialize())tier='static';}catch(e){glError=String(e);tier='static';}}else{geometryUpload();resize();}}
      wrap.classList.toggle('mi-webgl-active',tier!=='static'&&!!gl);ui();start();
    }
    function finishBenchmark(){if(!bench)return;const report=summarizeFrames(bench.samples);const duration=Date.now()-bench.started;
      lastReport={schema:'marcosa-graphics-benchmark/v1',timestamp:new Date().toISOString(),mode,tier,source:'local_device_only',
        browser_viewport:{width:win.innerWidth,height:win.innerHeight},canvas_resolution:targetPixels,
        duration_ms:duration,draw_calls_per_frame:3,triangles_per_frame:count/3+2,metrics:report,
        notes:'Measured by requestAnimationFrame on this browser; no server transmission. GPU times and thermals are not measured.'};
      output.textContent='FPS '+report.fps+' | p95 '+report.p95ms+' ms | slow frames '+report.jankRate+'%';
      downloadButton.disabled=false;benchButton.disabled=false;bench=null;
    }
    function benchmark(){if(bench||tier==='static'){output.textContent=tier==='static'?'3D disabled: enable a graphics mode to measure.':'Test already running.';return;}
      bench={started:Date.now(),deadline:win.performance.now()+12000,samples:[]};benchButton.disabled=true;output.textContent='Testing locally for 12 seconds...';start();
    }
    function downloadReport(){if(!lastReport)return;const blob=new Blob([JSON.stringify(lastReport,null,2)+'\n'],{type:'application/json'});
      const url=URL.createObjectURL(blob),a=doc.createElement('a');a.href=url;a.download='marcosa-graphics-device-report.json';doc.body.append(a);a.click();a.remove();win.setTimeout(()=>URL.revokeObjectURL(url),1500);
    }
    const io=win.IntersectionObserver?new win.IntersectionObserver(items=>{visible=items.some(x=>x.isIntersecting);visible?start():stop();},{threshold:.03}):null;
    if(io)io.observe(wrap);doc.addEventListener('visibilitychange',()=>{doc.hidden?stop():start();});
    if(win.ResizeObserver){resizeObserver=new win.ResizeObserver(()=>{resize();});resizeObserver.observe(wrap);}
    win.addEventListener('resize',()=>{profile.width=win.innerWidth;resize();},{passive:true});
    wrap.addEventListener('pointermove',ev=>{const rect=wrap.getBoundingClientRect();pointer=[((ev.clientX-rect.left)/rect.width-.5)*2,((ev.clientY-rect.top)/rect.height-.5)*2];},{passive:true});
    wrap.addEventListener('pointerleave',()=>{pointer=[0,0];},{passive:true});
    if(modal && win.MutationObserver){new win.MutationObserver(()=>{modal.open?stop():start();}).observe(modal,{attributes:true,attributeFilter:['open']});}
    qualityButton.addEventListener('click',()=>{const modes=['auto','high','eco','off'];setMode(modes[(modes.indexOf(mode)+1)%modes.length]);});
    benchButton.addEventListener('click',benchmark);downloadButton.addEventListener('click',downloadReport);
    canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();stop();wrap.classList.remove('mi-webgl-active');output.textContent='Graphics context lost. 2D fallback remains available.';});
    canvas.addEventListener('webglcontextrestored',()=>{gl=null;try{if(initialize())start();}catch(e){glError=String(e);wrap.classList.remove('mi-webgl-active');}});
    try{if(!initialize()){tier='static';statusNode.textContent='2D FALLBACK';}}catch(e){glError=String(e);tier='static';}
    if(tier==='static'){wrap.classList.remove('mi-webgl-active');output.textContent=reduced?'Reduced motion: static view.':saveData?'Data saver: static view.':glError||'WebGL2 unavailable: static view.';}
    ui();start();
    return Object.freeze({get quality(){return tier;},setMode,benchmark,get lastReport(){return lastReport;},stop});
  }
  return Object.freeze({chooseQuality,summarizeFrames,sceneGeometry,mount});
});