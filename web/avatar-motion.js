'use strict';

(() => {
  const stage = document.getElementById('meet');
  const figure = document.getElementById('doona-hello');
  const still = document.getElementById('doona-art');
  const canvas = document.getElementById('doona-canvas');
  const control = document.getElementById('motion-control');
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = media.matches;
  let visible = true, frame = 0, last = 0, time = 0, gaze = 0, target = 0, energy = 0;
  let gl, program, positionBuffer, texture, ready = false;
  let uvs, indices, positions;
  const steps = 36;

  function shader(type, code) {
    const item = gl.createShader(type);
    gl.shaderSource(item, code); gl.compileShader(item);
    if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) throw Error('Shader unavailable');
    return item;
  }
  function attribute(name, data, usage) {
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
    const address = gl.getAttribLocation(program,name);
    gl.enableVertexAttribArray(address); gl.vertexAttribPointer(address,2,gl.FLOAT,false,0,0);
    return buffer;
  }
  function initialize() {
    gl = canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,antialias:true,depth:false});
    if (!gl) return;
    program = gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 pos; attribute vec2 uv; varying vec2 tex; void main(){tex=uv;gl_Position=vec4(pos.x*2.-1.,1.-pos.y*2.,0.,1.);}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float; varying vec2 tex; uniform sampler2D portrait; void main(){gl_FragColor=texture2D(portrait,tex);}'));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) return;
    gl.useProgram(program);
    const coords=[], triangles=[];
    for(let y=0;y<=steps;y++) for(let x=0;x<=steps;x++) {
      coords.push(x/steps,y/steps);
      if(x<steps && y<steps) {const i=y*(steps+1)+x;triangles.push(i,i+1,i+steps+1,i+1,i+steps+2,i+steps+1);}
    }
    uvs=new Float32Array(coords); indices=new Uint16Array(triangles);positions=new Float32Array(coords.length);
    attribute('uv',uvs,gl.STATIC_DRAW);positionBuffer=attribute('pos',positions,gl.DYNAMIC_DRAW);
    const mesh=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,mesh);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,indices,gl.STATIC_DRAW);
    texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,p,gl.CLAMP_TO_EDGE);
    for(const p of [gl.TEXTURE_MAG_FILTER,gl.TEXTURE_MIN_FILTER]) gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.clearColor(0,0,0,0);
  }
  function draw() {
    if (!ready) return;
    for(let i=0;i<uvs.length;i+=2) {
      const point=doonaVertex(uvs[i],uvs[i+1],time,gaze,energy,stage.dataset.look);
      positions[i]=point[0];positions[i+1]=point[1];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,positions);
    gl.viewport(0,0,canvas.width,canvas.height);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawElements(gl.TRIANGLES,indices.length,gl.UNSIGNED_SHORT,0);
  }
  function tick(now) {
    frame=0;
    if (!ready || paused || !visible || document.hidden) {last=0;return;}
    if (!last || now-last>=32) {
      time+=last ? Math.min((now-last)/1000,.08) : 0;last=now;
      gaze+=(target-gaze)*.22;energy*=.97;draw();
    }
    frame=requestAnimationFrame(tick);
  }
  function resume() {
    if (!frame && ready && !paused && visible && !document.hidden) frame=requestAnimationFrame(tick);
  }
  function refreshTexture() {
    if (!gl || !texture || !still.complete || !still.naturalWidth || gl.isContextLost()) return;
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,still);
    ready=true;draw();figure.classList.add('mesh-ready');resume();
  }
  function updateControls() {
    control.textContent=paused?'Play motion':'Pause motion';
    figure.classList.toggle('motion-paused',paused);
    if(paused) {time=0;gaze=0;target=0;energy=0;figure.style.removeProperty('--look-x');draw();}
    resume();
  }
  control.onclick=()=>{paused=!paused;updateControls();};
  media.addEventListener('change',e=>{paused=e.matches;updateControls();});
  stage.addEventListener('pointermove',e=>{
    if(e.pointerType==='touch'||paused)return;
    const r=figure.getBoundingClientRect();target=Math.max(-1,Math.min(1,(e.clientX-r.left)/r.width*2-1));
    if(!ready) figure.style.setProperty('--look-x',target*5+'deg');
  });
  stage.addEventListener('pointerleave',()=>{target=0;figure.style.removeProperty('--look-x');});
  stage.addEventListener('doona-react',()=>{
    energy=1;
    if(!paused) figure.animate([{rotate:'0deg'},{rotate:'-2deg',offset:.35},{rotate:'0deg'}],{duration:420});
  });
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();ready=false;figure.classList.remove('mesh-ready');});
  canvas.addEventListener('webglcontextrestored',()=>{initialize();refreshTexture();});
  new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;resume();}).observe(stage);
  document.addEventListener('visibilitychange',resume);
  still.addEventListener('load',refreshTexture);
  try {initialize();refreshTexture();} catch {ready=false;figure.classList.remove('mesh-ready');}
  updateControls();
})();
