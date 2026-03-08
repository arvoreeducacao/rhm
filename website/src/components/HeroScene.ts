import * as THREE from 'three';

const BRAND = new THREE.Color(0x45d0c1);
const GRID_SIZE = 80;
const GRID_SPACING = 0.18;
const WAVE_SPEED = 0.4;
const WAVE_HEIGHT = 0.35;
const FLOAT_PARTICLES = 40;

export function createHeroScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 6, 14);
  camera.lookAt(0, 0, 0);

  const planeGeo = new THREE.PlaneGeometry(
    GRID_SIZE * GRID_SPACING,
    GRID_SIZE * GRID_SPACING,
    GRID_SIZE,
    GRID_SIZE
  );
  planeGeo.rotateX(-Math.PI / 2);

  const planeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    wireframe: true,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: BRAND },
      uOpacity: { value: 0.12 },
      uWaveHeight: { value: WAVE_HEIGHT },
    },
    vertexShader: [
      'uniform float uTime;',
      'uniform float uWaveHeight;',
      'varying float vHeight;',
      'varying float vDist;',
      'void main() {',
      '  vec3 pos = position;',
      '  float dist = length(pos.xz);',
      '  float wave1 = sin(dist * 1.2 - uTime * 0.8) * uWaveHeight;',
      '  float wave2 = sin(pos.x * 0.8 + uTime * 0.5) * cos(pos.z * 0.6 - uTime * 0.3) * uWaveHeight * 0.5;',
      '  float wave3 = cos(dist * 0.5 + uTime * 0.2) * uWaveHeight * 0.3;',
      '  pos.y += wave1 + wave2 + wave3;',
      '  vHeight = pos.y;',
      '  vDist = dist;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uColor;',
      'uniform float uOpacity;',
      'varying float vHeight;',
      'varying float vDist;',
      'void main() {',
      '  float heightGlow = smoothstep(-0.2, 0.6, vHeight);',
      '  float edgeFade = 1.0 - smoothstep(4.0, 7.5, vDist);',
      '  float alpha = uOpacity * edgeFade * (0.3 + heightGlow * 0.7);',
      '  gl_FragColor = vec4(uColor, alpha);',
      '}',
    ].join('\n'),
  });

  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
  planeMesh.position.y = -2;
  scene.add(planeMesh);

  const floatGroup = new THREE.Group();
  scene.add(floatGroup);

  const floatingParticles: Array<{
    mesh: THREE.Mesh;
    baseY: number;
    phase: number;
    speed: number;
    floatAmp: number;
  }> = [];
  const particleGeo = new THREE.SphereGeometry(0.03, 8, 8);

  for (let i = 0; i < FLOAT_PARTICLES; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: BRAND,
      transparent: true,
      opacity: 0.15 + Math.random() * 0.35,
    });

    const mesh = new THREE.Mesh(particleGeo, mat);
    const spread = 6;
    mesh.position.set(
      (Math.random() - 0.5) * spread * 2,
      Math.random() * 4 - 1,
      (Math.random() - 0.5) * spread
    );

    const scale = 0.5 + Math.random() * 1.5;
    mesh.scale.setScalar(scale);

    floatGroup.add(mesh);
    floatingParticles.push({
      mesh,
      baseY: mesh.position.y,
      phase: Math.random() * Math.PI * 2,
      speed: 0.3 + Math.random() * 0.5,
      floatAmp: 0.3 + Math.random() * 0.5,
    });
  }

  const glowSprite = createGlow();
  glowSprite.position.set(0, -0.5, 0);
  scene.add(glowSprite);

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

  function animate() {
    frame = requestAnimationFrame(animate);
    time += 0.016;

    smoothMX += (targetMX - smoothMX) * 0.02;
    smoothMY += (targetMY - smoothMY) * 0.02;

    planeMat.uniforms.uTime.value = time * WAVE_SPEED;

    camera.position.x = smoothMX * 1.5;
    camera.position.y = 6 + smoothMY * 0.5;
    camera.lookAt(0, 0, 0);

    for (const p of floatingParticles) {
      p.mesh.position.y = p.baseY + Math.sin(time * p.speed + p.phase) * p.floatAmp;
    }

    const isDark = document.documentElement.classList.contains('dark');
    planeMat.uniforms.uOpacity.value = isDark ? 0.15 : 0.1;
    (glowSprite.material as THREE.SpriteMaterial).opacity = isDark ? 0.07 : 0.04;

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

function createGlow(): THREE.Sprite {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const drawCtx = c.getContext('2d')!;

  const gradient = drawCtx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2
  );
  gradient.addColorStop(0, 'rgba(69, 208, 193, 0.4)');
  gradient.addColorStop(0.3, 'rgba(69, 208, 193, 0.1)');
  gradient.addColorStop(0.6, 'rgba(69, 208, 193, 0.02)');
  gradient.addColorStop(1, 'rgba(69, 208, 193, 0)');

  drawCtx.fillStyle = gradient;
  drawCtx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(c);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.04,
    blending: THREE.AdditiveBlending,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(20, 20, 1);
  return sprite;
}
