/*
 * Knowledge ocean visual system
 * - CONFIG is the single place for camera, particle and liquid parameters.
 * - One requestAnimationFrame loop updates the ocean, all orbs and transitions.
 * - Course content and detail rendering remain in knowledge-map.js.
 */
'use strict';

import * as THREE from './vendor/three/three.module.min.js';
import {KnowledgeMap as StaticKnowledgeMap} from './knowledge-map.js?v=structure-v1';

const CONFIG = Object.freeze({
  camera: {
    position: new THREE.Vector3(0, 11.5, 24),
    target: new THREE.Vector3(0, 0.5, -15),
    fov: 43,
    focusDistance: 5.4,
    transitionMs: 1250,
    minRadius: 25,
    maxRadius: 56,
    minPitch: 0.08,
    maxPitch: 0.62,
  },
  ocean: {
    desktopGrid: [176, 100],
    mobileGrid: [104, 60],
    width: 176,
    depth: 160,
    nearZ: 24,
    level: -3.25,
    waveHeight: 0.72,
    speed: 0.18,
    pointSize: 2.15,
  },
  liquid: {
    waveStrength: 0.10,
    waveSpeed: 0.20,
    waveFrequency: 2.0,
    roughness: 0.11,
    transmission: 0.37,
    ior: 1.0,
    dispersion: 0.9,
  },
  clusterRing: {centerX:0,centerZ:-15,radiusX:18,radiusZ:12.2,startAngle:-Math.PI/2},
  revolution: {
    angularSpeed:0.025,
    dragSensitivity:0.003,
    tiltSensitivity:0.0017,
    tiltLimit:Math.PI / 10,
    oceanClearance:0.2,
    resumeDelayMs:1000,
  },
  unitColors: ['#8fc9ff','#9fdbca','#c0b7ef','#e4bf9a','#91d6df','#deb3c7','#abb9e8','#d4cf9d'],
});

const ORB_VERTEX = `
  uniform float uTime;
  uniform float uWaveStrength;
  uniform float uWaveFrequency;
  uniform float uWaveSpeed;
  uniform float uFocus;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;
  varying float vDisplacement;

  float liquidWave(vec3 p, float t) {
    float a = sin((p.x + p.y * .45) * uWaveFrequency + t * uWaveSpeed * 6.0);
    float b = sin((p.z - p.y * .62) * (uWaveFrequency * 1.37) - t * uWaveSpeed * 4.5);
    float c = sin((p.x + p.z) * (uWaveFrequency * .71) + t * uWaveSpeed * 3.2);
    return (a + b * .72 + c * .48) / 2.2;
  }

  void main() {
    float displacement = liquidWave(position, uTime) * uWaveStrength * (1.0 + uFocus * .32);
    vec3 transformed = position + normal * displacement;
    vec4 world = modelMatrix * vec4(transformed, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - world.xyz);
    vDisplacement = displacement;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ORB_FRAGMENT = `
  uniform float uTime;
  uniform float uOpacity;
  uniform float uFocus;
  uniform float uDispersion;
  uniform float uTransmission;
  uniform vec3 uTint;
  uniform vec2 uResolution;
  uniform sampler2D uSceneTexture;
  uniform float uUseRefraction;
  varying vec3 vWorldNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDirection;
  varying float vDisplacement;

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(vViewDirection);
    float facing = clamp(dot(normal, viewDirection), 0.0, 1.0);
    float fresnel = pow(1.0 - facing, 2.35);
    vec2 uv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
    vec2 bend = normal.xy * (0.011 + fresnel * 0.020) * (0.7 + uTransmission);
    float split = 0.0034 * uDispersion;
    vec3 refracted;
    refracted.r = texture2D(uSceneTexture, clamp(uv + bend * (1.0 + split * 7.0), 0.002, 0.998)).r;
    refracted.g = texture2D(uSceneTexture, clamp(uv + bend, 0.002, 0.998)).g;
    refracted.b = texture2D(uSceneTexture, clamp(uv + bend * (1.0 - split * 7.0), 0.002, 0.998)).b;

    float spectrumPhase = dot(normal, vec3(.48,.72,.36)) * 5.6 + uTime * .08 + vDisplacement * 12.0;
    vec3 spectrum = .5 + .5 * cos(spectrumPhase + vec3(0.0, 2.1, 4.2));
    vec3 fallback = mix(vec3(.025,.07,.12), uTint, .32) + spectrum * .10;
    vec3 through = mix(fallback, refracted, uUseRefraction * .82);
    vec3 rim = mix(vec3(.72,.88,1.0), spectrum, .26 * uDispersion);
    float softHighlight = pow(max(dot(normal, normalize(vec3(-.45,.72,.52))), 0.0), 12.0);
    vec3 color = mix(through, rim, .16 + fresnel * .68);
    color += vec3(1.0,.985,.96) * softHighlight * .72;
    color += uTint * (uFocus * .10);
    float alpha = (0.34 + fresnel * .51 + softHighlight * .18) * uOpacity;
    gl_FragColor = vec4(color, clamp(alpha, 0.0, .94));
  }
`;

const OCEAN_VERTEX = `
  uniform float uTime;
  uniform vec2 uPointer;
  uniform float uWaveHeight;
  uniform float uSpeed;
  uniform float uPointSize;
  uniform float uHalfWidth;
  uniform float uNearZ;
  uniform float uFarZ;
  varying float vGlow;
  varying float vDepth;
  varying float vEdgeFade;

  void main() {
    vec3 p = position;
    float t = uTime * uSpeed;
    float longWave = sin(p.x * .23 + t * 2.1) * .46 + sin(p.z * .18 - t * 1.5) * .34;
    float crossWave = sin((p.x + p.z) * .115 + t) * .24;
    float pointerWave = exp(-length(p.xz - vec2(uPointer.x * 12.0, -9.0 - uPointer.y * 8.0)) * .10) * .12;
    p.y += (longWave + crossWave + pointerWave) * uWaveHeight;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    float perspective = clamp(68.0 / max(8.0, -mv.z), .72, 3.2);
    gl_PointSize = uPointSize * perspective;
    vGlow = .54 + (longWave + .8) * .22;
    float range = max(1.0, uNearZ - uFarZ);
    float sideFade = 1.0 - smoothstep(uHalfWidth * .80, uHalfWidth * .98, abs(p.x));
    float farFade = smoothstep(uFarZ, uFarZ + range * .17, p.z);
    float nearFade = 1.0 - smoothstep(uNearZ - range * .055, uNearZ, p.z);
    vDepth = smoothstep(.04, .72, (p.z - uFarZ) / range);
    vEdgeFade = sideFade * farFade * nearFade;
    gl_Position = projectionMatrix * mv;
  }
`;

const OCEAN_FRAGMENT = `
  varying float vGlow;
  varying float vDepth;
  varying float vEdgeFade;
  void main() {
    vec2 p = gl_PointCoord - .5;
    float distanceToCenter = length(p);
    if (distanceToCenter > .5) discard;
    float alpha = smoothstep(.5,.08,distanceToCenter) * (.18 + vGlow * .50) * (.14 + vDepth * .86) * vEdgeFade;
    vec3 color = mix(vec3(.16,.37,.55), vec3(.67,.88,1.0), vGlow);
    gl_FragColor = vec4(color, alpha);
  }
`;

export class LiquidKnowledgeScene extends StaticKnowledgeMap {
  constructor(options) {
    super(options);
    this.sceneReady = false;
    this.webglFailed = false;
    this.active = false;
    this.raf = 0;
    this.focusId = null;
    this.visualFocusId = null;
    this.focusAmount = 0;
    this.transition = null;
    this.hoverId = null;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.lowPower = matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
    this.defaultCamera = CONFIG.camera.position.clone();
    this.defaultTarget = CONFIG.camera.target.clone();
    this.cameraTarget = this.defaultTarget.clone();
    const orbitOffset=this.defaultCamera.clone().sub(this.defaultTarget);
    this.orbitRadius=orbitOffset.length();
    this.orbitYaw=Math.atan2(orbitOffset.x,orbitOffset.z);
    this.orbitPitch=Math.asin(orbitOffset.y/this.orbitRadius);
    this.defaultOrbit={radius:this.orbitRadius,yaw:this.orbitYaw,pitch:this.orbitPitch};
    this.savedView = null;
    this.orbitPhase = 0;
    this.fieldYaw = 0;
    this.fieldTilt = 0;
    this.isDragging = false;
    this.resumeOrbitAt = 0;
    this.elapsedSeconds = 0;
    this.lastFrameTime = null;
    this.fieldCenter = new THREE.Vector3(CONFIG.clusterRing.centerX, 0.5, CONFIG.clusterRing.centerZ);
    this.pointer = new THREE.Vector2();
    this.raycaster = new THREE.Raycaster();
    this.$('map-back').onclick = () => this.close();
    this.$('map-reset').onclick = () => this.resetView();
    this.reducedMotion.addEventListener('change', () => this.requestFrame());
    document.addEventListener('visibilitychange', () => document.hidden ? this.stop() : this.start());
  }

  load(items, relations) {
    super.load(items, relations);
    if (!this.sceneReady && !this.webglFailed) this.createScene();
    if (this.sceneReady) {
      this.buildKnowledgeField();
      this.filter(false);
    }
  }

  createScene() {
    const canvas = document.createElement('canvas');
    canvas.className = 'knowledge-canvas';
    canvas.setAttribute('aria-hidden','true');
    try {
      this.renderer = new THREE.WebGLRenderer({canvas, antialias:!this.lowPower, alpha:false, powerPreference:this.lowPower?'low-power':'high-performance'});
    } catch (error) {
      this.webglFailed = true;
      this.$('map-message').textContent = '当前浏览器不支持 WebGL，已切换为静态知识地图。';
      this.$('map-message').hidden = false;
      this.viewport.classList.add('map-fallback');
      return;
    }

    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.lowPower ? 1 : 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(0x030813,1);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030813);
    this.scene.fog = new THREE.FogExp2(0x030813, .021);
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov,1,.1,120);
    this.camera.position.copy(this.defaultCamera);
    this.camera.lookAt(this.defaultTarget);
    this.world3d = new THREE.Group();
    this.scene.add(this.world3d);
    this.createOcean();
    this.createOrbs();
    this.lineGroup = new THREE.Group();
    this.world3d.add(this.lineGroup);

    this.refractionTarget = new THREE.WebGLRenderTarget(1,1,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
    this.orbMaterials.forEach(material => material.uniforms.uSceneTexture.value = this.refractionTarget.texture);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'scene-labels';
    this.viewport.prepend(canvas, this.labelLayer);
    this.viewport.classList.add('webgl-ready');
    this.bindSceneEvents(canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.viewport);
    this.sceneReady = true;
    this.resize();
  }

  createOcean() {
    const [columns, rows] = this.lowPower ? CONFIG.ocean.mobileGrid : CONFIG.ocean.desktopGrid;
    const positions = new Float32Array(columns * rows * 3);
    let cursor = 0;
    const farZ=CONFIG.ocean.nearZ-CONFIG.ocean.depth;
    for (let row=0; row<rows; row++) {
      const z = CONFIG.ocean.nearZ - (row/(rows-1))*CONFIG.ocean.depth;
      for (let column=0; column<columns; column++) {
        positions[cursor++] = -CONFIG.ocean.width/2 + (column/(columns-1))*CONFIG.ocean.width;
        positions[cursor++] = CONFIG.ocean.level;
        positions[cursor++] = z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
    this.oceanUniforms = {
      uTime:{value:0}, uPointer:{value:new THREE.Vector2()},
      uWaveHeight:{value:CONFIG.ocean.waveHeight}, uSpeed:{value:CONFIG.ocean.speed},
      uPointSize:{value:CONFIG.ocean.pointSize * (this.lowPower?1.15:1)},
      uHalfWidth:{value:CONFIG.ocean.width/2},uNearZ:{value:CONFIG.ocean.nearZ},uFarZ:{value:farZ},
    };
    const material = new THREE.ShaderMaterial({
      uniforms:this.oceanUniforms, vertexShader:OCEAN_VERTEX, fragmentShader:OCEAN_FRAGMENT,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
    });
    this.ocean = new THREE.Points(geometry,material);
    this.world3d.add(this.ocean);
    this.particleCount = columns*rows;
  }

  createOrbs() {
    this.orbGroup = new THREE.Group();
    this.world3d.add(this.orbGroup);
    this.orbGeometry = new THREE.IcosahedronGeometry(1, this.lowPower ? 3 : 4);
    this.orbSlots = [];
    this.orbMaterials = [];
  }

  createOrbMaterial(unitIndex) {
    return new THREE.ShaderMaterial({
        vertexShader:ORB_VERTEX, fragmentShader:ORB_FRAGMENT, transparent:true,
        depthWrite:false, side:THREE.FrontSide,
        uniforms:{
          uTime:{value:0},uWaveStrength:{value:CONFIG.liquid.waveStrength},uWaveFrequency:{value:CONFIG.liquid.waveFrequency},
          uWaveSpeed:{value:CONFIG.liquid.waveSpeed},uFocus:{value:0},uOpacity:{value:1},
          uDispersion:{value:CONFIG.liquid.dispersion},uTransmission:{value:CONFIG.liquid.transmission},
          uTint:{value:new THREE.Color(CONFIG.unitColors[unitIndex])},uResolution:{value:new THREE.Vector2(1,1)},
          uSceneTexture:{value:this.refractionTarget?.texture || null},uUseRefraction:{value:this.lowPower?0:1},
        },
      });
  }

  buildKnowledgeField() {
    this.orbSlots.forEach(slot=>slot.material.dispose());
    this.orbGroup.clear();
    this.orbSlots=[];this.orbMaterials=[];this.labelLayer.replaceChildren();
    const groups=this.units.map(unit=>this.items.filter(item=>item.chapter===unit));
    groups.forEach((group,unitIndex)=>{
      const ring=CONFIG.clusterRing;
      const groupAngle=ring.startAngle+(Math.PI*2*unitIndex/this.units.length);
      const centerX=ring.centerX+Math.cos(groupAngle)*ring.radiusX;
      const centerZ=ring.centerZ+Math.sin(groupAngle)*ring.radiusZ;
      const radius=group.length<=4?2.65:group.length<=6?3.45:4.35;
      group.forEach((item,index)=>{
        const angle=(Math.PI*2*index/group.length)+groupAngle*.36;
        const base=new THREE.Vector3(
          centerX+Math.cos(angle)*radius,
          -.25+(index%3)*.72+Math.sin(angle*1.7)*.24,
          centerZ+Math.sin(angle)*radius,
        );
        const degree=this.edges.filter(edge=>edge.from===item.id||edge.to===item.id).length;
        const baseScale=.78+Math.min(degree,9)*.045;
        const material=this.createOrbMaterial(unitIndex);
        const mesh=new THREE.Mesh(this.orbGeometry,material);
        mesh.position.copy(base);mesh.scale.setScalar(baseScale);
        mesh.userData.knowledgeId=item.id;
        this.orbGroup.add(mesh);this.orbMaterials.push(material);
        const label=document.createElement('button');
        label.type='button';label.className='scene-orb-label';label.dataset.id=item.id;
        label.setAttribute('aria-label',item.id+' '+item.title+'，'+item.chapter);
        const id=document.createElement('span');id.className='scene-orb-id';id.textContent=item.id;
        const title=document.createElement('span');title.className='scene-orb-title';title.textContent=this.shortNames[Number(item.id.slice(1))-1]||item.title;
        label.append(id,title);
        // Pointer activation is resolved on pointerup by the shared scene gesture.
        // Native keyboard activation emits a click with detail === 0.
        label.addEventListener('click',event=>{if(event.detail===0)this.select(item.id);});
        label.addEventListener('focus',()=>{this.hoverId=item.id;this.requestFrame();});
        label.addEventListener('blur',()=>{if(this.hoverId===item.id)this.hoverId=null;});
        label.addEventListener('mouseenter',()=>{this.hoverId=item.id;this.requestFrame();});
        label.addEventListener('mouseleave',()=>{if(this.hoverId===item.id){this.hoverId=null;this.requestFrame();}});
        this.labelLayer.append(label);
        this.orbSlots.push({mesh,material,base,orbitPosition:base.clone(),baseScale,item,label,unitIndex,filterOpacity:1});
      });
    });
    this.orbMaterials.forEach(material=>{
      material.uniforms.uSceneTexture.value=this.refractionTarget.texture;
      const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());material.uniforms.uResolution.value.copy(size);
    });
    this.viewport.dataset.orbCount=String(this.orbSlots.length);
    this.viewport.dataset.particleCount=String(this.particleCount);
    this.viewport.dataset.quality=this.lowPower?'low':'high';
    this.rebuildLines();this.requestFrame();
  }

  bindSceneEvents(canvas) {
    let down = null;
    const finishDrag=event=>{
      if(!down)return null;
      const gesture=down;down=null;
      this.isDragging = false;
      this.resumeOrbitAt = performance.now() + CONFIG.revolution.resumeDelayMs;
      if(gesture.captureTarget?.hasPointerCapture(gesture.pointerId))gesture.captureTarget.releasePointerCapture(gesture.pointerId);
      canvas.style.cursor='grab';canvas.classList.remove('is-dragging');
      return gesture;
    };
    this.viewport.addEventListener('pointerdown', event => {
      const label=event.target instanceof Element?event.target.closest('.scene-orb-label'):null;
      if(event.target!==canvas&&!label)return;
      if(event.button!==0)return;
      event.preventDefault();
      const captureTarget=label||canvas;
      down={pointerId:event.pointerId,pointerType:event.pointerType,x:event.clientX,y:event.clientY,
        yaw:this.fieldYaw,pitch:this.fieldTilt,dragged:false,knowledgeId:label?.dataset.id||null,captureTarget};
      this.isDragging = true;
      captureTarget.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');canvas.style.cursor='grabbing';
    });
    this.viewport.addEventListener('pointerup', event => {
      if (!down||event.pointerId!==down.pointerId)return;
      event.preventDefault();
      const gesture=finishDrag(event);
      if(!gesture.dragged){
        const id=gesture.knowledgeId||this.pick(event)?.userData.knowledgeId;
        if(id)this.select(id);else if(this.focusId)this.close();
      }
    });
    this.viewport.addEventListener('pointermove', event => {
      if(event.target!==canvas&&!(event.target instanceof Element&&event.target.closest('.scene-orb-label'))&&!down)return;
      const rect=canvas.getBoundingClientRect();
      this.pointer.set(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
      this.oceanUniforms.uPointer.value.copy(this.pointer);
      if(down&&event.pointerId===down.pointerId&&!this.focusId){
        if(down.pointerType==='mouse'&&(event.buttons&1)!==1){finishDrag(event);this.requestFrame();return;}
        const dx=event.clientX-down.x,dy=event.clientY-down.y;
        const threshold=down.pointerType==='mouse'?4:8;
        if(Math.hypot(dx,dy)>threshold)down.dragged=true;
        if(down.dragged){
          event.preventDefault();
          this.fieldYaw = down.yaw + dx * CONFIG.revolution.dragSensitivity;
          this.fieldTilt = THREE.MathUtils.clamp(down.pitch + dy * CONFIG.revolution.tiltSensitivity, -CONFIG.revolution.tiltLimit, CONFIG.revolution.tiltLimit);
          canvas.style.cursor='grabbing';this.requestFrame();return;
        }
      }
      if(event.pointerType!=='mouse'||down)return;
      const hit=this.pick(event);
      const id=hit?.userData.knowledgeId || null;
      if (id!==this.hoverId) { this.hoverId=id; canvas.style.cursor=id?'pointer':'grab'; this.requestFrame(); }
    });
    this.viewport.addEventListener('pointerleave',event=>{if(event.pointerType==='mouse'&&!down){this.hoverId=null;canvas.style.cursor='grab';}});
    this.viewport.addEventListener('pointercancel',event=>{if(down&&event.pointerId===down.pointerId)finishDrag(event);});
    this.viewport.addEventListener('lostpointercapture',event=>{if(down&&event.pointerId===down.pointerId)finishDrag(event);});
    window.addEventListener('pointerup',event=>{if(down&&event.pointerId===down.pointerId)finishDrag(event);});
    window.addEventListener('blur',()=>finishDrag());
    canvas.addEventListener('wheel',event=>{
      if(this.focusId)return;
      event.preventDefault();
      this.orbitRadius=THREE.MathUtils.clamp(this.orbitRadius+event.deltaY*.018,CONFIG.camera.minRadius,CONFIG.camera.maxRadius);
      this.applyOrbit();this.requestFrame();
    },{passive:false});
    canvas.style.cursor='grab';
  }

  applyOrbit() {
    const horizontal=Math.cos(this.orbitPitch)*this.orbitRadius;
    this.camera.position.set(
      this.defaultTarget.x+Math.sin(this.orbitYaw)*horizontal,
      this.defaultTarget.y+Math.sin(this.orbitPitch)*this.orbitRadius,
      this.defaultTarget.z+Math.cos(this.orbitYaw)*horizontal,
    );
    this.cameraTarget.copy(this.defaultTarget);this.camera.lookAt(this.cameraTarget);
  }

  pick(event) {
    if (!this.sceneReady || this.transition) return null;
    const rect=this.renderer.domElement.getBoundingClientRect();
    const point=new THREE.Vector2(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);
    this.raycaster.setFromCamera(point,this.camera);
    return this.raycaster.intersectObjects(this.orbSlots.filter(slot=>slot.item).map(slot=>slot.mesh),false)[0]?.object || null;
  }

  resetView() {
    this.$('map-search').value='';
    this.setUnitValue('');
    this.close(false);
    this.orbitRadius=this.defaultOrbit.radius;this.orbitYaw=this.defaultOrbit.yaw;this.orbitPitch=this.defaultOrbit.pitch;
    this.camera.position.copy(this.defaultCamera);this.cameraTarget.copy(this.defaultTarget);
    this.focusAmount=0;this.visualFocusId=null;this.savedView=null;this.transition=null;
    this.orbitPhase = 0;
    this.fieldYaw = 0;
    this.fieldTilt = 0;
    this.resumeOrbitAt = performance.now() + CONFIG.revolution.resumeDelayMs;
    this.updateOrbs(this.elapsedSeconds, !this.reducedMotion.matches);
    this.filter(false);
    this.requestFrame();
  }

  filter(move=true) {
    super.filter(false);
    if (!this.sceneReady) return;
    const query=this.$('map-search').value.trim().toLowerCase();
    const unit=this.$('map-unit').value;
    const matches=this.items.filter(item=>{
      const unitHit=!unit||item.chapter===unit;
      const queryHit=!query||(item.id+' '+item.title+' '+(this.shortNames[Number(item.id.slice(1))-1]||'')).toLowerCase().includes(query);
      return unitHit&&queryHit;
    });
    const ids=new Set(matches.map(item=>item.id));
    this.orbSlots.forEach(slot=>{
      slot.filterOpacity=(!unit&&!query)||ids.has(slot.item.id)?1:.08;
      slot.label.classList.toggle('is-filtered',slot.filterOpacity<1);
      slot.label.classList.toggle('is-search-hit',!!query&&ids.has(slot.item.id));
    });
    this.$('map-message').hidden=!query;
    this.$('map-message').textContent=matches.length?`找到 ${matches.length} 个匹配知识点`:'没有匹配结果';
    this.requestFrame();
  }

  rebuildLines() {
    this.lineGroup.clear();
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(new Float32Array(this.edges.length*6),3));
    geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(this.edges.length*6),3));
    const material=new THREE.LineBasicMaterial({vertexColors:true,transparent:true,opacity:.72,depthWrite:false});
    this.connectionLines=new THREE.LineSegments(geometry,material);
    this.lineHighlight=new THREE.Color(0x86cfff);
    this.connectionLines.visible=false;
    this.viewport.dataset.connectionMode='focus-only';
    this.lineGroup.add(this.connectionLines);
  }

  async select(id) {
    if(this.transition)return;
    if (this.sceneReady) this.focusScene(id);
    await super.select(id);
  }

  highlight() {
    super.highlight();
    if (!this.sceneReady) return;
    const adjacent=new Set(this.edges.filter(edge=>edge.from===this.selected||edge.to===this.selected).flatMap(edge=>[edge.from,edge.to]));
    this.orbSlots.forEach(slot=>{
      if(!slot.item)return;
      slot.label?.classList.toggle('is-selected',slot.item.id===this.selected);
      slot.label?.classList.toggle('is-related',!!this.selected&&adjacent.has(slot.item.id)&&slot.item.id!==this.selected);
      slot.label?.classList.toggle('is-muted',!!this.selected&&!adjacent.has(slot.item.id)&&slot.item.id!==this.selected);
      slot.label?.setAttribute('aria-pressed',String(slot.item.id===this.selected));
    });
  }

  focusScene(id) {
    const slot=this.orbSlots.find(item=>item.item?.id===id);
    if (!slot || this.transition) return;
    if (!this.focusId) this.savedView={position:this.camera.position.clone(),target:this.cameraTarget.clone()};
    this.focusId=id;
    this.visualFocusId=id;
    const target = slot.orbitPosition.clone();
    const approach=this.camera.position.clone().sub(target).normalize();
    const destination=target.clone().addScaledVector(approach,CONFIG.camera.focusDistance*slot.baseScale);
    this.beginTransition(destination,target,1);
    this.$('map-back').hidden=false;
    this.viewport.classList.add('is-focused');
  }

  restoreScene() {
    if (!this.sceneReady) return;
    const destination=this.savedView?.position || this.defaultCamera;
    const target=this.savedView?.target || this.defaultTarget;
    this.beginTransition(destination.clone(),target.clone(),0);
    this.focusId=null;
    this.savedView=null;
    this.$('map-back').hidden=true;
    this.viewport.classList.remove('is-focused');
  }

  beginTransition(position,target,focus) {
    if (this.reducedMotion.matches) {
      this.camera.position.copy(position);this.cameraTarget.copy(target);this.focusAmount=focus;
      if(focus===0)this.visualFocusId=null;
      this.transition=null;this.requestFrame();return;
    }
    this.transition={
      started:performance.now(),duration:this.lowPower?850:CONFIG.camera.transitionMs,
      fromPosition:this.camera.position.clone(),toPosition:position,
      fromTarget:this.cameraTarget.clone(),toTarget:target,
      fromFocus:this.focusAmount,toFocus:focus,
    };
    this.start();
  }

  close(restore=true) {
    const hadFocus=!!this.focusId;
    super.close(restore);
    if (hadFocus || this.focusAmount>0) this.restoreScene();
  }

  setActive(value) {
    this.active=value;
    if(value){this.resize();this.start();}else this.stop();
  }

  center() {
    if (!this.sceneReady) { super.center(); return; }
    this.setActive(true);this.resize();this.requestFrame();
  }

  resize() {
    if(!this.sceneReady)return;
    const width=Math.max(1,this.viewport.clientWidth),height=Math.max(1,this.viewport.clientHeight);
    this.renderer.setSize(width,height,false);
    const headerHeight=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header'));
    const framingHeight=this.narrow.matches?Math.max(1,height-headerHeight):height;
    // Preserve the mobile horizontal field of view when the scene extends under the navigation.
    this.camera.fov=THREE.MathUtils.radToDeg(2*Math.atan(Math.tan(THREE.MathUtils.degToRad(CONFIG.camera.fov/2))*height/framingHeight));
    this.camera.aspect=width/height;this.camera.updateProjectionMatrix();
    const size=this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.refractionTarget.setSize(size.x,size.y);
    this.orbMaterials.forEach(material=>material.uniforms.uResolution.value.copy(size));
    this.requestFrame();
  }

  start() {
    if(!this.active||document.hidden||!this.sceneReady||this.raf)return;
    this.raf=requestAnimationFrame(time=>this.frame(time));
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastFrameTime = null;
  }
  requestFrame() { if(this.active)this.start(); }

  frame(timestamp) {
    this.raf=0;
    const delta = this.lastFrameTime === null ? 0 : Math.min(.1, Math.max(0, (timestamp - this.lastFrameTime) * .001));
    this.lastFrameTime = timestamp;
    const animate = !this.reducedMotion.matches;
    if (animate) this.elapsedSeconds += delta;
    const orbitPaused = this.isDragging || this.hoverId || this.visualFocusId || this.transition ||
      this.$('map-search').value.trim() || this.$('map-unit').value || timestamp < this.resumeOrbitAt;
    if (animate && !orbitPaused) {
      this.orbitPhase = (this.orbitPhase + delta * CONFIG.revolution.angularSpeed) % (Math.PI * 2);
    }
    if(this.transition) {
      const raw=Math.min(1,(timestamp-this.transition.started)/this.transition.duration);
      const eased=raw<.5?4*raw*raw*raw:1-Math.pow(-2*raw+2,3)/2;
      this.camera.position.lerpVectors(this.transition.fromPosition,this.transition.toPosition,eased);
      this.cameraTarget.lerpVectors(this.transition.fromTarget,this.transition.toTarget,eased);
      this.focusAmount=THREE.MathUtils.lerp(this.transition.fromFocus,this.transition.toFocus,eased);
      if(raw===1){
        if(this.transition.toFocus===0)this.visualFocusId=null;
        this.transition=null;
      }
    }
    this.camera.lookAt(this.cameraTarget);
    this.oceanUniforms.uTime.value = this.elapsedSeconds;
    this.updateOrbs(this.elapsedSeconds,animate);
    this.updateLines();
    this.updateLabels();
    this.renderScene();
    if((animate||this.transition)&&this.active)this.start();
  }

  updateOrbs(seconds,animate) {
    const angle = this.orbitPhase + this.fieldYaw;
    const cosine = Math.cos(angle), sine = Math.sin(angle);
    const tiltCosine = Math.cos(this.fieldTilt), tiltSine = Math.sin(this.fieldTilt);
    let lowestOrbBottom = Infinity;
    for (const slot of this.orbSlots) {
      const x = slot.base.x - this.fieldCenter.x;
      const y = slot.base.y - this.fieldCenter.y;
      const z = slot.base.z - this.fieldCenter.z;
      const rotatedZ = -x * sine + z * cosine;
      slot.orbitPosition.set(
        this.fieldCenter.x + x * cosine + z * sine,
        this.fieldCenter.y + y * tiltCosine - rotatedZ * tiltSine,
        this.fieldCenter.z + y * tiltSine + rotatedZ * tiltCosine,
      );
      // Reserve room for liquid deformation, hover enlargement and vertical floating.
      const orbExtent = slot.baseScale * (1 + CONFIG.liquid.waveStrength) + 0.25;
      lowestOrbBottom = Math.min(lowestOrbBottom, slot.orbitPosition.y - orbExtent);
    }
    // These amplitudes match the ocean vertex shader's maximum wave crest.
    const waveCrest = CONFIG.ocean.level + CONFIG.ocean.waveHeight * (0.46 + 0.34 + 0.24 + 0.12);
    const fieldLift = Math.max(0, waveCrest + CONFIG.revolution.oceanClearance - lowestOrbBottom);
    for (const slot of this.orbSlots) slot.orbitPosition.y += fieldLift;
    const focused=this.orbSlots.find(slot=>slot.item?.id===this.visualFocusId);
    this.orbSlots.forEach((slot,index)=>{
      if(!slot.item)return;
      const isFocused=slot.item.id===this.visualFocusId;
      const direction=focused?slot.orbitPosition.clone().sub(focused.orbitPosition).normalize():new THREE.Vector3();
      const outward=isFocused?new THREE.Vector3():direction.multiply(new THREE.Vector3(4.2,2.0,2.8));
      slot.mesh.position.copy(slot.orbitPosition).addScaledVector(outward,this.focusAmount);
      if(animate)slot.mesh.position.y+=Math.sin(seconds*.42+index*1.37)*.13*(1-this.focusAmount*.35);
      slot.mesh.scale.setScalar(slot.baseScale*(1+(isFocused ? .32 : 0)*this.focusAmount+(slot.item.id===this.hoverId ? .035 : 0)));
      slot.material.uniforms.uTime.value=seconds;
      slot.material.uniforms.uFocus.value=(isFocused?this.focusAmount:0)+(slot.item.id===this.hoverId ? .18 : 0);
      const focusOpacity=isFocused||!this.visualFocusId?1:1-this.focusAmount*.94;
      slot.material.uniforms.uOpacity.value=slot.filterOpacity*focusOpacity;
    });
  }

  updateLines() {
    if(!this.connectionLines)return;
    this.connectionLines.visible=!!this.visualFocusId;
    if(!this.visualFocusId)return;
    const positions=this.connectionLines.geometry.attributes.position;
    const colors=this.connectionLines.geometry.attributes.color;
    this.edges.forEach((edge,index)=>{
      const from=this.orbSlots.find(slot=>slot.item?.id===edge.from);
      const to=this.orbSlots.find(slot=>slot.item?.id===edge.to);
      if(!from||!to)return;
      const connected=this.visualFocusId&&(edge.from===this.visualFocusId||edge.to===this.visualFocusId);
      if(connected){
        positions.setXYZ(index*2,from.mesh.position.x,from.mesh.position.y,from.mesh.position.z);
        positions.setXYZ(index*2+1,to.mesh.position.x,to.mesh.position.y,to.mesh.position.z);
      }else{
        positions.setXYZ(index*2,0,-999,0);positions.setXYZ(index*2+1,0,-999,0);
      }
      colors.setXYZ(index*2,this.lineHighlight.r,this.lineHighlight.g,this.lineHighlight.b);
      colors.setXYZ(index*2+1,this.lineHighlight.r,this.lineHighlight.g,this.lineHighlight.b);
    });
    positions.needsUpdate=true;colors.needsUpdate=true;
  }

  updateLabels() {
    const width=this.viewport.clientWidth,height=this.viewport.clientHeight;
    const projected=[];
    this.orbSlots.forEach(slot=>{
      const anchor=(!this.visualFocusId&&!this.transition)?slot.orbitPosition:slot.mesh.position;
      const point=anchor.clone().project(this.camera);
      const visible=point.z<1&&Math.abs(point.x)<1.2&&Math.abs(point.y)<1.2;
      slot.label.hidden=!visible;
      if(visible)projected.push({
        slot,
        distance:this.camera.position.distanceTo(anchor),
        x:(point.x*.5+.5)*width,
        y:(-point.y*.5+.5)*height,
      });
    });
    const distances=projected.map(entry=>entry.distance);
    const nearest=Math.min(...distances),farthest=Math.max(...distances);
    const occupied=[];
    const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top;
    const rectAt=(x,y,w,h)=>({left:x-w/2-2,right:x+w/2+2,top:y-h/2-2,bottom:y+h/2+2});
    const labelWidth=this.lowPower?78:96,fullHeight=this.lowPower?38:42;
    const compactWidth=34,compactHeight=24;
    const priority=entry=>entry.slot.item.id===this.visualFocusId?4:entry.slot.item.id===this.hoverId?3:entry.slot.label.classList.contains('search-hit')?2:0;
    projected.sort((a,b)=>priority(b)-priority(a)||a.distance-b.distance);
    projected.forEach(({slot,distance,x,y})=>{
      const depth=(distance-nearest)/Math.max(1,farthest-nearest);
      const tone=Math.round(255-depth*142);
      const important=priority({slot})>0;
      let offsetY=0,condensed=false,collisionHidden=false;
      let bounds=rectAt(x,y,labelWidth,fullHeight);
      if(!important&&occupied.some(other=>intersects(bounds,other))){
        condensed=true;
        let placed=false;
        for(const candidate of [0,-14,14,-24,24]){
          const compact=rectAt(x,y+candidate,compactWidth,compactHeight);
          if(!occupied.some(other=>intersects(compact,other))){bounds=compact;offsetY=candidate;placed=true;break;}
        }
        collisionHidden=!placed;
      }
      if(!collisionHidden)occupied.push(bounds);
      slot.label.classList.toggle('is-condensed',condensed&&!important);
      slot.label.classList.toggle('is-collision-hidden',collisionHidden&&!important);
      slot.label.style.transform=`translate3d(${x}px,${y+offsetY}px,0) translate(-50%,-50%)`;
      slot.label.style.setProperty('--label-tone',`rgb(${tone},${tone},${tone})`);
      slot.label.style.zIndex=String(Math.round(10000-distance*100));
      const focusOpacity=slot.item.id===this.visualFocusId||!this.visualFocusId?1:Math.max(.05,1-this.focusAmount*.94);
      slot.label.style.opacity=String(slot.filterOpacity*focusOpacity);
      slot.label.style.pointerEvents=slot.filterOpacity<.2?'none':'auto';
    });
  }

  renderScene() {
    const refract=!this.lowPower;
    if(refract){
      this.orbGroup.visible=false;this.lineGroup.visible=false;
      this.renderer.setRenderTarget(this.refractionTarget);this.renderer.render(this.scene,this.camera);
      this.orbGroup.visible=true;this.lineGroup.visible=true;
    }
    this.renderer.setRenderTarget(null);this.renderer.render(this.scene,this.camera);
  }
}

window.LIQUID_KNOWLEDGE_CONFIG=CONFIG;
window.KnowledgeMap=LiquidKnowledgeScene;
