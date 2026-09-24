// The scroll-driven 3D story, lit like a product photograph: a softbox studio environment,
// AgX tone mapping, real shadows and monochrome materials. Everything is a function of story time
// `t` (0 → 12), except the hero coin rain and a few small idle motions.
//
//  0.0 – 1.5  hero + deposit: silver USDC coins fall into a glass piggy bank (the vault)
//  1.5 – 2.6  mint: the MDELTA share token rises out of the slot
//  2.6 – 3.4  dive: the camera "enters" the piggy bank; the balance scale is inside
//  3.5 – 5.2  spot ETH tips the scale, the equal short perp levels it (delta 0)
//  5.6 – 6.5  ETH price swings, both legs move equally, the beam stays level
//  6.5 – 7.4  funding payments flow from the short leg into a growing stack
//  7.4 – 8.3  zoom out of the piggy bank
//  8.3 – 12   security: the token turns with the scroll while the points appear
import * as THREE from "three";

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, k) => a + (b - a) * k;
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const easeIn = (x) => x * x * x;
const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const bounce = (x) => {
  const n = 7.5625, d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};

const BASE_PRICE = 2500;
const SPOT_ETH = (10_000 * 0.9091) / BASE_PRICE; // ETH bought for a $10k deposit
const SEC_ITEMS = [9.35, 9.75, 10.15, 10.55, 10.95, 11.35]; // must match data-in on the security list

// ---------------------------------------------------------------- camera keyframes
const KF = [
  { t: 0.0, pos: [0.3, 1.2, 12], look: [0, 0.85, 0], sx: 0.32, sy: -0.02, msy: -0.36 },
  { t: 0.5, pos: [0.3, 1.2, 12], look: [0, 0.85, 0], sx: 0.32, sy: -0.02, msy: -0.36 },
  { t: 1.0, pos: [1.2, 1.4, 10.2], look: [0, 0.8, 0], sx: 0.3, sy: 0, msy: 0.28 },
  { t: 1.7, pos: [0.8, 1.3, 9.6], look: [0, 1.05, 0], sx: 0.3, sy: 0, msy: 0.28 },
  { t: 2.45, pos: [0.4, 1.2, 9.4], look: [0, 1.0, 0], sx: 0.3, sy: 0, msy: 0.28 },
  { t: 3.4, pos: [0, 0.7, 9.8], look: [0, 0.05, 0], sx: 0.26, sy: -0.02, msy: 0.3 },
  { t: 5.5, pos: [1.0, 0.9, 10.0], look: [0, 0.05, 0], sx: 0.26, sy: -0.02, msy: 0.3 },
  { t: 6.5, pos: [1.1, 0.7, 9.8], look: [0, -0.1, 0], sx: 0.26, sy: -0.02, msy: 0.3 },
  { t: 7.35, pos: [0.4, 0.5, 9.6], look: [0, -0.15, 0], sx: 0.26, sy: -0.02, msy: 0.3 },
  { t: 8.1, pos: [1.3, 1.3, 11.0], look: [0, 0.4, 0], sx: 0.27, sy: 0, msy: 0.28 },
  { t: 8.85, pos: [0, 0.45, 9.2], look: [0, 0.05, 0], sx: -0.3, sy: 0, msy: 0.36 },
  { t: 12, pos: [0, 0.3, 8.4], look: [0, 0.05, 0], sx: -0.3, sy: 0, msy: 0.36 },
];

function sampleKF(t, mobile) {
  let i = 0;
  while (i < KF.length - 2 && t > KF[i + 1].t) i++;
  const a = KF[i], b = KF[i + 1];
  const k = easeInOut(seg(t, a.t, b.t));
  const v = (p, q) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)];
  return {
    pos: v(a.pos, b.pos),
    look: v(a.look, b.look),
    sx: mobile ? 0 : lerp(a.sx, b.sx, k),
    sy: mobile ? lerp(a.msy, b.msy, k) : lerp(a.sy, b.sy, k),
  };
}

// ---------------------------------------------------------------- studio lighting
// A dark room with strip softboxes: gives chrome and glass the long, clean reflections of a product shoot.
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x0a0a0a, side: THREE.BackSide })));
  const box = (w, h, power, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  box(12, 2.2, 7, [0, 9, 1]);      // overhead strip
  box(2.4, 10, 5, [-10, 2, 5]);    // tall left strip
  box(2.4, 10, 3, [10, 1, -2]);    // tall right strip, weaker
  box(8, 3, 1.4, [0, 0.5, 12]);    // soft front fill
  box(24, 0.35, 5, [0, 2.5, -14]); // hairline rim behind
  box(26, 26, 0.35, [0, 9.8, 0]);  // faint ceiling bounce so metals never go fully black
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.015).texture;
  pm.dispose();
  return tex;
}

// ---------------------------------------------------------------- canvas textures
function canvasTex(draw, { srgb = true, w = 512, h = w } = {}) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function spun(g, c, n, dark = 0.07, light = 0.06) {
  for (let i = 0; i < n; i++) {
    g.strokeStyle = Math.random() < 0.5 ? `rgba(255,255,255,${Math.random() * light})` : `rgba(0,0,0,${Math.random() * dark})`;
    g.lineWidth = Math.random() * 1.3;
    g.beginPath(); g.arc(0, 0, Math.random() * c * 0.99, 0, Math.PI * 2); g.stroke();
  }
}

// USDC emblem (the two arcs and the dollar), used as colour and as a stamped relief.
function usdcEmblem(g, s, color) {
  const c = s / 2;
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = s * 0.055;
  g.beginPath(); g.arc(c, c, s * 0.33, Math.PI * 0.64, Math.PI * 1.36); g.stroke();
  g.beginPath(); g.arc(c, c, s * 0.33, -Math.PI * 0.36, Math.PI * 0.36); g.stroke();
  g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `600 ${s * 0.34}px Geist, Arial, sans-serif`;
  g.fillText("$", c, c + s * 0.012);
  g.lineWidth = s * 0.012;
  g.beginPath(); g.arc(c, c, s * 0.47, 0, Math.PI * 2); g.stroke();
}
const usdcFaceTexture = () => canvasTex((g, s) => {
  const c = s / 2;
  g.save(); g.translate(c, c);
  const base = g.createRadialGradient(-c * 0.3, -c * 0.35, 10, 0, 0, c);
  base.addColorStop(0, "#f2f2f2"); base.addColorStop(0.6, "#bdbdbd"); base.addColorStop(1, "#8a8a8a");
  g.fillStyle = base; g.beginPath(); g.arc(0, 0, c, 0, Math.PI * 2); g.fill();
  spun(g, c, 700);
  g.restore();
  usdcEmblem(g, s, "rgba(40,40,40,.85)");
});
const usdcBumpTexture = () => canvasTex((g, s) => { g.fillStyle = "#000"; g.fillRect(0, 0, s, s); usdcEmblem(g, s, "#fff"); }, { srgb: false });

const steelTexture = () => canvasTex((g, s) => {
  const c = s / 2;
  g.translate(c, c);
  const base = g.createRadialGradient(-c * 0.25, -c * 0.3, 20, 0, 0, c);
  base.addColorStop(0, "#e2e2e2"); base.addColorStop(0.55, "#a9a9a9"); base.addColorStop(1, "#6e6e6e");
  g.fillStyle = base; g.beginPath(); g.arc(0, 0, c, 0, Math.PI * 2); g.fill();
  spun(g, c, 1800, 0.06, 0.05);
  g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 4;
  [0.86, 0.975].forEach((k) => { g.beginPath(); g.arc(0, 0, c * k, 0, Math.PI * 2); g.stroke(); });
  g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 6; g.setLineDash([12, 10]);
  g.beginPath(); g.arc(0, 0, c * 0.92, 0, Math.PI * 2); g.stroke();
}, { w: 1024 });

// Tangential anisotropy directions: gives the coin faces the radial light streak of spun metal.
const spunAnisotropyTexture = () => {
  const s = 256, data = new Uint8Array(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const a = Math.atan2(y - s / 2 + 0.5, x - s / 2 + 0.5), i = (y * s + x) * 4;
    data[i] = (-Math.sin(a) * 0.5 + 0.5) * 255; data[i + 1] = (Math.cos(a) * 0.5 + 0.5) * 255; data[i + 2] = 255; data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, s, s);
  tex.needsUpdate = true;
  return tex;
};

const reededTexture = (repeat) => {
  const t = canvasTex((g, w, h) => {
    for (let x = 0; x < w; x++) { const v = x % 4 < 2 ? 220 : 110; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h); }
  }, { srgb: false, w: 64, h: 4 });
  t.wrapS = THREE.RepeatWrapping; t.repeat.set(repeat, 1);
  return t;
};

const radialTexture = (stops) => canvasTex((g, s) => {
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  stops.forEach(([o, c]) => grd.addColorStop(o, c));
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
}, { w: 256 });

// Data labels in the scene: filled mark = long, hollow = short, ring = net.
function labelSprite(title, sub, mark) {
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "rgba(0,0,0,.72)"; g.strokeStyle = "rgba(255,255,255,.28)"; g.lineWidth = 2;
    g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, 30); g.fill(); g.stroke();
    g.fillStyle = "#fff"; g.strokeStyle = "#fff"; g.lineWidth = 3;
    g.beginPath(); g.arc(44, h / 2 - 20, 9, 0, Math.PI * 2);
    if (mark === "fill") g.fill(); else g.stroke();
    if (mark === "ring") { g.beginPath(); g.arc(44, h / 2 - 20, 3, 0, Math.PI * 2); g.fill(); }
    g.font = "500 38px Geist, sans-serif"; g.textBaseline = "middle";
    g.fillText(title, 68, h / 2 - 20);
    g.fillStyle = "#a8a8a8"; g.font = "400 30px 'Geist Mono', monospace";
    g.fillText(sub, 34, h / 2 + 28);
  }, { w: 540, h: 140 });
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, opacity: 0 });
  const s = new THREE.Sprite(mat);
  s.scale.set(1.45, 0.376, 1);
  s.renderOrder = 20;
  return s;
}

// Outline of an equilateral delta whose corners sit on a circle of radius r; `w` is the stroke width.
function deltaOutline(r, w) {
  const tri = (R) => [0, 1, 2].map((i) => {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 3;
    return new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R);
  });
  const s = new THREE.Shape(tri(r));
  s.holes.push(new THREE.Path(tri(r - 2 * w).reverse()));
  return s;
}

// ---------------------------------------------------------------- scene
export async function createScene(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 1.35;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  scene.add(camera);

  // Backdrop glued to the camera: a graphite sweep with a faint dot lattice, so glass has something to refract.
  const backdropMat = new THREE.ShaderMaterial({
    depthWrite: false, toneMapped: false,
    uniforms: {
      uC1: { value: new THREE.Color("#2b2b2b") }, uC2: { value: new THREE.Color("#000000") },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uGrid: { value: 0 }, uDpr: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform vec3 uC1; uniform vec3 uC2; uniform vec2 uCenter; uniform float uAspect; uniform float uGrid; uniform float uDpr;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 d = (vUv - uCenter) * vec2(uAspect, 1.);
        float r = length(d);
        vec3 col = mix(uC1, uC2, smoothstep(0.0, 0.68, r));
        vec2 k = (vUv - uCenter - vec2(0.12, 0.24)) * vec2(uAspect, 1.);
        col += uC1 * 0.55 * exp(-dot(k, k) * 18.);
        vec2 g = fract(gl_FragCoord.xy / (24. * uDpr)) - .5;
        float dotm = smoothstep(.1, .04, length(g));
        col += vec3(.05) * dotm * uGrid * (1. - smoothstep(.05, .75, r));
        col += (hash(gl_FragCoord.xy) - .5) / 180.;
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMat);
  backdrop.position.z = -80;
  backdrop.renderOrder = -10;
  camera.add(backdrop);

  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(3, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xffffff, 1.2); rim.position.set(-5, 3, -5); scene.add(rim);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(4.6, 96), new THREE.ShadowMaterial({ opacity: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.61; floor.receiveShadow = true;
  scene.add(floor);

  // ------------------------------------------------ materials
  const pigGlass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.55, ior: 1.5,
    attenuationColor: new THREE.Color("#e8e8e8"), attenuationDistance: 8,
    clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.35, transparent: true,
  });
  const lacquer = new THREE.MeshPhysicalMaterial({ color: 0x0b0b0b, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true });
  const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x080808, roughness: 0.12, clearcoat: 1, transparent: true });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f4, metalness: 1, roughness: 0.07 });
  const satin = new THREE.MeshPhysicalMaterial({ color: 0xbdbdbd, metalness: 1, roughness: 0.34, clearcoat: 0.4 });
  const spunDir = spunAnisotropyTexture();
  const usdcFace = new THREE.MeshPhysicalMaterial({
    map: usdcFaceTexture(), bumpMap: usdcBumpTexture(), bumpScale: 1.4, metalness: 1, roughness: 0.3,
    anisotropy: 0.7, anisotropyMap: spunDir,
  });
  const usdcSide = new THREE.MeshStandardMaterial({ color: 0xdadada, metalness: 1, roughness: 0.3, bumpMap: reededTexture(14), bumpScale: 2 });
  const usdcMats = [usdcSide, usdcFace, usdcFace];
  const pigMats = [pigGlass, lacquer, darkMat];

  const addTo = (parent, geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p); m.rotation.set(...r); m.scale.set(...s);
    m.castShadow = shadow;
    parent.add(m); return m;
  };

  // ------------------------------------------------ piggy bank (the vault)
  const pigRoot = new THREE.Group();
  pigRoot.position.y = -0.15;
  scene.add(pigRoot);
  const pig = new THREE.Group();
  pig.rotation.y = -2.6;
  pigRoot.add(pig);

  addTo(pig, new THREE.SphereGeometry(1, 96, 64), pigGlass, [0, 0, 0], [0, 0, 0], [1.3, 1.05, 1.08]);
  const snoutGeo = new THREE.LatheGeometry([[0, 0.29], [0.2, 0.285], [0.31, 0.26], [0.36, 0.2], [0.375, 0.08], [0.37, -0.12]].map(([x, y]) => new THREE.Vector2(x, y)), 64).rotateZ(-Math.PI / 2);
  addTo(pig, snoutGeo, pigGlass, [1.27, 0.02, 0]);
  addTo(pig, new THREE.SphereGeometry(0.055, 16, 12), darkMat, [1.56, 0.03, 0.11], [0, 0, 0], [0.6, 1.3, 1]);
  addTo(pig, new THREE.SphereGeometry(0.055, 16, 12), darkMat, [1.56, 0.03, -0.11], [0, 0, 0], [0.6, 1.3, 1]);
  addTo(pig, new THREE.SphereGeometry(0.065, 20, 16), darkMat, [0.98, 0.42, 0.42]);
  addTo(pig, new THREE.SphereGeometry(0.065, 20, 16), darkMat, [0.98, 0.42, -0.42]);
  const earGeo = new THREE.SphereGeometry(0.24, 32, 24).scale(1, 1.25, 0.38).translate(0, 0.16, 0);
  addTo(pig, earGeo, pigGlass, [0.62, 0.86, 0.44], [0.45, 0.5, -0.5]);
  addTo(pig, earGeo, pigGlass, [0.62, 0.86, -0.44], [-0.45, -0.5, -0.5]);
  for (const [x, z] of [[0.62, 0.42], [0.62, -0.42], [-0.62, 0.42], [-0.62, -0.42]])
    addTo(pig, new THREE.CapsuleGeometry(0.18, 0.28, 8, 24), pigGlass, [x, -0.9, z]);
  addTo(pig, new THREE.TorusGeometry(0.1, 0.035, 12, 32, 5), pigGlass, [-1.33, 0.22, 0], [0, Math.PI / 2, 0]);
  addTo(pig, new THREE.BoxGeometry(0.62, 0.05, 0.1), darkMat, [0, 1.035, 0]);
  addTo(pig, new THREE.BoxGeometry(0.72, 0.03, 0.18), chrome, [0, 1.02, 0]);

  // black lacquer plinth with a soft contact shadow where the glass feet stand
  const plinth = addTo(pigRoot, new THREE.CylinderGeometry(1.95, 1.95, 0.26, 128), lacquer, [0, -1.29, 0], [0, 0, 0], [1, 1, 1], true);
  plinth.receiveShadow = true;
  const contactMat = new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(0,0,0,.7)"], [0.5, "rgba(0,0,0,.3)"], [1, "rgba(0,0,0,0)"]]), transparent: true, depthWrite: false });
  addTo(pigRoot, new THREE.PlaneGeometry(3.4, 2.6), contactMat, [0, -1.155, 0], [-Math.PI / 2, 0, 0.5]);
  pigMats.push(contactMat);

  // USDC pile inside the bank (opaque: transparent objects are skipped by the transmission pass)
  const coinGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.055, 64).rotateX(Math.PI / 2);
  const PILE = 30;
  const pile = [];
  for (let i = 0; i < PILE; i++) {
    const layer = Math.floor(i / 10);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
    const m = addTo(pig, coinGeo, usdcMats,
      [Math.cos(a) * r * 0.62, -0.86 + layer * 0.06 + Math.random() * 0.03, Math.sin(a) * r * 0.42],
      [Math.PI / 2 + (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5]);
    m.visible = false;
    pile.push(m);
  }

  // Falling USDC (hero loop), in pig-local space so they line up with the slot
  const FALL = 7, PERIOD = 2.8;
  const falling = Array.from({ length: FALL }, (_, i) => {
    const m = addTo(pig, coinGeo, usdcMats);
    m.userData = { x0: (Math.random() - 0.5) * 0.9, z0: (Math.random() - 0.5) * 0.5, phase: i / FALL, spin: 1.6 + Math.random() * 1.6 };
    return m;
  });

  // ------------------------------------------------ MDELTA share token
  const tokenRoot = new THREE.Group();
  scene.add(tokenRoot);
  const token = new THREE.Group();
  tokenRoot.add(token);
  const steel = new THREE.MeshPhysicalMaterial({
    map: steelTexture(), metalness: 1, roughness: 0.3, anisotropy: 0.85, anisotropyMap: spunDir,
    clearcoat: 0.35, clearcoatRoughness: 0.18,
  });
  const edge = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 1, roughness: 0.26, bumpMap: reededTexture(70), bumpScale: 3 });
  addTo(token, new THREE.CylinderGeometry(1, 1, 0.16, 160).rotateX(Math.PI / 2), [edge, steel, steel], [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
  addTo(token, new THREE.TorusGeometry(1.0, 0.05, 32, 200), chrome, [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
  // the mark on both faces: a filigree delta whose corners touch an open circle (delta zero)
  const R = 0.66;
  const ext = { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 3, curveSegments: 1 };
  const deltaGeo = new THREE.ExtrudeGeometry(deltaOutline(R, 0.034), ext);
  const hairGeo = new THREE.ExtrudeGeometry(deltaOutline(R * 0.75, 0.011), ext);
  const ringGeo = new THREE.TorusGeometry(R, 0.016, 16, 220);
  const dotGeo = new THREE.SphereGeometry(0.03, 20, 14);
  for (const side of [1, -1]) {
    const face = new THREE.Group();
    face.position.z = side * 0.08;
    if (side < 0) face.rotation.y = Math.PI;
    token.add(face);
    addTo(face, ringGeo, chrome);
    addTo(face, deltaGeo, chrome);
    addTo(face, hairGeo, chrome);
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / 3;
      addTo(face, dotGeo, chrome, [Math.cos(a) * R, Math.sin(a) * R, 0.01]);
    }
  }

  // "tokenized" halo: hairline orbits and fine particles, kept quiet so the metal reads first
  const fx = new THREE.Group();
  tokenRoot.add(fx);
  const fxMats = [];
  const hairline = (opacity) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    fxMats.push([m, opacity]); return m;
  };
  const ring1 = addTo(fx, new THREE.TorusGeometry(1.42, 0.003, 6, 256), hairline(0.35), [0, 0, 0], [1.25, 0.2, 0]);
  const ring2 = addTo(fx, new THREE.TorusGeometry(1.66, 0.002, 6, 256), hairline(0.2), [0, 0, 0], [1.9, -0.4, 0]);
  const pGeo = new THREE.BufferGeometry();
  const PN = 320, pPos = new Float32Array(PN * 3);
  for (let i = 0; i < PN; i++) {
    const a = Math.random() * Math.PI * 2, r = 1.3 + Math.random() * 0.6, y = (Math.random() - 0.5) * 0.3;
    pPos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.016, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  fxMats.push([pMat, 0.55]);
  const particles = new THREE.Points(pGeo, pMat);
  particles.rotation.x = 0.35;
  fx.add(particles);
  const glowMat = new THREE.SpriteMaterial({ map: radialTexture([[0, "rgba(255,255,255,1)"], [0.35, "rgba(255,255,255,.25)"], [1, "rgba(255,255,255,0)"]]), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  fxMats.push([glowMat, 0.1]);
  const glow = new THREE.Sprite(glowMat); glow.scale.set(5, 5, 1); glow.position.z = -0.8; glow.renderOrder = -1;
  fx.add(glow);

  // security: a faint lattice and six chrome nodes, one per point in the copy
  const shell = new THREE.Group();
  tokenRoot.add(shell);
  const shellGeo = new THREE.IcosahedronGeometry(1.95, 1);
  const shellLines = new THREE.LineSegments(new THREE.EdgesGeometry(shellGeo),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  shell.add(shellLines);
  const shellPts = new THREE.Points(new THREE.BufferGeometry().setAttribute("position", shellGeo.getAttribute("position")),
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  shell.add(shellPts);
  const nodes = new THREE.Group();
  nodes.rotation.x = 0.42;
  tokenRoot.add(nodes);
  const nodeList = Array.from({ length: 6 }, (_, i) => {
    const m = addTo(nodes, new THREE.OctahedronGeometry(0.075, 0), chrome, [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    const a = (i / 6) * Math.PI * 2;
    m.position.set(Math.cos(a) * 2.3, 0, Math.sin(a) * 2.3);
    return m;
  });
  const orbitMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  addTo(nodes, new THREE.TorusGeometry(2.3, 0.0025, 6, 256), orbitMat, [0, 0, 0], [Math.PI / 2, 0, 0]);

  // ------------------------------------------------ balance scale (the strategy)
  const scaleRoot = new THREE.Group();
  scene.add(scaleRoot);
  const S = (geo, mat, p, r) => addTo(scaleRoot, geo, mat, p, r, [1, 1, 1], true);
  S(new THREE.CylinderGeometry(0.75, 0.86, 0.12, 96), lacquer, [0, -1.55, 0]).receiveShadow = true;
  S(new THREE.CylinderGeometry(0.42, 0.6, 0.1, 96), satin, [0, -1.44, 0]).receiveShadow = true;
  S(new THREE.CylinderGeometry(0.04, 0.065, 2.4, 48), chrome, [0, -0.3, 0]);
  S(new THREE.SphereGeometry(0.1, 48, 32), chrome, [0, 0.93, 0]);
  const beam = new THREE.Group();
  beam.position.y = 0.9;
  scaleRoot.add(beam);
  addTo(beam, new THREE.CylinderGeometry(0.03, 0.03, 3.0, 32).rotateZ(Math.PI / 2), chrome, [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
  addTo(beam, new THREE.SphereGeometry(0.055, 24, 16), chrome, [-1.5, 0, 0]);
  addTo(beam, new THREE.SphereGeometry(0.055, 24, 16), chrome, [1.5, 0, 0]);
  addTo(beam, new THREE.ConeGeometry(0.045, 0.36, 24), chrome, [0, 0.26, 0]);

  const panGeo = new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.45, 0.015), new THREE.Vector2(0.6, 0.08), new THREE.Vector2(0.64, 0.13), new THREE.Vector2(0.62, 0.135)], 96);
  const panMat = new THREE.MeshPhysicalMaterial({ color: 0xe8e8e8, metalness: 1, roughness: 0.16, side: THREE.DoubleSide });
  const panL = S(panGeo, panMat); panL.receiveShadow = true;
  const panR = S(panGeo, panMat); panR.receiveShadow = true;
  const strGeo = new THREE.BufferGeometry();
  strGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12 * 3), 3));
  scaleRoot.add(new THREE.LineSegments(strGeo, new THREE.LineBasicMaterial({ color: 0xbdbdbd, transparent: true, opacity: 0.7 })));

  const ethTop = new THREE.ConeGeometry(0.3, 0.5, 4, 1).translate(0, 0.25, 0);
  const ethBot = new THREE.ConeGeometry(0.3, 0.32, 4, 1).rotateX(Math.PI).translate(0, -0.16, 0);
  const makeEth = (mat, edges) => {
    const g = new THREE.Group();
    for (const geo of [ethTop, ethBot]) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m);
      if (edges) g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })));
    }
    return g;
  };
  // long = polished silver, short = black obsidian: the same object, inverted
  const spotEth = makeEth(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05, flatShading: true }));
  const perpEth = makeEth(new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, metalness: 0, roughness: 0.05, clearcoat: 1, flatShading: true }), true);
  scaleRoot.add(spotEth, perpEth);

  const labelSpot = labelSprite("Spot ETH", "long   Δ +1", "fill");
  const labelPerp = labelSprite("ETH-PERP", "short  Δ −1", "hollow");
  const labelNet = labelSprite("Net delta", "Δ = 0.00", "ring");
  const labelFund = labelSprite("Funding", "paid to shorts", "fill");
  scaleRoot.add(labelSpot, labelPerp, labelNet, labelFund);

  const FUND = 16;
  const fundGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.028, 48).rotateX(Math.PI / 2);
  const fundCoins = Array.from({ length: FUND }, () => { const m = addTo(scaleRoot, fundGeo, usdcMats, [0, 0, 0], [0, 0, 0], [1, 1, 1], true); m.visible = false; return m; });

  // ------------------------------------------------ state
  let tTarget = 0, tNow = 0, visible = true, mobile = false, aspect = 1;
  let theta = 0, thetaV = 0;
  let onTick = null;
  const clock = new THREE.Clock();
  const tmpLook = new THREE.Vector3();
  const cHero = new THREE.Color("#2e2e2e"), cInside = new THREE.Color("#1a1a1a"), cSec = new THREE.Color("#262626");

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    mobile = w < 820;
    aspect = w / h;
    const dpr = Math.min(devicePixelRatio, mobile ? 1.5 : 1.75);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    const hh = 2 * 80 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.6;
    backdrop.scale.set(hh * aspect, hh, 1);
    backdropMat.uniforms.uAspect.value = aspect;
    backdropMat.uniforms.uDpr.value = dpr;
  }
  resize();
  addEventListener("resize", resize);

  function setPigOpacity(o) {
    for (const m of pigMats) m.opacity = o;
    pigRoot.visible = o > 0.01;
  }

  function update(dt, time) {
    const t = tNow;
    const idle = reducedMotion ? 0 : 1;

    // camera + framing (subject offset so copy can sit beside it)
    const k = sampleKF(t, mobile);
    const distScale = aspect < 1.2 ? Math.pow(Math.min(2.2, 1.2 / aspect), 0.8) : 1;
    tmpLook.set(...k.look);
    camera.position.set(
      k.look[0] + (k.pos[0] - k.look[0]) * distScale + Math.sin(time * 0.21) * 0.06 * idle,
      k.look[1] + (k.pos[1] - k.look[1]) * distScale + Math.sin(time * 0.29) * 0.04 * idle,
      k.look[2] + (k.pos[2] - k.look[2]) * distScale,
    );
    camera.lookAt(tmpLook);
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[8] = -k.sx;
    camera.projectionMatrix.elements[9] = -k.sy;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    backdropMat.uniforms.uCenter.value.set(0.5 + k.sx * 0.5, 0.5 + k.sy * 0.5 + 0.05);

    const inside = smooth(seg(t, 2.8, 3.4)) * (1 - smooth(seg(t, 7.5, 8.1)));
    const sec = smooth(seg(t, 8.4, 9.0));
    backdropMat.uniforms.uC1.value.copy(cHero).lerp(cInside, inside).lerp(cSec, sec);
    backdropMat.uniforms.uGrid.value = 0.35 + inside * 0.65 + sec * 0.65;

    // piggy bank: dive in (2.6→3.4), come back (7.4→8.2), step aside for security (8.3→8.8)
    const diveIn = easeIn(seg(t, 2.6, 3.4));
    const diveOut = easeOut(seg(t, 7.45, 8.2));
    const pigScale = t < 5 ? lerp(1, 7, diveIn) : lerp(7, 1, diveOut);
    const pigFade = t < 5 ? 1 - smooth(seg(t, 2.95, 3.35)) : smooth(seg(t, 7.45, 7.9));
    const pigAway = smooth(seg(t, 8.25, 8.75));
    pigRoot.scale.setScalar(pigScale * (1 - pigAway * 0.15));
    pigRoot.position.y = -0.15 - pigAway * 0.9;
    setPigOpacity(pigFade * (1 - pigAway));
    plinth.castShadow = pigScale < 1.5;
    pig.rotation.y = -2.6 + Math.sin(time * 0.3) * 0.05 * idle + seg(t, 0.5, 2.5) * 0.25;

    // hero coin rain
    const rain = 1 - seg(t, 1.25, 1.6);
    const deposited = Math.floor((time * FALL) / PERIOD);
    const pileN = Math.min(PILE, 6 + deposited + Math.floor(seg(t, 0.6, 1.4) * 12));
    const pileOn = pigFade * (1 - pigAway) > 0.9;
    pile.forEach((m, i) => (m.visible = pileOn && i < pileN));
    for (const m of falling) {
      const u = reducedMotion ? m.userData.phase : (time / PERIOD + m.userData.phase) % 1;
      const top = mobile ? 2.9 : 5.4;
      const y = lerp(top, 0.7, u * u);
      const appear = clamp01((top - y) / 0.35);
      const near = seg(y, 1.4, 3.2);
      m.position.set(m.userData.x0 * near, y, m.userData.z0 * near);
      m.rotation.set(Math.sin(time * 2 + m.userData.phase * 9) * 0.45 * near, Math.cos(time * 1.7 + m.userData.phase * 5) * 0.35 * near, time * m.userData.spin);
      m.visible = rain > 0.01 && y > 0.98;
      m.scale.setScalar(Math.max(0.0001, rain * appear));
    }

    // MDELTA token: minted out of the slot, leaves for the dive, returns and turns with the scroll for security
    const rise = easeOut(seg(t, 1.45, 2.25));
    const leave = easeIn(seg(t, 2.45, 2.95));
    const back = easeOut(seg(t, 8.3, 9.0));
    let ts = 0;
    if (t < 5) {
      ts = rise * (1 - leave) * (mobile ? 0.55 : 0.66);
      tokenRoot.position.set(0, lerp(0.8, 2.35, rise) + leave * 2.4, lerp(0, 0.5, rise));
      token.rotation.set(0.12, t * 1.4 + time * 0.3 * idle, 0);
    } else {
      ts = back * (mobile ? 0.8 : 1.2);
      tokenRoot.position.set(0, lerp(-1.4, 0.05, back) + Math.sin(time * 0.8) * 0.025 * idle, 0);
      // one and a half turns across the chapter, driven only by scroll
      token.rotation.set(0.16 + Math.sin(time * 0.6) * 0.02 * idle, -0.5 + seg(t, 8.3, 12) * Math.PI * 3, 0);
    }
    tokenRoot.visible = ts > 0.002;
    tokenRoot.scale.setScalar(Math.max(ts, 0.0001));

    const fxA = smooth(seg(t, 1.8, 2.2)) * (1 - seg(t, 2.45, 2.8)) + (t > 5 ? smooth(seg(t, 8.7, 9.2)) * 0.8 : 0);
    for (const [m, o] of fxMats) m.opacity = o * fxA;
    fx.visible = fxA > 0.01;
    ring1.rotation.z = time * 0.2 * idle + t * 0.3; ring2.rotation.z = -time * 0.12 * idle - t * 0.2; particles.rotation.y = time * 0.06 * idle + t * 0.15;

    const sh = t > 5 ? easeOut(seg(t, 8.85, 9.5)) : 0;
    shell.visible = sh > 0.01;
    shell.scale.setScalar(Math.max(0.0001, lerp(0.7, 1, sh)));
    shellLines.material.opacity = 0.1 * sh; shellPts.material.opacity = 0.5 * sh;
    shell.rotation.y = t * 0.35 + time * 0.02 * idle;
    nodes.visible = sh > 0.01;
    orbitMat.opacity = 0.22 * sh;
    nodes.rotation.y = -t * 0.5;
    nodeList.forEach((n, i) => {
      const on = easeOut(seg(t, SEC_ITEMS[i] - 0.3, SEC_ITEMS[i]));
      n.scale.setScalar(Math.max(0.0001, on));
      n.rotation.y = t * 2 + i;
    });

    // balance scale
    const grow = easeOut(seg(t, 2.75, 3.45));
    const shrink = easeIn(seg(t, 7.45, 8.05));
    const sc = t < 5 ? lerp(0.13, 1, grow) : lerp(1, 0.13, shrink);
    scaleRoot.visible = t > 2.75 && t < 8.05;
    scaleRoot.scale.setScalar(sc * (mobile ? 0.82 : 1));

    const spotLand = bounce(seg(t, 3.6, 4.15));
    const perpLand = bounce(seg(t, 4.6, 5.15));
    const target = 0.2 * smooth(seg(t, 3.95, 4.1)) - 0.2 * smooth(seg(t, 4.95, 5.1));
    if (reducedMotion) { theta = target; thetaV = 0; }
    else {
      const h = Math.min(dt, 0.05);
      thetaV += (55 * (target - theta) - 6 * thetaV) * h; theta += thetaV * h;
    }
    beam.rotation.z = theta;
    const endL = [-1.5 * Math.cos(theta), 0.9 - 1.5 * Math.sin(theta)];
    const endR = [1.5 * Math.cos(theta), 0.9 + 1.5 * Math.sin(theta)];
    panL.position.set(endL[0], endL[1] - 1.2, 0);
    panR.position.set(endR[0], endR[1] - 1.2, 0);
    const sp = strGeo.attributes.position.array;
    let o = 0;
    for (const [end, pan] of [[endL, panL], [endR, panR]])
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * Math.PI * 2 + Math.PI / 2;
        sp.set([end[0], end[1], 0, pan.position.x + Math.cos(a) * 0.62, pan.position.y + 0.13, Math.sin(a) * 0.62], o); o += 6;
      }
    strGeo.attributes.position.needsUpdate = true;

    // ETH price swing (5.6 → 6.45): both legs grow and shrink together
    const swing = seg(t, 5.6, 6.45);
    const price = BASE_PRICE * (1 + 0.3 * Math.sin(swing * Math.PI * 2));
    const k2 = 1 + (price / BASE_PRICE - 1) * 0.9;
    const hover = Math.sin(time * 1.6) * 0.02 * idle;
    spotEth.visible = spotLand > 0;
    spotEth.position.set(panL.position.x, panL.position.y + 0.36 * k2 + lerp(3.2, 0, spotLand) + hover, 0);
    spotEth.scale.setScalar(k2);
    spotEth.rotation.y = time * 0.4 * idle + t;
    perpEth.visible = perpLand > 0;
    perpEth.position.set(panR.position.x, panR.position.y + 0.36 * k2 + lerp(3.2, 0, perpLand) + hover, 0);
    perpEth.scale.set(k2, -k2, k2);
    perpEth.rotation.y = -time * 0.4 * idle - t;

    const lblOut = 1 - seg(t, 7.3, 7.5);
    labelSpot.material.opacity = smooth(seg(t, 3.95, 4.2)) * lblOut;
    labelPerp.material.opacity = smooth(seg(t, 4.95, 5.2)) * lblOut;
    labelNet.material.opacity = smooth(seg(t, 5.15, 5.4)) * lblOut;
    labelFund.material.opacity = smooth(seg(t, 6.55, 6.8)) * lblOut;
    labelSpot.position.set(panL.position.x, panL.position.y + 1.35, 0.2);
    labelPerp.position.set(panR.position.x, panR.position.y + 1.35, 0.2);
    labelNet.position.set(0, 1.95, 0.2);
    labelFund.position.set(1.15, -1.0, 1.0);

    // funding: coins arc from the short leg into a stack in front of the scale
    const fu = seg(t, 6.55, 7.35) * (FUND + 1.5);
    const start = new THREE.Vector3(panR.position.x, panR.position.y + 0.3, 0);
    fundCoins.forEach((m, i) => {
      const f = clamp01((fu - i) / 1.5);
      m.visible = f > 0;
      if (!m.visible) return;
      const e = easeInOut(f);
      m.position.set(lerp(start.x, 0, e), lerp(start.y, -1.47 + i * 0.03, e) + Math.sin(Math.PI * e) * 0.9, lerp(start.z, 1.0, e));
      m.rotation.set(lerp(0, Math.PI / 2, e), 0, (1 - e) * 8);
    });

    if (onTick) onTick({ t, price, spotPnl: SPOT_ETH * (price - BASE_PRICE) });
  }

  let raf = 0, last = performance.now();
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!visible) return;
    // damped follow: scroll input feels weighted, like a camera on a dolly
    tNow = reducedMotion ? tTarget : tNow + (tTarget - tNow) * (1 - Math.exp(-dt * 4));
    if (Math.abs(tTarget - tNow) < 0.0005) tNow = tTarget;
    update(dt, clock.getElapsedTime());
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    setProgress(t) { tTarget = t; },
    jump(t) { tTarget = tNow = t; },
    setVisible(v) { visible = v; },
    onTick(cb) { onTick = cb; },
    get t() { return tNow; },
    destroy() { cancelAnimationFrame(raf); removeEventListener("resize", resize); renderer.dispose(); },
  };
}
