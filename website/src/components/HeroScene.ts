import * as THREE from 'three';

const BRAND = new THREE.Color(0x45d0c1);
const GRID_SIZE = 100;
const GRID_SPACING = 0.16;
const WAVE_SPEED = 0.25;
const WAVE_HEIGHT = 0.15;

export function createHeroScene(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  camera.position.set(0, 8, 18);
  camera.lookAt(0, -1, 0);

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
      uOpacity: { value: 0.08 },
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
      '  float wave1 = sin(dist * 0.6 - uTime * 0.5) * uWaveHeight;',
      '  float wave2 = sin(pos.x * 0.4 + uTime * 0.3) * cos(pos.z * 0.3 - uTime * 0.15) * uWaveHeight * 0.5;',
      '  float wave3 = cos(dist * 0.25 + uTime * 0.1) * uWaveHeight * 0.3;',
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
      '  float heightGlow = smoothstep(-0.2, 0.4, vHeight);',
      '  float edgeFade = 1.0 - smoothstep(4.0, 8.0, vDist);',
      '  float alpha = uOpacity * edgeFade * (0.4 + heightGlow * 0.6);',
      '  gl_FragColor = vec4(uColor, alpha);',
      '}',
    ].join('\n'),
  });

  const planeMesh = new THREE.Mesh(planeGeo, planeMat);
  planeMesh.position.y = -3.5;
  scene.add(planeMesh);

  const glowSprite = createGlow();
  glowSprite.position.set(0, -2, 0);
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

    camera.position.x = smoothMX * 0.8;
    camera.position.y = 8 + smoothMY * 0.3;
    camera.lookAt(0, -1, 0);

    const isDark = document.documentElement.classList.contains('dark');
    planeMat.uniforms.uOpacity.value = isDark ? 0.1 : 0.07;
    (glowSprite.material as THREE.SpriteMaterial).opacity = isDark ? 0.06 : 0.03;

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
  gradient.addColorStop(0, 'rgba(69, 208, 193, 0.3)');
  gradient.addColorStop(0.3, 'rgba(69, 208, 193, 0.08)');
  gradient.addColorStop(0.6, 'rgba(69, 208, 193, 0.02)');
  gradient.addColorStop(1, 'rgba(69, 208, 193, 0)');

  drawCtx.fillStyle = gradient;
  drawCtx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(c);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.03,
    blending: THREE.AdditiveBlending,
  });

  const sprite = new THREE.Sprite(material);
  sprite.scale.set(20, 20, 1);
  return sprite;
}
