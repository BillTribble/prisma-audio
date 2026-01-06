import { LightCycleArena } from './easterEgg.js';
import * as THREE from 'three';
import decodeAudio from 'audio-decode';
import { PhysicsWorld } from './physics.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';


// Global FPS Tracking
let fpsLastTime = performance.now();
let fpsFrames = 0;
const fpsElement = document.getElementById('fps-counter');
let lastMeasuredFrame = 0;
let lastOptimizationTime = 0;

// Helper to create soft circle texture
function createCircleTexture() {
  const size = 128; // Increased resolution for sharper edges
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const center = size / 2;
  const radius = size / 2 - 2;

  // Create radial gradient for clearer outline
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, radius);

  // Bright center
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
  // Solid middle
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 1.0)');
  // Sharp edge transition
  gradient.addColorStop(0.85, 'rgba(255, 255, 255, 1.0)');
  gradient.addColorStop(0.95, 'rgba(255, 255, 255, 0.8)');
  // Subtle outer glow for definition
  gradient.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}

export class CrystalViewer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return; // Silent fail if container missing (e.g. passive mode)

    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.crystalGroup = null; // Holds mesh+wireframe
    this.autoRotate = true; // Default ON
    this.animationId = null;
    this.customUniforms = {
      uTime: { value: 0 },
      uPulseEnabled: { value: 0.0 },
      uLineNear: { value: 150.0 },
      uLineFar: { value: 1000.0 },
      uNodeNear: { value: 150.0 },
      uNodeFar: { value: 1000.0 },
      uThinning: { value: 0.4 },
      uLineDensity: { value: 1.0 },
      uNodeDensity: { value: 1.0 },
      uXorDensity: { value: 0.62 },
      uXorThreshold: { value: 0.0115 },
      uColorInfluence: { value: 0.9 },
      uLineOpacity: { value: 0.4 },
      uNodeOpacity: { value: 1.0 },
      uInvertInfluence: { value: 1.0 },
      uNodeSaturation: { value: 0.5 },
      uAudioLevel: { value: 0.0 }, // [NEW] Real-time audio level
      uPalette: { value: Array(6).fill(0).map(() => new THREE.Color(0xffffff)) }
    };

    // Target values for smooth lerping
    this.targetUniforms = {
      uLineNear: 150.0,
      uLineFar: 1000.0,
      uNodeNear: 150.0,
      uNodeFar: 1000.0,
      uThinning: 0.4,
      uLineDensity: 1.0,
      uNodeDensity: 1.0,
      uXorDensity: 0.62,
      uXorThreshold: 0.0115,
      uColorInfluence: 0.9,
      uLineOpacity: 0.4,
      uNodeOpacity: 1.0,
      uInvertInfluence: 1.0,
      uNodeSaturation: 0.5,
      uNodeSaturation: 0.5,
      uPalette: Array(6).fill(0).map(() => new THREE.Color(0xffffff))
    };

    // Physics
    this.physics = new PhysicsWorld(50, 20); // Length 50 matches approx track length, 20 nodes
    this.customUniforms.uSpine = { value: this.physics.spinePositions };

    this.palettes = {
      classic: ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff'],
      stockholm: ['#2E3440', '#4C566A', '#81A1C1', '#88C0D0', '#8FBCBB', '#ECEFF4'],
      copenhagen: ['#4A4E69', '#9A8C98', '#C9ADA7', '#F2E9E4', '#22223B', '#822100'],
      helsinki: ['#001219', '#005F73', '#0A9396', '#94D2BD', '#E9D8A6', '#EE9B00'],
      berlin: ['#2B2D42', '#8D99AE', '#EDF2F4', '#EF233C', '#D90429', '#FFD700'],
      kyoto: ['#2D3142', '#4F5D75', '#BFC0C0', '#FFFFFF', '#EF8354', '#84A59D'],
      brooklyn: ['#355070', '#6D597A', '#B56576', '#E56B6F', '#EAAC8B', '#FFB700'],
      malmo: ['#003049', '#669BBC', '#FDF0D5', '#C1121F', '#780000', '#F4A261'],
    };

    // Initialize classic palette
    this.setPalette('classic');

    // Easter Egg System
    this.arena = null;

    // Internal Animation State
    this.lastPanY = 0;
    this.panTime = 0;
    this.modelHeight = 1.0;
    this.modelBottom = 0;

    // Size & LFO State
    this.autoPan = true;
    this.panSpeed = 0;
    this.rotSpeed = 0.2;

    // Pan Limits
    this.panMin = 3.0;
    this.panMax = 9.0;

    // Model Info
    this.modelHeight = 15.0;
    this.modelBottom = -7.5;

    this.lastPanY = 0;

    // Line indices for rebuilding
    this.allIndices = null;
    this.geometry = null;
    this.stdWire = null;
    this.xorWire = null;
    this.xorPercentage = 0.02;

    this.baseSize = 0.2;
    this.lfoAmount = 0.2;
    this.lfoSpeed = 3.5;

    this.pointMaterial = null;

    // Audio State
    this.audioCtx = null;
    this.audioBuffer = null;
    this.audioSource = null;
    this.gainNode = null;
    this.isPlaying = false;
    this.isMuted = false;
    this.audioStartTime = 0; // When playback started relative to AudioContext.currentTime
    this.audioPauseTime = 0; // How far into the track we were when paused
    this.audioDuration = 0;

    // Add audio-specific uniforms
    this.customUniforms.uPlayX = { value: -9999.0 };
    this.customUniforms.uPlayRange = { value: 5.0 };
    this.targetUniforms.uPlayX = -9999.0;

    this.init();
  }

  init() {
    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050810);
    this.scene.fog = new THREE.FogExp2(0x050810, 0.005);

    // Camera
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
    this.camera.position.set(15, 0, 15);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.autoRotate = this.autoRotate;
    this.controls.autoRotateSpeed = this.rotSpeed;

    // Environment
    this.buildEnvironment();

    // Init Arena
    this.arena = new LightCycleArena(this.scene);

    // Resize Listener
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.container);

    // Start Loop
    this.clock = new THREE.Clock();
    this.animate();
  }

  buildEnvironment() {
    // Grid
    const gridHelper = new THREE.GridHelper(200, 100, 0x00f3ff, 0x003344);
    gridHelper.position.y = -10;
    this.scene.add(gridHelper);

    // Lights
    const ambient = new THREE.AmbientLight(0x404040);
    this.scene.add(ambient);

    const light1 = new THREE.PointLight(0x00f3ff, 2, 100);
    light1.position.set(0, 20, 0);
    this.scene.add(light1);

    const light2 = new THREE.PointLight(0xff0055, 1, 100);
    light2.position.set(40, -10, 40);
    this.scene.add(light2);
  }

  async loadCrystal(url) {
    if (this.crystalGroup) {
      this.scene.remove(this.crystalGroup);
      this.crystalGroup.children.forEach(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.crystalGroup = null;
    }

    this.allIndices = null;
    this.geometry = null;
    this.stdWire = null;
    this.xorWire = null;

    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      const { meshResult, stats } = this.parsePLY(buffer);

      this.crystalGroup = meshResult;
      this.scene.add(this.crystalGroup);

      this.fitCameraToSelection();

      return stats;
    } catch (err) {
      console.error("Load failed:", err);
      throw err;
    }
  }

  fitCameraToSelection() {
    if (!this.crystalGroup) return;

    const box = new THREE.Box3().setFromObject(this.crystalGroup);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    const fovRad = this.camera.fov * (Math.PI / 180);
    let cameraDist = (maxDim / 2) / Math.tan(fovRad / 2);
    cameraDist *= 1.4;

    this.controls.target.copy(center);
    const direction = new THREE.Vector3(1, 0.6, 1).normalize();
    const pos = center.clone().add(direction.multiplyScalar(cameraDist));

    this.camera.position.copy(pos);
    this.controls.update();

    const heightFactor = this.modelHeight / 15.0;
    const mid = this.modelBottom + ((this.panMin + this.panMax) / 2) * heightFactor;

    const deltaY = mid - center.y;
    this.camera.position.y += deltaY;
    this.controls.target.y += deltaY;
    this.controls.update();

    this.lastPanY = mid;
    this.panTime = 0;
  }

  setAutoRotate(enabled) {
    this.autoRotate = enabled;
    if (this.controls) this.controls.autoRotate = enabled;
  }

  resetView() {
    this.fitCameraToSelection();
  }

  setNodeBlending(mode) {
    if (this.pointMaterial) {
      this.pointMaterial.blending = (mode === 'additive') ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.pointMaterial.needsUpdate = true;
    }
  }

  setLineBlending(mode) {
    if (this.stdWire && this.xorWire) {
      const b = (mode === 'additive') ? THREE.AdditiveBlending : THREE.NormalBlending;
      this.stdWire.material.blending = b;
      // XOR wire always uses custom blending
      this.stdWire.material.needsUpdate = true;
      this.xorWire.material.needsUpdate = true;
    }
  }

  setColorInfluence(val) {
    this.targetUniforms.uColorInfluence = val;
  }

  setLineOpacity(val) {
    this.targetUniforms.uLineOpacity = val;
  }

  setInvertInfluence(enabled) {
    const value = enabled ? 1.0 : 0.0;
    this.targetUniforms.uInvertInfluence = value;
    this.customUniforms.uInvertInfluence.value = value; // Set immediately to avoid lerp delay
  }

  setNodeSaturation(val) {
    this.targetUniforms.uNodeSaturation = val;
  }

  setNodeOpacity(val) {
    this.targetUniforms.uNodeOpacity = val;
  }

  setPalette(name) {
    const colors = this.palettes[name] || this.palettes.classic;
    colors.forEach((hex, i) => {
      this.targetUniforms.uPalette[i].set(hex);
    });
  }

  onResize() {
    if (!this.camera || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    const lerp = (cur, tar, speed = 0.2) => cur + (tar - cur) * speed;

    this.customUniforms.uLineNear.value = lerp(this.customUniforms.uLineNear.value, this.targetUniforms.uLineNear);
    this.customUniforms.uLineFar.value = lerp(this.customUniforms.uLineFar.value, this.targetUniforms.uLineFar);
    this.customUniforms.uNodeNear.value = lerp(this.customUniforms.uNodeNear.value, this.targetUniforms.uNodeNear);
    this.customUniforms.uNodeFar.value = lerp(this.customUniforms.uNodeFar.value, this.targetUniforms.uNodeFar);
    this.customUniforms.uThinning.value = lerp(this.customUniforms.uThinning.value, this.targetUniforms.uThinning);
    this.customUniforms.uLineDensity.value = lerp(this.customUniforms.uLineDensity.value, this.targetUniforms.uLineDensity);
    this.customUniforms.uNodeDensity.value = lerp(this.customUniforms.uNodeDensity.value, this.targetUniforms.uNodeDensity);
    this.customUniforms.uXorDensity.value = lerp(this.customUniforms.uXorDensity.value, this.targetUniforms.uXorDensity);
    this.customUniforms.uXorThreshold.value = lerp(this.customUniforms.uXorThreshold.value, this.targetUniforms.uXorThreshold);
    this.customUniforms.uColorInfluence.value = lerp(this.customUniforms.uColorInfluence.value, this.targetUniforms.uColorInfluence);
    this.customUniforms.uLineOpacity.value = lerp(this.customUniforms.uLineOpacity.value, this.targetUniforms.uLineOpacity);
    this.customUniforms.uNodeOpacity.value = lerp(this.customUniforms.uNodeOpacity.value, this.targetUniforms.uNodeOpacity);
    this.customUniforms.uInvertInfluence.value = lerp(this.customUniforms.uInvertInfluence.value, this.targetUniforms.uInvertInfluence);
    this.customUniforms.uNodeOpacity.value = lerp(this.customUniforms.uNodeOpacity.value, this.targetUniforms.uNodeOpacity);
    this.customUniforms.uInvertInfluence.value = lerp(this.customUniforms.uInvertInfluence.value, this.targetUniforms.uInvertInfluence);
    this.customUniforms.uNodeSaturation.value = lerp(this.customUniforms.uNodeSaturation.value, this.targetUniforms.uNodeSaturation);

    // Audio Level Logic
    let currentLevel = 0;
    if (this.isPlaying && this.audioBuffer && this.analyserNode && this.audioCtx) {
      // Get real-time data from analyser
      const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
      this.analyserNode.getByteTimeDomainData(dataArray);

      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] - 128) / 128; // Normalize to -1..1
        sum += v * v;
      }
      currentLevel = Math.sqrt(sum / dataArray.length);
    }
    // Smooth decay for visual niceness
    // Note: we need to initialize this.targetAudioLevel if we want smooth lerp, 
    // but direct set with simple smoothing is fine for jitter
    const prevLevel = this.customUniforms.uAudioLevel.value;
    if (currentLevel > prevLevel) {
      this.customUniforms.uAudioLevel.value = lerp(prevLevel, currentLevel, 0.5); // Attack fast
    } else {
      this.customUniforms.uAudioLevel.value = lerp(prevLevel, currentLevel, 0.1); // Decay slow
    }

    // Apply Force to Physics Spine
    if (this.customUniforms.uAudioLevel.value > 0.01) {
      if (Math.random() > 0.99) console.log("Physics Force Applying. Level:", this.customUniforms.uAudioLevel.value);
      this.physics.applyAudioForce(this.customUniforms.uAudioLevel.value, this.customUniforms.uPlayX.value);
    }

    for (let i = 0; i < 6; i++) {
      this.customUniforms.uPalette.value[i].lerp(this.targetUniforms.uPalette[i], 0.1);
    }

    if (this.customUniforms) {
      this.customUniforms.uTime.value += 0.01;

      // Audio Sync
      if (this.audioBuffer && this.geometry && this.geometry.boundingBox) {
        let progress = -1;
        if (this.isPlaying) {
          const t = this.audioCtx.currentTime - this.audioStartTime;
          if (t >= this.audioDuration) {
            this.stopAudio();
          } else {
            progress = t / this.audioDuration;
          }
        } else if (this.audioPauseTime > 0) {
          progress = this.audioPauseTime / this.audioDuration;
        }

        if (progress >= 0) {
          const minX = this.geometry.boundingBox.min.x;
          const totalW = this.geometry.boundingBox.max.x - minX;
          this.customUniforms.uPlayX.value = minX + (progress * totalW);
        }
      }
    }

    if (this.pointMaterial) {
      if (this.lfoAmount > 0) {
        const time = Date.now() * 0.001;
        const scale = 1.0 + Math.sin(time * this.lfoSpeed) * this.lfoAmount;
        let newSize = this.baseSize * scale;
        if (newSize < 0.001) newSize = 0.001;
        this.pointMaterial.size = newSize;
        if (this.onUpdateUI) this.onUpdateUI(newSize);
      } else if (this.pointMaterial.size !== this.baseSize) {
        this.pointMaterial.size = this.baseSize;
        if (this.onUpdateUI) this.onUpdateUI(this.baseSize);
      }
    }

    if (this.autoPan) {
      if (!this.panTime) this.panTime = 0;
      // Add a tiny floor (0.01) so that slider 0 is "VERY slow"
      const effectiveSpeed = this.panSpeed + 0.01;
      this.panTime += 0.016 * effectiveSpeed;

      const heightFactor = this.modelHeight / 15.0;
      const effectiveMin = this.modelBottom + (this.panMin * heightFactor);
      const effectiveMax = this.modelBottom + (this.panMax * heightFactor);

      const range = effectiveMax - effectiveMin;
      const mid = (effectiveMax + effectiveMin) / 2;
      const amp = range / 2;

      const targetY = mid + Math.sin(this.panTime) * amp;
      const deltaY = targetY - this.lastPanY;
      this.lastPanY = targetY;

      this.camera.position.y += deltaY;
      this.controls.target.y += deltaY;
    }

    const dt = this.clock.getDelta();
    const time = this.clock.getElapsedTime();

    this.customUniforms.uTime.value = time;

    // Update Physics
    this.physics.update(dt);
    this.customUniforms.uSpine.value = this.physics.spinePositions;
    // Sync Uniform (Three.js needs to know array changed?)
    // Actually Float32Array in uniform value is usually by reference, 
    // but we might need to toggle needsUpdate if it was a Texture. 
    // For uniform array of vec3, standard WebGLRenderer handles it if the value ref is same? 
    // usually yes.
    // usually yes.

    if (this.controls && this.autoRotate) {
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = this.rotSpeed;
    } else if (this.controls) {
      this.controls.autoRotate = false;
    }

    if (this.arena) this.arena.update();
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }

    const now = performance.now();
    const frameId = Math.floor(now / 16.66);
    if (frameId !== lastMeasuredFrame) {
      fpsFrames++;
      lastMeasuredFrame = frameId;

      if (now > fpsLastTime + 250) {
        const fps = fpsFrames / 0.25;
        if (fpsElement) {
          fpsElement.textContent = `${fps.toFixed(0)} FPS`;
          fpsElement.style.color = 'var(--color-primary)';
          fpsElement.style.opacity = '0.7';
        }
        window.dispatchEvent(new CustomEvent('fps-update', { detail: { fps } }));
        fpsLastTime = now;
        fpsFrames = 0;
      }
    }
  }

  toggleEasterEgg() {
    if (this.arena) {
      this.arena.toggle();
      return this.arena.active;
    }
    return false;
  }

  parsePLY(buffer) {
    const decoder = new TextDecoder();
    let headerEndIndex = 0;
    const chunk = decoder.decode(buffer.slice(0, 2048));
    const idx = chunk.indexOf("end_header\n");
    if (idx !== -1) headerEndIndex = idx + "end_header\n".length;

    const headerText = decoder.decode(buffer.slice(0, headerEndIndex));
    const body = buffer.slice(headerEndIndex);

    const vertexCount = parseInt(headerText.match(/element vertex (\d+)/)?.[1] || 0);
    const edgeCount = parseInt(headerText.match(/element edge (\d+)/)?.[1] || 0);

    const textData = decoder.decode(body).trim().split(/\s+/);
    let ptr = 0;

    const positions = [];
    const colors = [];
    const edgeIndices = [];

    for (let i = 0; i < vertexCount; i++) {
      const x = parseFloat(textData[ptr++]);
      const y = parseFloat(textData[ptr++]);
      const z = parseFloat(textData[ptr++]);
      const r = parseInt(textData[ptr++]) / 255;
      const g = parseInt(textData[ptr++]) / 255;
      const b = parseInt(textData[ptr++]) / 255;
      positions.push(x, y, z);
      colors.push(r, g, b);
    }

    const allIndices = [];
    for (let i = 0; i < edgeCount; i++) {
      const v1 = parseInt(textData[ptr++]);
      const v2 = parseInt(textData[ptr++]);
      allIndices.push(v1, v2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.center();

    this.geometry = geometry;
    this.allIndices = allIndices;

    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      this.modelHeight = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
      this.modelBottom = geometry.boundingBox.min.y;
    }

    const group = new THREE.Group();

    const pointMaterial = new THREE.PointsMaterial({
      size: this.baseSize,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      map: createCircleTexture(),
      alphaTest: 0.001,
      depthWrite: true,
      blending: THREE.NormalBlending,
      sizeAttenuation: true
    });
    this.pointMaterial = pointMaterial;

    pointMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.customUniforms.uTime;
      shader.uniforms.uPulseEnabled = this.customUniforms.uPulseEnabled;
      shader.uniforms.uNodeNear = this.customUniforms.uNodeNear;
      shader.uniforms.uNodeFar = this.customUniforms.uNodeFar;
      shader.uniforms.uNodeDensity = this.customUniforms.uNodeDensity;
      shader.uniforms.uNodeSaturation = this.customUniforms.uNodeSaturation;
      shader.uniforms.uNodeOpacity = this.customUniforms.uNodeOpacity;
      shader.uniforms.uPalette = this.customUniforms.uPalette;
      shader.uniforms.uPlayX = this.customUniforms.uPlayX;
      shader.uniforms.uPlayRange = this.customUniforms.uPlayRange;
      shader.uniforms.uAudioLevel = this.customUniforms.uAudioLevel;
      shader.uniforms.uSpine = this.customUniforms.uSpine;

      shader.vertexShader = `
          varying float vPulse;
          varying float vDistAlpha;
          varying float vSeed;
          varying float vPosX;
          uniform float uTime;
          uniform float uPulseEnabled;
          uniform float uNodeNear;
          uniform float uNodeFar;
          uniform float uAudioLevel;
          uniform float uPlayX;
          uniform vec3 uSpine[20];

          // Simplex 3D Noise 
          vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
          vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
          vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
          
          float snoise(vec3 v) {
            const vec2 C = vec2(1.0/6.0, 1.0/3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min( g.xyz, l.zxy );
            vec3 i2 = max( g.xyz, l.zxy );
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            i = mod289(i);
            vec4 p = permute( permute( permute( 
                      i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
            float n_ = 0.142857142857;
            vec3  ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );
            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4( x.xy, y.xy );
            vec4 b1 = vec4( x.zw, y.zw );
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
            vec3 p0 = vec3(a0.xy,h.x);
            vec3 p1 = vec3(a0.zw,h.y);
            vec3 p2 = vec3(a1.xy,h.z);
            vec3 p3 = vec3(a1.zw,h.w);
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                          dot(p2,x2), dot(p3,x3) ) );
          }

          vec3 getSoupOffset(vec3 pos, float time) {
              float noise = snoise(pos * 2.0 + time * 0.5);
              float noise2 = snoise(pos * 2.0 + time * 0.5 + 100.0);
              float noise3 = snoise(pos * 2.0 + time * 0.5 + 200.0);
              return vec3(noise, noise2, noise3) * 3.0;
          }
          
          vec3 getSpineOffset(float x) {
              float stepSize = 50.0 / 19.0;
              float idx = (x + 25.0) / stepSize;
              int i = int(idx);
              float f = fract(idx);
              if (i < 0) return vec3(0.0); // Now only for x < -25
              if (i >= 19) return uSpine[19] - vec3(25.0, 0.0, 0.0); // Max end at 25
              vec3 p0 = uSpine[i];
              vec3 p1 = uSpine[i+1];
              vec3 currentPos = mix(p0, p1, f);
              vec3 originalPos = vec3(x, 0.0, 0.0);
              return currentPos - originalPos;
          }
        ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          #include <begin_vertex>
          vPulse = 0.0;
          if (uPulseEnabled > 0.5) {
             float offset = sin(position.x * 0.5) + cos(position.y * 0.5);
             float wave = sin(position.z * 0.2 + uTime * 2.5 + offset * 0.5);
             vPulse = smoothstep(0.9, 1.0, wave);
          }

          // Audio Bounce Physics
          if (uAudioLevel > 0.01 && uPlayX > -9000.0) {
             float dist = abs(position.x - uPlayX);
             float influence = smoothstep(3.0, 0.0, dist);
             vec3 radial = vec3(0.0, position.y, position.z);
             float rLen = length(radial);
             if (rLen > 0.001) radial = normalize(radial);
             else radial = vec3(0.0, 1.0, 0.0);
             transformed += radial * uAudioLevel * influence * 8.0; 
          }
          `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        // transformed is already defined
        transformed += getSoupOffset(position, uTime);
        transformed += getSpineOffset(transformed.x);

        vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        gl_Position = projectionMatrix * mvPosition;

        float dist = length(mvPosition.xyz);
        vDistAlpha = 1.0 - smoothstep(uNodeNear, uNodeFar, dist);
        vSeed = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        vPosX = position.x;
        
        float distFromCenter = length(position.xyz);
        float maxDist = 15.0; 
        float sizeScale = mix(0.2, 1.0, smoothstep(0.0, maxDist * 0.5, distFromCenter));
        gl_PointSize *= sizeScale;
        `
      );

      shader.fragmentShader = `
          varying float vPulse;
          varying float vDistAlpha;
          varying float vSeed;
          varying float vPosX;
          uniform float uNodeDensity;
          uniform float uNodeSaturation;
          uniform float uNodeOpacity;
          uniform float uPlayX;
          uniform float uPlayRange;
          uniform vec3 uPalette[6];
          
          float getHue(vec3 rgb) {
            float minVal = min(min(rgb.r, rgb.g), rgb.b);
            float maxVal = max(max(rgb.r, rgb.g), rgb.b);
            float delta = maxVal - minVal;
            float h = 0.0;
            if (delta > 0.0) {
              if (maxVal == rgb.r) h = (rgb.g - rgb.b) / delta;
              else if (maxVal == rgb.g) h = 2.0 + (rgb.b - rgb.r) / delta;
              else h = 4.0 + (rgb.r - rgb.g) / delta;
              h /= 6.0;
              if (h < 0.0) h += 1.0;
            }
            return h;
          }

          vec3 applyPalette(vec3 rgb) {
            float h = getHue(rgb);
            float p = h * 5.0;
            int i = int(p);
            float f = fract(p);
            
            if (i == 0) return mix(uPalette[0], uPalette[1], f);
            if (i == 1) return mix(uPalette[1], uPalette[2], f);
            if (i == 2) return mix(uPalette[2], uPalette[3], f);
            if (i == 3) return mix(uPalette[3], uPalette[4], f);
            if (i == 4) return mix(uPalette[4], uPalette[5], f);
            return uPalette[5];
          }
        ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
          #include <color_fragment>
          
          // Remap colors via Palette
          diffuseColor.rgb = applyPalette(diffuseColor.rgb);
          
          float gray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          vec3 desaturated = vec3(gray);
          diffuseColor.rgb = mix(desaturated, diffuseColor.rgb, uNodeSaturation * 2.0);
          
          // Force nodes towards Cyan
          vec3 cyan = vec3(0.0, 0.9, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, cyan, 0.7 * (1.1 - uNodeSaturation));
          
          float fog = pow(vDistAlpha, 2.0);
          
          // Node Density Discard
          if (vSeed > uNodeDensity) discard;
          
          // Boost Alpha when density is low - increased multiplier to make nodes pop through lines
          float alphaBoost = 1.0 + (1.0 - uNodeDensity) * 4.0;
          diffuseColor.a *= fog * alphaBoost * uNodeOpacity;
          
          // Brighten nodes slightly to make them more visible through lines
          diffuseColor.rgb *= 1.3;
          
          if (vPulse > 0.01) {
             diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 1.0, 1.0), vPulse * 0.7);
          }
          
          if (uPlayX > -9000.0) {
             float playDist = abs(vPosX - uPlayX);
             float playGlow = smoothstep(uPlayRange, 0.0, playDist);
             diffuseColor.rgb += vec3(1.0, 1.0, 1.0) * playGlow;
             diffuseColor.a = max(diffuseColor.a, playGlow);
          }
          `
      );
    };

    const mesh = new THREE.Points(geometry, pointMaterial);
    mesh.renderOrder = 20; // Nodes render on top of lines
    group.add(mesh);

    this.buildLines(group);

    return {
      meshResult: group,
      stats: {
        nodes: vertexCount,
        links: edgeCount,
        layers: 10
      }
    };
  }

  buildLines(group) {
    if (!this.allIndices || !this.geometry) return;

    if (this.stdWire) {
      group.remove(this.stdWire);
      this.stdWire.geometry.dispose();
      this.stdWire.material.dispose();
      this.stdWire = null;
    }
    if (this.xorWire) {
      group.remove(this.xorWire);
      this.xorWire.geometry.dispose();
      this.xorWire.material.dispose();
      this.xorWire = null;
    }

    // Assign a random seed attribute to lines so we can cross-fade XOR-ness in shader
    const lineSeeds = new Float32Array(this.allIndices.length);
    for (let i = 0; i < this.allIndices.length; i += 2) {
      const seed = Math.random();
      lineSeeds[i] = seed;
      lineSeeds[i + 1] = seed;
    }

    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', this.geometry.getAttribute('position'));
    wireGeo.setAttribute('color', this.geometry.getAttribute('color'));
    wireGeo.setAttribute('aLineSeed', new THREE.BufferAttribute(lineSeeds, 1));
    wireGeo.setIndex(this.allIndices);

    // 1. Standard Material (renders lines that NOT in XOR set)
    const stdMat = new THREE.LineBasicMaterial({
      color: 0xffffff, // Set to white to avoid filtering vertex colors
      vertexColors: true,
      transparent: true,
      opacity: 0.4, // Increased opacity since it's no longer additive
      blending: THREE.NormalBlending,
      depthWrite: false
    });

    stdMat.onBeforeCompile = (shader) => {
      shader.uniforms.uLineNear = this.customUniforms.uLineNear;
      shader.uniforms.uLineFar = this.customUniforms.uLineFar;
      shader.uniforms.uThinning = this.customUniforms.uThinning;
      shader.uniforms.uLineDensity = this.customUniforms.uLineDensity;
      shader.uniforms.uXorThreshold = this.customUniforms.uXorThreshold;
      shader.uniforms.uColorInfluence = this.customUniforms.uColorInfluence;
      shader.uniforms.uLineOpacity = this.customUniforms.uLineOpacity;
      shader.uniforms.uInvertInfluence = this.customUniforms.uInvertInfluence;
      shader.uniforms.uPalette = this.customUniforms.uPalette;
      shader.uniforms.uPlayX = this.customUniforms.uPlayX;
      shader.uniforms.uPlayRange = this.customUniforms.uPlayRange;
      shader.uniforms.uSpine = this.customUniforms.uSpine;
      shader.uniforms.uAudioLevel = this.customUniforms.uAudioLevel;

      shader.vertexShader = `
        attribute float aLineSeed;
        varying float vDistAlpha;
        varying float vSeed;
        varying float vLineSeed;
        varying float vPosX;
        uniform float uLineNear;
        uniform float uLineFar;
        uniform float uAudioLevel;
        uniform float uPlayX;
        uniform float uTime;
        uniform vec3 uSpine[20];

        // Simplex 3D Noise 
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        float snoise(vec3 v) {
            const vec2 C = vec2(1.0/6.0, 1.0/3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min( g.xyz, l.zxy );
            vec3 i2 = max( g.xyz, l.zxy );
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            i = mod289(i);
            vec4 p = permute( permute( permute( 
                        i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
            float n_ = 0.142857142857;
            vec3  ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );
            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4( x.xy, y.xy );
            vec4 b1 = vec4( x.zw, y.zw );
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
            vec3 p0 = vec3(a0.xy,h.x);
            vec3 p1 = vec3(a0.zw,h.y);
            vec3 p2 = vec3(a1.xy,h.z);
            vec3 p3 = vec3(a1.zw,h.w);
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                            dot(p2,x2), dot(p3,x3) ) );
        }

        vec3 getSoupOffset(vec3 pos, float time) {
            float noise = snoise(pos * 2.0 + time * 0.5);
            float noise2 = snoise(pos * 2.0 + time * 0.5 + 100.0);
            float noise3 = snoise(pos * 2.0 + time * 0.5 + 200.0);
            return vec3(noise, noise2, noise3) * 3.0;
        }

        vec3 getSpineOffset(float x) {
          float stepSize = 50.0 / 19.0;
          float idx = (x + 25.0) / stepSize;
          int i = int(idx);
          float f = fract(idx);
          if (i < 0) return vec3(0.0);
          if (i >= 19) return uSpine[19] - vec3(25.0, 0.0, 0.0);
          vec3 p0 = uSpine[i];
          vec3 p1 = uSpine[i+1];
          vec3 currentPos = mix(p0, p1, f);
          vec3 originalPos = vec3(x, 0.0, 0.0);
          return currentPos - originalPos;
         }

      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        // transformed is already defined (vec3 transformed = vec3(position))
        
        // 1. Add Soup
        transformed += getSoupOffset(position, uTime);

        // 2. Add Spine
        transformed += getSpineOffset(transformed.x);

         // Audio Bounce Physics (Lines)
        if (uAudioLevel > 0.01 && uPlayX > -9000.0) {
            float dist = abs(position.x - uPlayX);
            float influence = smoothstep(3.0, 0.0, dist);
            
            vec3 radial = vec3(0.0, position.y, position.z);
            float rLen = length(radial);
            if (rLen > 0.001) radial = normalize(radial);
            else radial = vec3(0.0, 1.0, 0.0);

            transformed += radial * uAudioLevel * influence * 8.0;
        }
        
        vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        gl_Position = projectionMatrix * mvPosition;

        float dist = length(mvPosition.xyz);
        vDistAlpha = 1.0 - smoothstep(uLineNear, uLineFar, dist);
        vSeed = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
        vLineSeed = aLineSeed;
        vPosX = position.x;
        `
      );

      shader.fragmentShader = `
        varying float vDistAlpha;
        varying float vSeed;
        varying float vLineSeed;
        varying float vPosX;
        uniform float uThinning;
        uniform float uLineDensity;
        uniform float uXorThreshold;
        uniform float uColorInfluence;
        uniform float uLineOpacity;
        uniform float uInvertInfluence;
        uniform float uPlayX;
        uniform float uPlayRange;
        uniform vec3 uPalette[6];

        float getHue(vec3 rgb) {
            float minVal = min(min(rgb.r, rgb.g), rgb.b);
            float maxVal = max(max(rgb.r, rgb.g), rgb.b);
            float delta = maxVal - minVal;
            float h = 0.0;
            if (delta > 0.0) {
              if (maxVal == rgb.r) h = (rgb.g - rgb.b) / delta;
              else if (maxVal == rgb.g) h = 2.0 + (rgb.b - rgb.r) / delta;
              else h = 4.0 + (rgb.r - rgb.g) / delta;
              h /= 6.0;
              if (h < 0.0) h += 1.0;
            }
            return h;
        }

        vec3 applyPalette(vec3 rgb) {
            float h = getHue(rgb);
            float p = h * 5.0;
            int i = int(p);
            float f = fract(p);
            
            if (i == 0) return mix(uPalette[0], uPalette[1], f);
            if (i == 1) return mix(uPalette[1], uPalette[2], f);
            if (i == 2) return mix(uPalette[2], uPalette[3], f);
            if (i == 3) return mix(uPalette[3], uPalette[4], f);
            if (i == 4) return mix(uPalette[4], uPalette[5], f);
            return uPalette[5];
        }
      ` + shader.fragmentShader;

      // We rewrite the color influence from scratch to ensure a 90/10 Cyan/Node split 
      // without standard vertex color multiplication washing it out.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        vec3 baseCyan = vec3(0.0, 0.95, 1.0);
        vec3 pColor = applyPalette(vColor);
        // Toggle between direct and inverted influence
        vec3 targetColor = mix(pColor, vec3(1.0) - pColor, uInvertInfluence);
        diffuseColor.rgb = mix(baseCyan, targetColor, uColorInfluence);
        
        // Hide if this line is in the XOR pool
        if (vLineSeed < uXorThreshold) discard;

        // Playback Glow
        if (uPlayX > -9000.0) {
            float playDist = abs(vPosX - uPlayX);
            // Strong white glow
            float playGlow = smoothstep(uPlayRange, 0.0, playDist);
            
            // Additive boost
            diffuseColor.rgb += vec3(1.0, 1.0, 1.0) * playGlow * 1.0;
             // Boost alpha significantly
            diffuseColor.a = max(diffuseColor.a, playGlow);
        }
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `
        #include <alphatest_fragment>
        float fog = pow(vDistAlpha, 2.0);
        float thinningAlpha = mix(1.0, pow(fog, 4.0), uThinning);

        if (vSeed > uLineDensity) discard;
        float alphaBoost = 1.0 + (1.0 - uLineDensity) * 1.5;
        diffuseColor.a = uLineOpacity * thinningAlpha * fog * alphaBoost;
        if (diffuseColor.a < 0.005) discard;
        `
      );
    };

    // 2. XOR Material (renders lines that ARE in XOR set)
    const xorMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneMinusDstColorFactor,
      blendDst: THREE.OneMinusSrcColorFactor,
      depthWrite: false,
      depthTest: false // Always render on top
    });

    xorMat.onBeforeCompile = (shader) => {
      shader.uniforms.uLineNear = this.customUniforms.uLineNear;
      shader.uniforms.uLineFar = this.customUniforms.uLineFar;
      shader.uniforms.uThinning = this.customUniforms.uThinning;
      shader.uniforms.uXorDensity = this.customUniforms.uXorDensity;
      shader.uniforms.uXorThreshold = this.customUniforms.uXorThreshold;
      shader.uniforms.uColorInfluence = this.customUniforms.uColorInfluence;
      shader.uniforms.uLineOpacity = this.customUniforms.uLineOpacity;
      shader.uniforms.uInvertInfluence = this.customUniforms.uInvertInfluence;
      shader.uniforms.uPalette = this.customUniforms.uPalette;
      shader.uniforms.uInvertInfluence = this.customUniforms.uInvertInfluence;
      shader.uniforms.uSpine = this.customUniforms.uSpine;
      shader.uniforms.uAudioLevel = this.customUniforms.uAudioLevel;

      shader.vertexShader = `
        attribute float aLineSeed;
        varying float vDistAlpha;
        varying float vLineSeed;
        uniform float uLineNear;
        uniform float uLineFar;
        uniform float uAudioLevel;
        uniform float uPlayX;
        uniform float uTime;
        uniform vec3 uSpine[20];
        
        // Simplex 3D Noise 
        vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
        vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
        vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
        float snoise(vec3 v) {
            const vec2 C = vec2(1.0/6.0, 1.0/3.0);
            const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min( g.xyz, l.zxy );
            vec3 i2 = max( g.xyz, l.zxy );
            vec3 x1 = x0 - i1 + C.xxx;
            vec3 x2 = x0 - i2 + C.yyy;
            vec3 x3 = x0 - D.yyy;
            i = mod289(i);
            vec4 p = permute( permute( permute( 
                        i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
            float n_ = 0.142857142857;
            vec3  ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );
            vec4 x = x_ *ns.x + ns.yyyy;
            vec4 y = y_ *ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4( x.xy, y.xy );
            vec4 b1 = vec4( x.zw, y.zw );
            vec4 s0 = floor(b0)*2.0 + 1.0;
            vec4 s1 = floor(b1)*2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
            vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
            vec3 p0 = vec3(a0.xy,h.x);
            vec3 p1 = vec3(a0.zw,h.y);
            vec3 p2 = vec3(a1.xy,h.z);
            vec3 p3 = vec3(a1.zw,h.w);
            vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                            dot(p2,x2), dot(p3,x3) ) );
        }
        
        vec3 getSoupOffset(vec3 pos, float time) {
            float noise = snoise(pos * 2.0 + time * 0.5);
            float noise2 = snoise(pos * 2.0 + time * 0.5 + 100.0);
            float noise3 = snoise(pos * 2.0 + time * 0.5 + 200.0);
            return vec3(noise, noise2, noise3) * 3.0;
        }

        vec3 getSpineOffset(float x) {
          float stepSize = 50.0 / 19.0;
          float idx = (x + 25.0) / stepSize;
          int i = int(idx);
          float f = fract(idx);
          if (i < 0) return vec3(0.0);
          if (i >= 19) return uSpine[19] - vec3(25.0, 0.0, 0.0);
          vec3 p0 = uSpine[i];
          vec3 p1 = uSpine[i+1];
          vec3 currentPos = mix(p0, p1, f);
          vec3 originalPos = vec3(x, 0.0, 0.0);
          return currentPos - originalPos;
         }
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        // transformed is already defined
        
        // 1. Add Soup
        transformed += getSoupOffset(position, uTime);

        // 2. Add Spine
        transformed += getSpineOffset(transformed.x);
        
        // Audio Bounce Physics (Lines)
        if (uAudioLevel > 0.01 && uPlayX > -9000.0) {
            float dist = abs(position.x - uPlayX);
            float influence = smoothstep(3.0, 0.0, dist);
            
            vec3 radial = vec3(0.0, position.y, position.z);
            float rLen = length(radial);
            if (rLen > 0.001) radial = normalize(radial);
            else radial = vec3(0.0, 1.0, 0.0);

            transformed += radial * uAudioLevel * influence * 8.0;
        }

        vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
        gl_Position = projectionMatrix * mvPosition;

        float dist = length(mvPosition.xyz);
        vDistAlpha = 1.0 - smoothstep(uLineNear, uLineFar, dist);
        vLineSeed = aLineSeed;
        `
      );

      shader.fragmentShader = `
        varying float vDistAlpha;
        varying float vLineSeed;
        uniform float uThinning;
        uniform float uXorDensity;
        uniform float uXorThreshold;
        uniform float uColorInfluence;
        uniform float uLineOpacity;
        uniform float uInvertInfluence;
        uniform vec3 uPalette[6];

        float getHue(vec3 rgb) {
            float minVal = min(min(rgb.r, rgb.g), rgb.b);
            float maxVal = max(max(rgb.r, rgb.g), rgb.b);
            float delta = maxVal - minVal;
            float h = 0.0;
            if (delta > 0.0) {
              if (maxVal == rgb.r) h = (rgb.g - rgb.b) / delta;
              else if (maxVal == rgb.g) h = 2.0 + (rgb.b - rgb.r) / delta;
              else h = 4.0 + (rgb.r - rgb.g) / delta;
              h /= 6.0;
              if (h < 0.0) h += 1.0;
            }
            return h;
        }

        vec3 applyPalette(vec3 rgb) {
            float h = getHue(rgb);
            float p = h * 5.0;
            int i = int(p);
            float f = fract(p);

            if (i == 0) return mix(uPalette[0], uPalette[1], f);
            if (i == 1) return mix(uPalette[1], uPalette[2], f);
            if (i == 2) return mix(uPalette[2], uPalette[3], f);
            if (i == 3) return mix(uPalette[3], uPalette[4], f);
            if (i == 4) return mix(uPalette[4], uPalette[5], f);
            return uPalette[5];
        }
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
        vec3 baseCyan = vec3(0.0, 0.95, 1.0);
        vec3 pColor = applyPalette(vColor);
        // Direct smooth mix from Cyan to the node's color (or its inverse)
        vec3 targetColor = mix(pColor, vec3(1.0) - pColor, uInvertInfluence);
        diffuseColor.rgb = mix(baseCyan, targetColor, uColorInfluence);
        
        // Hide if this line is NOT in the XOR pool
        if (vLineSeed >= uXorThreshold) discard;
        `
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `
        #include <alphatest_fragment>
        float fog = pow(vDistAlpha, 2.0);
        float thinningAlpha = mix(1.0, pow(fog, 3.0), uThinning);

        diffuseColor.a = uLineOpacity * uXorDensity * thinningAlpha * fog;
        if (diffuseColor.a < 0.001) discard;
        `
      );
    };

    this.stdWire = new THREE.LineSegments(wireGeo, stdMat);
    this.xorWire = new THREE.LineSegments(wireGeo, xorMat);

    // Standard lines background, nodes middle, XOR lines always foreground
    this.stdWire.renderOrder = 1;
    this.xorWire.renderOrder = 30; // Maximum priority

    group.add(this.stdWire);
    group.add(this.xorWire);
  }

  setLineDist(dist) {
    // Map 0-100 slider to a more useful 2-150 range for distance fading
    const effectiveNear = 2 + (dist / 100) * 148;
    this.targetUniforms.uLineNear = effectiveNear;
    this.targetUniforms.uLineFar = effectiveNear * 1.5;
  }

  setNodeDist(dist) {
    const effectiveNear = 2 + (dist / 100) * 148;
    this.targetUniforms.uNodeNear = effectiveNear;
    this.targetUniforms.uNodeFar = effectiveNear * 1.5;
  }

  setThinning(intensity) {
    this.targetUniforms.uThinning = intensity;
  }

  setLineDensity(val) {
    this.targetUniforms.uLineDensity = val / 100;
  }

  setNodeDensity(val) {
    this.targetUniforms.uNodeDensity = val / 100;
  }

  setXorDensity(val) {
    // Keep a minimum floor of visibility so we always see some XOR lines
    const floorOpacity = 0.008;
    let opacity;

    // Quadratic curve for ultra-smooth low-end control
    if (val <= 33) {
      opacity = floorOpacity + Math.pow(val / 33, 2.0) * 0.06;
    } else {
      opacity = 0.068 + 0.1 * Math.pow(100, (val - 33) / 67);
    }

    this.targetUniforms.uXorDensity = opacity;

    // Smooth Transition: instead of rebuilding geometry, update the shader threshold
    this.targetUniforms.uXorThreshold = Math.max(0.005, (val / 100) * 0.05);
  }

  setManualHeight(val) {
    const heightFactor = this.modelHeight / 15.0;
    const targetY = this.modelBottom + (val * heightFactor);
    const deltaY = targetY - this.lastPanY;
    this.lastPanY = targetY;

    this.camera.position.y += deltaY;
    this.controls.target.y += deltaY;
    this.controls.update();
  }

  setPulse(enabled) {
    if (this.customUniforms) {
      this.customUniforms.uPulseEnabled.value = enabled ? 1.0 : 0.0;
    }
  }

  setBaseSize(size) {
    this.baseSize = size;
  }

  setLFOAmount(amount) {
    this.lfoAmount = amount;
  }

  setLFOSpeed(speed) {
    this.lfoSpeed = speed;
  }

  setPanSpeed(speed) {
    this.panSpeed = speed;
  }

  setRotSpeed(speed) {
    this.rotSpeed = speed;
    if (this.controls) {
      this.controls.autoRotateSpeed = speed;
    }
  }

  setPanMin(val) {
    this.panMin = val;
  }

  setPanMax(val) {
    this.panMax = val;
  }

  toggleAutoPan() {
    this.autoPan = !this.autoPan;
    return this.autoPan;
  }

  // Audio Methods
  async loadAudio(file) {
    if (this.crystalGroup) {
      this.scene.remove(this.crystalGroup);
      if (this.geometry) this.geometry.dispose();
      this.crystalGroup = null;
    }
    this.stopAudio();

    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.connect(this.audioCtx.destination);
    }

    const arrayBuffer = await file.arrayBuffer();
    this.audioBuffer = await decodeAudio(arrayBuffer);
    this.audioDuration = this.audioBuffer.duration;

    const { meshResult, stats } = this.parseAudio(this.audioBuffer);
    this.crystalGroup = meshResult;
    this.scene.add(this.crystalGroup);

    this.fitCameraToSelection();

    return stats;
  }

  parseAudio(buffer) {
    const channels = buffer.numberOfChannels;
    const dataL = buffer.getChannelData(0);
    const dataR = channels > 1 ? buffer.getChannelData(1) : dataL;

    const positions = [];
    const colors = [];
    const allIndices = [];

    const totalSamples = dataL.length;
    // Reduce target points to keep total vertex count reasonable with 8 segments/step
    // 2000 steps * 8 vertices = 16,000 vertices (similar to previous 15,000)
    const targetSteps = 2000;
    const step = Math.floor(totalSamples / targetSteps);

    const timeScale = 0.025;
    const ampScale = 20.0;
    const baseRadius = 0.08;
    const segments = 8; // Octagonal rings

    let previousRingStartRaw = -1;
    let lpValL = 0;
    let lpValR = 0;

    // New Filter Logic: Run filter on a tighter stride to capture ~400Hz properly
    // Audio rate ~44-48kHz. Stride 10 => ~4.4kHz effective rate.
    // Cutoff ~400Hz. RC Time constant logic... roughly alpha ~ 0.45 for this ratio.
    const filterStride = 10;
    const alpha = 0.45;
    let nextVizIndex = 0; // When to generate the next ring

    for (let i = 0; i < totalSamples; i += filterStride) {
      if (i >= totalSamples) break;

      // 1. Run Filter on every stride step
      const rawL = dataL[i] || 0;
      const rawR = dataR[i] || 0;
      lpValL += alpha * (rawL - lpValL);
      lpValR += alpha * (rawR - lpValR);

      // 2. Visualization Trigger
      if (i >= nextVizIndex) {
        nextVizIndex += step; // Advance target

        // Capture State
        let bass = (lpValL + lpValR) * 0.5;
        let treble = ((rawL - lpValL) + (rawR - lpValR)) * 0.5;

        // Rectify
        let bassAmp = Math.abs(bass);
        let trebleAmp = Math.abs(treble);

        const x = (i / totalSamples) * (totalSamples / step) * timeScale;
        const ringStart = positions.length / 3;
        const ringRotation = Math.random() * Math.PI * 2;

        for (let s = 0; s < segments; s++) {
          const baseAngle = (s / segments) * Math.PI * 2;
          const angle = baseAngle + ringRotation;
          const sinV = Math.sin(angle); // -1 (Bottom) to +1 (Top)

          let targetAmp = 0;
          let extraSpike = 0;
          let isBassRegion = false;

          if (sinV < -0.2) {
            // Bottom: "Blue Pea" / Bloopy Bass
            // Smooth shape, large amplitude
            targetAmp = bassAmp * 12.0;
            // Add a minimum "pea" size so it's always visible
            if (targetAmp < 0.05) targetAmp = 0.05;
            isBassRegion = true;
          } else if (sinV > 0.2) {
            // Top: Sharp Treble
            targetAmp = trebleAmp * 12.0;
            if (trebleAmp > 0.02) {
              extraSpike = Math.random() * trebleAmp * 8.0;
            }
          } else {
            // Middle blend
            targetAmp = (bassAmp + trebleAmp) * 3.0;
          }

          // Reduce noise on bass to keep it "bloopy"
          const noiseAmount = isBassRegion ? 0.02 : 0.15;
          const noise = (Math.random() * noiseAmount);

          const radius = baseRadius + targetAmp + noise + extraSpike;

          // Coordinates
          const jAmount = 0.05; // Less jitter overall
          const jX = (Math.random() - 0.5) * jAmount;
          const jY = (Math.random() - 0.5) * jAmount;
          const jZ = (Math.random() - 0.5) * jAmount;

          const y = Math.sin(angle) * radius;
          const z = Math.cos(angle) * radius;

          positions.push(x + jX, y + jY, z + jZ);

          // COLOR LOGIC
          // Blue Pea => Bottom is Blue/Cyan
          if (isBassRegion) {
            // Deep Blue / Cyan for bass
            // H: 0.5 (Cyan) - 0.65 (Blue)
            const bHue = 0.5 + (bassAmp * 0.2);
            colors.push(0.1, 0.5 + bassAmp * 5.0, 1.0); // Boost Blue channel
          } else {
            // Top / Standard
            const hue = ((x * 0.05) + (angle / (Math.PI * 2))) % 1.0;
            const color = new THREE.Color().setHSL(hue, 1.0, 0.5);
            colors.push(color.r, color.g, color.b);
          }
        }

        // Connectivity Logic (Same as before)
        if (previousRingStartRaw >= 0) {
          for (let s = 0; s < segments; s++) {
            const currentIdx = ringStart + s;
            const prevIdx = previousRingStartRaw + s;
            const nextSeg = (s + 1) % segments;
            const currentNextIdx = ringStart + nextSeg;
            const prevNextIdx = previousRingStartRaw + nextSeg;

            allIndices.push(prevIdx, currentIdx);
            allIndices.push(currentIdx, currentNextIdx);
            if (Math.random() > 0.4) allIndices.push(prevIdx, currentNextIdx);
            if (Math.random() > 0.4) allIndices.push(prevNextIdx, currentIdx);
          }
        }
        previousRingStartRaw = ringStart;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.center();

    this.geometry = geometry;
    this.allIndices = allIndices;

    geometry.computeBoundingBox();
    if (geometry.boundingBox) {
      this.modelHeight = geometry.boundingBox.max.y - geometry.boundingBox.min.y;
      this.modelBottom = geometry.boundingBox.min.y;
    }

    const group = new THREE.Group();

    const pointMaterial = new THREE.PointsMaterial({
      size: this.baseSize,
      vertexColors: true,
      transparent: true,
      opacity: 1.0,
      map: createCircleTexture(),
      alphaTest: 0.001,
      depthWrite: true,
      blending: THREE.NormalBlending,
      sizeAttenuation: true
    });
    this.pointMaterial = pointMaterial;

    pointMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.customUniforms.uTime;
      shader.uniforms.uPulseEnabled = this.customUniforms.uPulseEnabled;
      shader.uniforms.uNodeNear = this.customUniforms.uNodeNear;
      shader.uniforms.uNodeFar = this.customUniforms.uNodeFar;
      shader.uniforms.uNodeDensity = this.customUniforms.uNodeDensity;
      shader.uniforms.uNodeSaturation = this.customUniforms.uNodeSaturation;
      shader.uniforms.uNodeOpacity = this.customUniforms.uNodeOpacity;
      shader.uniforms.uPalette = this.customUniforms.uPalette;
      shader.uniforms.uPlayX = this.customUniforms.uPlayX;
      shader.uniforms.uPlayRange = this.customUniforms.uPlayRange;
      shader.uniforms.uAudioLevel = this.customUniforms.uAudioLevel;
      shader.uniforms.uSpine = this.customUniforms.uSpine;

      shader.vertexShader = `
      varying float vAlpha;
      varying float vPosX;
      varying float vPulse;
      varying float vDistAlpha;
      varying float vSeed;

      uniform float uTime;
      uniform float uNodeNear;
      uniform float uNodeFar;
      uniform float uNodeDensity;
      uniform float uNodeSaturation;
      uniform float uNodeOpacity;
      uniform float uPulseEnabled;
      uniform float uAudioLevel;
      uniform float uPlayX;
      uniform float uPlayRange;
      uniform vec3 uPalette[6];
      uniform vec3 uSpine[20];
      
      // Simplex 3D Noise 
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
      vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
      
      float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy));
        vec3 x0 = v - dot(i, C.xxx);
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute( permute( permute( 
                  i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                + i.y + vec4(0.0, i1.y, i2.y, 1.0 )) 
                + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x;
        p1 *= norm.y;
        p2 *= norm.z;
        p3 *= norm.w;
        vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 42.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), 
                                      dot(p2,x2), dot(p3,x3) ) );
      }

      vec3 getSoupOffset(vec3 pos, float time) {
          float noise = snoise(pos * 2.0 + time * 0.5);
          float noise2 = snoise(pos * 2.0 + time * 0.5 + 100.0);
          float noise3 = snoise(pos * 2.0 + time * 0.5 + 200.0);
          return vec3(noise, noise2, noise3) * 3.0;
      }
      
      vec3 getSpineOffset(float x) {
          float stepSize = 50.0 / 19.0;
          float idx = (x + 25.0) / stepSize;
          int i = int(idx);
          float f = fract(idx);
          if (i < 0) return vec3(0.0);
          if (i >= 19) return uSpine[19] - vec3(25.0, 0.0, 0.0);
          vec3 p0 = uSpine[i];
          vec3 p1 = uSpine[i+1];
          vec3 currentPos = mix(p0, p1, f);
          vec3 originalPos = vec3(x, 0.0, 0.0);
          return currentPos - originalPos;
      }
    ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
                #include <begin_vertex>
                vPulse = 0.0;
                if (uPulseEnabled > 0.5) {
                  float offset = sin(position.x * 0.5) + cos(position.y * 0.5);
                  float wave = sin(position.z * 0.2 + uTime * 2.5 + offset * 0.5);
                  vPulse = smoothstep(0.9, 1.0, wave);
                }
                
                // Audio Bounce Physics
                if (uAudioLevel > 0.01 && uPlayX > -9000.0) {
                   float dist = abs(position.x - uPlayX);
                   float influence = smoothstep(3.0, 0.0, dist); // Tight influence
                   
                   // Radial Expansion (Speaker Cone Effect)
                   // Calculate direction away from center axis (X-axis)
                   vec3 radial = vec3(0.0, position.y, position.z);
                   float rLen = length(radial);
                   if (rLen > 0.001) radial = normalize(radial);
                   else radial = vec3(0.0, 1.0, 0.0);

                   // Throb/Bounce
                   // mix of radial expansion and a little bit of chaotic twist
                   transformed += radial * uAudioLevel * influence * 8.0; 
                }
                `
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `
        // transformed is already defined in begin_vertex
      
      // 1. Add "Soup" Float
      transformed += getSoupOffset(position, uTime);
      
      // 2. Add Physics Spine Offset
      vec3 spineOffset = getSpineOffset(transformed.x);
      transformed += spineOffset;

      // Audio Bounce Physics
      if (uAudioLevel > 0.01 && uPlayX > -9000.0) {
         float dist = abs(position.x - uPlayX);
         float influence = smoothstep(3.0, 0.0, dist); // Tight influence
         
         // Radial Expansion (Speaker Cone Effect)
         vec3 radial = vec3(0.0, position.y, position.z);
         float rLen = length(radial);
         if (rLen > 0.001) radial = normalize(radial);
         else radial = vec3(0.0, 1.0, 0.0);

         // Throb/Bounce
         transformed += radial * uAudioLevel * influence * 8.0; 
      }

      vec4 mvPosition = modelViewMatrix * vec4( transformed, 1.0 );
      gl_Position = projectionMatrix * mvPosition;
      
      vPosX = position.x;
      
              float dist = length(mvPosition.xyz);
              vDistAlpha = 1.0 - smoothstep(uNodeNear, uNodeFar, dist);
              vSeed = fract(sin(dot(position.xyz, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
              gl_PointSize *= mix(0.2, 1.0, smoothstep(0.0, 15.0 * 0.5, length(position.xyz)));
              `
      );

      shader.fragmentShader = `
                varying float vPulse;
                varying float vDistAlpha;
                varying float vSeed;
                varying float vPosX;
                uniform float uNodeDensity;
                uniform float uNodeSaturation;
                uniform float uNodeOpacity;
                uniform float uPlayX;
                uniform float uPlayRange;
                uniform vec3 uPalette[6];
                
                float getHue(vec3 rgb) {
                  float minVal = min(min(rgb.r, rgb.g), rgb.b);
                  float maxVal = max(max(rgb.r, rgb.g), rgb.b);
                  float delta = maxVal - minVal;
                  float h = 0.0;
                  if (delta > 0.0) {
                    if (maxVal == rgb.r) h = (rgb.g - rgb.b) / delta;
                    else if (maxVal == rgb.g) h = 2.0 + (rgb.b - rgb.r) / delta;
                    else h = 4.0 + (rgb.r - rgb.g) / delta;
                    h /= 6.0;
                    if (h < 0.0) h += 1.0;
                  }
                  return h;
                }
  
                vec3 applyPalette(vec3 rgb) {
                  float h = getHue(rgb);
                  float p = h * 5.0;
                  int i = int(p);
                  float f = fract(p);
                  if (i == 0) return mix(uPalette[0], uPalette[1], f);
                  if (i == 1) return mix(uPalette[1], uPalette[2], f);
                  if (i == 2) return mix(uPalette[2], uPalette[3], f);
                  if (i == 3) return mix(uPalette[3], uPalette[4], f);
                  if (i == 4) return mix(uPalette[4], uPalette[5], f);
                  return uPalette[5];
              }
              ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `
                #include <color_fragment>
                diffuseColor.rgb = applyPalette(diffuseColor.rgb);
                float gray = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
                vec3 desaturated = vec3(gray);
                diffuseColor.rgb = mix(desaturated, diffuseColor.rgb, uNodeSaturation * 2.0);
                vec3 cyan = vec3(0.0, 0.9, 1.0);
                diffuseColor.rgb = mix(diffuseColor.rgb, cyan, 0.7 * (1.1 - uNodeSaturation));
                float fog = pow(vDistAlpha, 2.0);
                const float uXorThreshold = 0.0115;
                if (vSeed > uNodeDensity) discard;
                float alphaBoost = 1.0 + (1.0 - uNodeDensity) * 4.0;
                diffuseColor.a *= fog * alphaBoost * uNodeOpacity;
                diffuseColor.rgb *= 1.3;
                if (vPulse > 0.01) {
                   diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.6, 1.0, 1.0), vPulse * 0.7);
                }
                if (uPlayX > -9000.0) {
                   float playDist = abs(vPosX - uPlayX);
                   float playGlow = smoothstep(uPlayRange, 0.0, playDist);
                   diffuseColor.rgb += vec3(1.0, 1.0, 1.0) * playGlow;
                   diffuseColor.a = max(diffuseColor.a, playGlow);
                }
                `
      );
    };

    const mesh = new THREE.Points(geometry, pointMaterial);
    mesh.renderOrder = 20;
    group.add(mesh);

    this.buildLines(group);

    return {
      meshResult: group,
      stats: {
        nodes: positions.length / 3,
        links: allIndices.length / 2,
        layers: 2
      }
    }
  }

  toggleAudio() {
    if (!this.audioCtx) return false;
    if (this.isPlaying) {
      this.pauseAudio();
    } else {
      this.playAudio();
    }
    return this.isPlaying;
  }

  playAudio() {
    if (this.isPlaying || !this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

    this.audioSource = this.audioCtx.createBufferSource();
    this.audioSource.buffer = this.audioBuffer;
    this.analyserNode = this.audioCtx.createAnalyser(); // [NEW]
    this.analyserNode.fftSize = 256;
    this.audioSource.connect(this.analyserNode);
    this.analyserNode.connect(this.gainNode);
    // this.audioSource.connect(this.gainNode); // Removed direct connect

    const offset = this.audioPauseTime;
    this.audioSource.start(0, offset);
    this.audioStartTime = this.audioCtx.currentTime - offset;
    this.isPlaying = true;
  }

  pauseAudio() {
    if (!this.isPlaying) return;
    try { this.audioSource.stop(); } catch (e) { }
    this.audioPauseTime = this.audioCtx.currentTime - this.audioStartTime;
    this.isPlaying = false;
  }

  stopAudio() {
    if (this.isPlaying) {
      try { this.audioSource.stop(); } catch (e) { }
      this.isPlaying = false;
    }
    this.audioPauseTime = 0;
    this.customUniforms.uPlayX.value = -9999.0;
  }

  getAudioProgress() {
    if (!this.audioBuffer) return 0;
    let duration = this.audioDuration || 1;
    let t;
    if (this.isPlaying) t = this.audioCtx.currentTime - this.audioStartTime;
    else t = this.audioPauseTime;

    if (t > duration) {
      t = duration;
      if (this.isPlaying) this.stopAudio();
    }
    return Math.max(0, Math.min(1.0, t / duration));
  }

  toggleMute() {
    if (!this.gainNode) return false;
    this.isMuted = !this.isMuted;
    this.gainNode.gain.setValueAtTime(this.isMuted ? 0 : 1, this.audioCtx.currentTime);
    return this.isMuted;
  }
}

