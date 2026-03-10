import * as THREE from 'three';

const BRAND = new THREE.Color(0x45d0c1);
const BRAND_HEX = 0x45d0c1;
const GRAY_LIGHT = 0xd1d5db;
const GRAY_DARK = 0x4b5563;

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
}

interface Edge {
  from: string;
  to: string;
}

const NODES: Node[] = [
  { id: 'task', label: 'TASK', x: -7, y: 0 },
  { id: 'refine', label: 'REFINE', x: -4, y: 0 },

  { id: 'code-be', label: 'BACKEND', x: -0.5, y: 1.6 },
  { id: 'code-fe', label: 'FRONTEND', x: -0.5, y: -1.6 },

  { id: 'review', label: 'REVIEW', x: 2.8, y: 0 },

  { id: 'qa-be', label: 'QA API', x: 5.5, y: 1.2 },
  { id: 'qa-fe', label: 'QA UI', x: 5.5, y: -1.2 },

  { id: 'pr', label: 'PR', x: 8.2, y: 1.4 },
  { id: 'slack', label: 'SLACK', x: 8.2, y: 0 },
  { id: 'linear', label: 'LINEAR', x: 8.2, y: -1.4 },
];

const EDGES: Edge[] = [
  { from: 'task', to: 'refine' },
  { from: 'refine', to: 'code-be' },
  { from: 'refine', to: 'code-fe' },
  { from: 'code-be', to: 'review' },
  { from: 'code-fe', to: 'review' },
  { from: 'review', to: 'qa-be' },
  { from: 'review', to: 'qa-fe' },
  { from: 'qa-be', to: 'pr' },
  { from: 'qa-be', to: 'slack' },
  { from: 'qa-fe', to: 'slack' },
  { from: 'qa-fe', to: 'linear' },
];

const PARTICLES_PER_EDGE = 18;
const AMBIENT_COUNT = 500;
const DUST_COUNT = 1200;
const DUST_NEAR_COUNT = 500;

export function createPipelineScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0.5, 0.5, 18);
  camera.lookAt(0.5, 0, 0);

  const isDark = () => document.documentElement.classList.contains('dark');

  const nodeMap = new Map<string, Node>();
  NODES.forEach((n) => nodeMap.set(n.id, n));

  const sphereGeo = new THREE.SphereGeometry(1, 24, 24);
  const ringGeo = new THREE.RingGeometry(1, 1.25, 32);
  const nodeMeshes: THREE.Mesh[] = [];
  const nodeRings: THREE.Mesh[] = [];
  const nodeGlows: THREE.Sprite[] = [];
  const nodeLabels: THREE.Sprite[] = [];

  const depthMap = new Map<number, number>();
  const uniqueXs = [...new Set(NODES.map((n) => n.x))].sort((a, b) => a - b);
  uniqueXs.forEach((x, i) => depthMap.set(x, i));
  const maxDepth = uniqueXs.length - 1;

  NODES.forEach((node) => {
    const size = 0.28;

    const mat = new THREE.MeshBasicMaterial({
      color: GRAY_LIGHT,
      transparent: true,
      opacity: 0.6,
    });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.position.set(node.x, node.y, 0);
    mesh.scale.setScalar(size);
    scene.add(mesh);
    nodeMeshes.push(mesh);

    const ringMat = new THREE.MeshBasicMaterial({
      color: BRAND_HEX,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.set(node.x, node.y, 0);
    ring.scale.setScalar(size * 1.8);
    scene.add(ring);
    nodeRings.push(ring);

    const glow = createGlowSprite();
    glow.position.set(node.x, node.y, 0);
    glow.visible = false;
    scene.add(glow);
    nodeGlows.push(glow);

    const label = createTextSprite(node.label, isDark());
    label.position.set(node.x, node.y - 0.55, 0);
    label.name = node.label;
    scene.add(label);
    nodeLabels.push(label);
  });

  const edgeCurves: THREE.QuadraticBezierCurve3[] = [];

  EDGES.forEach((edge) => {
    const from = nodeMap.get(edge.from)!;
    const to = nodeMap.get(edge.to)!;
    const fromV = new THREE.Vector3(from.x, from.y, 0);
    const toV = new THREE.Vector3(to.x, to.y, 0);

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const dy = to.y - from.y;
    const controlY = Math.abs(dy) > 0.5 ? from.y + dy * 0.35 : midY;
    const mid = new THREE.Vector3(midX, controlY, 0);

    const curve = new THREE.QuadraticBezierCurve3(fromV, mid, toV);
    edgeCurves.push(curve);
  });

  const totalParticles = EDGES.length * PARTICLES_PER_EDGE;
  const flowGeo = new THREE.BufferGeometry();
  const flowPos = new Float32Array(totalParticles * 3);
  const flowEdgeIdx = new Int32Array(totalParticles);
  const flowSpeed = new Float32Array(totalParticles);
  const flowOffset = new Float32Array(totalParticles);

  for (let i = 0; i < totalParticles; i++) {
    flowEdgeIdx[i] = Math.floor(i / PARTICLES_PER_EDGE);
    flowSpeed[i] = 0.08 + Math.random() * 0.14;
    flowOffset[i] = (i % PARTICLES_PER_EDGE) / PARTICLES_PER_EDGE + Math.random() * 0.05;
  }

  flowGeo.setAttribute('position', new THREE.BufferAttribute(flowPos, 3));

  const flowMat = new THREE.PointsMaterial({
    color: BRAND_HEX,
    size: 0.16,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  scene.add(new THREE.Points(flowGeo, flowMat));

  const ambientGeo = new THREE.BufferGeometry();
  const ambientPos = new Float32Array(AMBIENT_COUNT * 3);
  const ambientVel = new Float32Array(AMBIENT_COUNT * 3);

  for (let i = 0; i < AMBIENT_COUNT; i++) {
    ambientPos[i * 3] = (Math.random() - 0.5) * 22;
    ambientPos[i * 3 + 1] = (Math.random() - 0.5) * 8;
    ambientPos[i * 3 + 2] = (Math.random() - 0.5) * 5;
    ambientVel[i * 3] = (Math.random() - 0.5) * 0.002;
    ambientVel[i * 3 + 1] = (Math.random() - 0.5) * 0.001;
    ambientVel[i * 3 + 2] = (Math.random() - 0.5) * 0.001;
  }

  ambientGeo.setAttribute('position', new THREE.BufferAttribute(ambientPos, 3));
  const ambientMat = new THREE.PointsMaterial({
    color: BRAND_HEX,
    size: 0.04,
    transparent: true,
    opacity: 0.12,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  scene.add(new THREE.Points(ambientGeo, ambientMat));

  const dustGeo = new THREE.BufferGeometry();
  const dustPos = new Float32Array(DUST_COUNT * 3);
  const dustVel = new Float32Array(DUST_COUNT * 3);
  const dustSizes = new Float32Array(DUST_COUNT);
  const dustPhase = new Float32Array(DUST_COUNT);

  for (let i = 0; i < DUST_COUNT; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 24;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 10;
    dustPos[i * 3 + 2] = (Math.random() - 0.5) * 8 - 1;
    dustVel[i * 3] = (Math.random() - 0.5) * 0.004;
    dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.003;
    dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.002;
    dustSizes[i] = 0.02 + Math.random() * 0.06;
    dustPhase[i] = Math.random() * Math.PI * 2;
  }

  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('size', new THREE.BufferAttribute(dustSizes, 1));

  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x45d0c1) },
      uOpacity: { value: 0.2 },
    },
    vertexShader: `
      attribute float size;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float dist = length(position.xy - vec2(0.5, 0.0));
        float proximity = 1.0 - smoothstep(0.0, 8.0, dist);
        vAlpha = (0.3 + proximity * 0.7) * (0.5 + 0.5 * sin(uTime * 1.5 + position.x * 2.0 + position.y * 3.0));
        gl_PointSize = size * 500.0 / -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float alpha = smoothstep(0.5, 0.1, d) * vAlpha * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  scene.add(new THREE.Points(dustGeo, dustMat));

  const dustNearGeo = new THREE.BufferGeometry();
  const dustNearPos = new Float32Array(DUST_NEAR_COUNT * 3);
  const dustNearVel = new Float32Array(DUST_NEAR_COUNT * 3);
  const dustNearSizes = new Float32Array(DUST_NEAR_COUNT);

  for (let i = 0; i < DUST_NEAR_COUNT; i++) {
    const edgeIdx = Math.floor(Math.random() * EDGES.length);
    const curve = edgeCurves[edgeIdx];
    const t = Math.random();
    const pt = curve.getPoint(t);
    dustNearPos[i * 3] = pt.x + (Math.random() - 0.5) * 1.5;
    dustNearPos[i * 3 + 1] = pt.y + (Math.random() - 0.5) * 1.5;
    dustNearPos[i * 3 + 2] = (Math.random() - 0.5) * 2;
    dustNearVel[i * 3] = (Math.random() - 0.5) * 0.003;
    dustNearVel[i * 3 + 1] = (Math.random() - 0.5) * 0.002;
    dustNearVel[i * 3 + 2] = (Math.random() - 0.5) * 0.001;
    dustNearSizes[i] = 0.03 + Math.random() * 0.07;
  }

  dustNearGeo.setAttribute('position', new THREE.BufferAttribute(dustNearPos, 3));
  dustNearGeo.setAttribute('size', new THREE.BufferAttribute(dustNearSizes, 1));

  const dustNearMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x45d0c1) },
      uOpacity: { value: 0.35 },
    },
    vertexShader: `
      attribute float size;
      uniform float uTime;
      varying float vAlpha;
      void main() {
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vAlpha = 0.5 + 0.5 * sin(uTime * 2.0 + position.x * 1.5 + position.y * 2.5);
        gl_PointSize = size * 550.0 / -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float alpha = smoothstep(0.5, 0.05, d) * vAlpha * uOpacity;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });

  scene.add(new THREE.Points(dustNearGeo, dustNearMat));

  let targetMX = 0;
  let targetMY = 0;
  let smoothMX = 0;
  let smoothMY = 0;

  function onMouseMove(e: MouseEvent) {
    targetMX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetMY = (e.clientY / window.innerHeight - 0.5) * 2;
  }
  window.addEventListener('mousemove', onMouseMove);

  function resize() {
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  resize();
  window.addEventListener('resize', resize);

  let frame = 0;
  let time = 0;
  const CYCLE = 9;

  function animate() {
    frame = requestAnimationFrame(animate);
    time += 0.016;

    smoothMX += (targetMX - smoothMX) * 0.02;
    smoothMY += (targetMY - smoothMY) * 0.02;

    camera.position.x = 0.5 + smoothMX * 0.6;
    camera.position.y = 0.5 + smoothMY * 0.3;
    camera.lookAt(0.5, 0, 0);

    const dark = isDark();
    const baseHex = dark ? GRAY_DARK : GRAY_LIGHT;
    const cycleT = (time % CYCLE) / CYCLE;

    NODES.forEach((node, i) => {
      const mesh = nodeMeshes[i];
      const mat = mesh.material as THREE.MeshBasicMaterial;
      const ring = nodeRings[i];
      const ringMat = ring.material as THREE.MeshBasicMaterial;
      const depth = depthMap.get(node.x) || 0;
      const nodePhase = depth / maxDepth;

      const isActive = cycleT >= nodePhase - 0.03 && cycleT <= nodePhase + 0.09;
      const isPast = cycleT > nodePhase + 0.09;

      if (isActive) {
        mat.color.copy(BRAND);
        mat.opacity = 1;
        mesh.scale.setScalar(0.28 * (1 + Math.sin(time * 8) * 0.12));

        ringMat.opacity = 0.3 + Math.sin(time * 6) * 0.15;
        ring.scale.setScalar(0.28 * 1.8 * (1 + Math.sin(time * 4) * 0.1));

        nodeGlows[i].visible = true;
        (nodeGlows[i].material as THREE.SpriteMaterial).opacity = dark ? 0.35 : 0.25;

        updateLabelColor(nodeLabels[i], true, dark);
      } else if (isPast) {
        mat.color.copy(BRAND);
        mat.opacity = 0.4;
        mesh.scale.setScalar(0.28);
        ringMat.opacity = 0;
        nodeGlows[i].visible = false;
        updateLabelColor(nodeLabels[i], false, dark);
      } else {
        mat.color.setHex(baseHex);
        mat.opacity = 0.5;
        mesh.scale.setScalar(0.28);
        ringMat.opacity = 0;
        nodeGlows[i].visible = false;
        updateLabelColor(nodeLabels[i], false, dark);
      }
    });

    const fp = flowGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < totalParticles; i++) {
      const eIdx = flowEdgeIdx[i];
      const curve = edgeCurves[eIdx];
      const t = ((time * flowSpeed[i] + flowOffset[i]) % 1);
      const pt = curve.getPoint(t);
      fp[i * 3] = pt.x;
      fp[i * 3 + 1] = pt.y + Math.sin(time * 2.5 + i * 0.7) * 0.03;
      fp[i * 3 + 2] = pt.z;
    }
    flowGeo.attributes.position.needsUpdate = true;
    flowMat.opacity = dark ? 0.9 : 0.7;

    const ap = ambientGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < AMBIENT_COUNT; i++) {
      ap[i * 3] += ambientVel[i * 3];
      ap[i * 3 + 1] += ambientVel[i * 3 + 1];
      ap[i * 3 + 2] += ambientVel[i * 3 + 2];
      if (Math.abs(ap[i * 3]) > 11) ambientVel[i * 3] *= -1;
      if (Math.abs(ap[i * 3 + 1]) > 4) ambientVel[i * 3 + 1] *= -1;
      if (Math.abs(ap[i * 3 + 2]) > 2.5) ambientVel[i * 3 + 2] *= -1;
    }
    ambientGeo.attributes.position.needsUpdate = true;
    ambientMat.opacity = dark ? 0.12 : 0.08;

    dustMat.uniforms.uTime.value = time;
    dustMat.uniforms.uOpacity.value = dark ? 0.25 : 0.18;

    const dp = dustGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < DUST_COUNT; i++) {
      dp[i * 3] += dustVel[i * 3];
      dp[i * 3 + 1] += dustVel[i * 3 + 1];
      dp[i * 3 + 2] += dustVel[i * 3 + 2];
      if (Math.abs(dp[i * 3]) > 12) dustVel[i * 3] *= -1;
      if (Math.abs(dp[i * 3 + 1]) > 5) dustVel[i * 3 + 1] *= -1;
      if (Math.abs(dp[i * 3 + 2]) > 4) dustVel[i * 3 + 2] *= -1;
    }
    dustGeo.attributes.position.needsUpdate = true;

    dustNearMat.uniforms.uTime.value = time;
    dustNearMat.uniforms.uOpacity.value = dark ? 0.4 : 0.3;

    const dnp = dustNearGeo.attributes.position.array as Float32Array;
    for (let i = 0; i < DUST_NEAR_COUNT; i++) {
      dnp[i * 3] += dustNearVel[i * 3];
      dnp[i * 3 + 1] += dustNearVel[i * 3 + 1];
      dnp[i * 3 + 2] += dustNearVel[i * 3 + 2];

      const edgeIdx = i % EDGES.length;
      const curve = edgeCurves[edgeIdx];
      const anchorT = (i / DUST_NEAR_COUNT);
      const anchor = curve.getPoint(anchorT);
      const dx = anchor.x - dnp[i * 3];
      const dy = anchor.y - dnp[i * 3 + 1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 2.0) {
        dustNearVel[i * 3] += dx * 0.0002;
        dustNearVel[i * 3 + 1] += dy * 0.0002;
      }
    }
    dustNearGeo.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
  }

  animate();

  return function cleanup() {
    cancelAnimationFrame(frame);
    window.removeEventListener('resize', resize);
    window.removeEventListener('mousemove', onMouseMove);
    renderer.dispose();
  };
}

function createGlowSprite(): THREE.Sprite {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;

  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(69, 208, 193, 0.5)');
  gradient.addColorStop(0.3, 'rgba(69, 208, 193, 0.15)');
  gradient.addColorStop(1, 'rgba(69, 208, 193, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(c);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2, 2, 1);
  return sprite;
}

function createTextSprite(text: string, dark: boolean): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const size = 256;
  canvas.width = size;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, size, 64);
  ctx.font = '600 22px "JetBrains Mono", "SF Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = dark ? '#6b7280' : '#9ca3af';
  ctx.fillText(text, size / 2, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.2, 0.55, 1);
  return sprite;
}

function updateLabelColor(sprite: THREE.Sprite, active: boolean, dark: boolean) {
  const mat = sprite.material as THREE.SpriteMaterial;
  if (!mat.map) return;

  const canvas = mat.map.image as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const currentColor = active ? '#45D0C1' : (dark ? '#6b7280' : '#9ca3af');
  const dataKey = `_lastColor_${sprite.uuid}`;
  const stored = (sprite as unknown as Record<string, string>)[dataKey];
  if (stored === currentColor) return;
  (sprite as unknown as Record<string, string>)[dataKey] = currentColor;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = '600 22px "JetBrains Mono", "SF Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = currentColor;
  ctx.fillText(sprite.name || '', canvas.width / 2, 32);
  mat.map.needsUpdate = true;
  mat.opacity = active ? 1 : 0.8;
}
