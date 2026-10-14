// The scroll-driven 3D story, lit like a bright product studio: a white podium on a pale sweep, softbox
// lighting, glass and brushed metal. Everything is a function of story time `t` (0 → 12), except a few
// small idle motions.
//
//  0.0 – 1.2  a delta coin drops from above into the glass piggy bank on the podium
//  1.2 – 2.6  the piggy bank turns slowly while the method is explained
//  2.6 – 3.6  the piggy bank lifts off; the balance scale rises on the podium (strategy 01)
//  3.6 – 5.2  spot ETH tips the scale, the equal short perp levels it (delta 0)
//  5.6 – 6.5  ETH price swings, both legs move equally, the beam stays level
//  6.5 – 7.4  funding payments flow from the short leg into a stack on the podium
//  7.5 – 8.3  the podium sinks out of frame; the chart and the services (HTML) take over
//
// The camera never dives into an object: the scene stays one wide shot so it runs on mid-range phones.
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
const SPOT_ETH = (10_000 * 0.7125) / BASE_PRICE; // ETH bought for $10k at 3x with a 5% buffer: (1 - 5%) / (1 + 1/3)
const TOP = -1.31; // podium top surface (world y)
const SCALE_FOOT = -1.61; // lowest point of the balance scale in its own space

// ---------------------------------------------------------------- camera keyframes
// sx / sy shift the subject in the frame (sx > 0 puts it on the right, so copy can sit on the left);
// msy is the vertical shift on phones, where copy sits below (or, in the hero, above) the subject.
const KF = [
  { t: 0.0, pos: [0.4, 1.6, 12.6], look: [0, 0.45, 0], sx: 0.32, sy: 0, msy: -0.34 },
  { t: 0.5, pos: [0.5, 1.6, 12.4], look: [0, 0.45, 0], sx: 0.32, sy: 0, msy: -0.3 },
  { t: 0.95, pos: [1.1, 1.3, 11.4], look: [0, 0.25, 0], sx: 0.3, sy: 0, msy: 0.28 },
  { t: 2.6, pos: [-0.6, 1.5, 11.2], look: [0, 0.25, 0], sx: 0.28, sy: 0, msy: 0.28 },
  { t: 3.6, pos: [0, 1.4, 13.2], look: [0, 0.45, 0], sx: 0.26, sy: 0, msy: 0.3 },
  { t: 5.5, pos: [1.0, 1.5, 13.0], look: [0, 0.45, 0], sx: 0.26, sy: 0, msy: 0.3 },
  { t: 7.4, pos: [0.3, 1.2, 12.6], look: [0, 0.3, 0], sx: 0.26, sy: 0, msy: 0.3 },
  { t: 8.3, pos: [0, 1.2, 12.6], look: [0, 0.3, 0], sx: 0, sy: 0, msy: 0.3 },
  { t: 12, pos: [0, 1.2, 12.6], look: [0, 0.3, 0], sx: 0, sy: 0, msy: 0.3 },
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
// A pale grey room with large softboxes, plus two dark flags left and right: on a white set, glass and
// chrome only read where they reflect something dark.
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.42, 0.38), side: THREE.BackSide })));
  const box = (w, h, power, pos) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(power, power, power), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); env.add(m);
  };
  box(14, 4, 5, [0, 9, 1]);         // overhead softbox
  box(3, 10, 3.5, [-10, 2, 6]);     // tall left strip
  box(3, 10, 2.5, [10, 1, -2]);     // tall right strip
  box(10, 4, 1.6, [0, 1, 12]);      // front fill
  box(5, 12, 0.02, [-9, 1, -7]);    // dark flag, back left
  box(5, 12, 0.02, [9, 1, 7]);      // dark flag, front right
  box(30, 1.2, 0.04, [0, -2, -14]); // dark line low behind: gives the glass a clean lower edge
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.02).texture;
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

const steelTexture = () => canvasTex((g, s) => {
  const c = s / 2;
  g.translate(c, c);
  const base = g.createRadialGradient(-c * 0.25, -c * 0.3, 20, 0, 0, c);
  base.addColorStop(0, "#e6e6e6"); base.addColorStop(0.55, "#b3b3b3"); base.addColorStop(1, "#7a7a7a");
  g.fillStyle = base; g.beginPath(); g.arc(0, 0, c, 0, Math.PI * 2); g.fill();
  spun(g, c, 1800, 0.06, 0.05);
  g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 4;
  [0.86, 0.975].forEach((k) => { g.beginPath(); g.arc(0, 0, c * k, 0, Math.PI * 2); g.stroke(); });
  g.strokeStyle = "rgba(255,255,255,.55)"; g.lineWidth = 6; g.setLineDash([12, 10]);
  g.beginPath(); g.arc(0, 0, c * 0.92, 0, Math.PI * 2); g.stroke();
}, { w: 1024 });

// Tangential anisotropy directions: gives coin faces the radial light streak of spun metal.
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

// Data labels in the scene, as white cards: filled mark = long, hollow = short, ring = net.
function labelSprite(title, sub, mark) {
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = "rgba(255,255,255,.92)"; g.strokeStyle = "rgba(0,0,0,.14)"; g.lineWidth = 2;
    g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, 30); g.fill(); g.stroke();
    g.fillStyle = "#111"; g.strokeStyle = "#111"; g.lineWidth = 3;
    g.beginPath(); g.arc(44, h / 2 - 20, 9, 0, Math.PI * 2);
    if (mark === "fill") g.fill(); else g.stroke();
    if (mark === "ring") { g.beginPath(); g.arc(44, h / 2 - 20, 3, 0, Math.PI * 2); g.fill(); }
    g.font = "500 38px Geist, sans-serif"; g.textBaseline = "middle";
    g.fillText(title, 68, h / 2 - 20);
    g.fillStyle = "#6a6a6a"; g.font = "400 30px 'Geist Mono', monospace";
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
  renderer.toneMappingExposure = 1.3;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  await Promise.race([document.fonts?.ready, new Promise((r) => setTimeout(r, 1500))]);

  const scene = new THREE.Scene();
  scene.environment = studioEnvironment(renderer);
  scene.environmentIntensity = 1.1;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 200);
  scene.add(camera);

  // Backdrop glued to the camera: a white studio sweep that falls off to light grey, with a faint dot
  // lattice (the "on-chain" texture) that glass can refract.
  const backdropMat = new THREE.ShaderMaterial({
    depthWrite: false, toneMapped: false,
    uniforms: {
      uC1: { value: new THREE.Color("#fbf8f2") }, uC2: { value: new THREE.Color("#e2d9cb") },
      uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uGrid: { value: 0.6 }, uDpr: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }`,
    fragmentShader: `varying vec2 vUv; uniform vec3 uC1; uniform vec3 uC2; uniform vec2 uCenter; uniform float uAspect; uniform float uGrid; uniform float uDpr;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 d = (vUv - uCenter) * vec2(uAspect, 1.);
        float r = length(d);
        vec3 col = mix(uC1, uC2, smoothstep(0.05, 0.85, r));
        vec2 g = fract(gl_FragCoord.xy / (24. * uDpr)) - .5;
        float dotm = smoothstep(.1, .04, length(g));
        col -= vec3(.06, .07, .085) * dotm * uGrid * (1. - smoothstep(.1, .8, r));
        col += (hash(gl_FragCoord.xy) - .5) / 220.;
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backdropMat);
  backdrop.position.z = -80;
  backdrop.renderOrder = -10;
  camera.add(backdrop);

  const key = new THREE.DirectionalLight(0xffffff, 1.9);
  key.position.set(3, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 25 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 4;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-5, 3, -5); scene.add(rim);

  // ------------------------------------------------ materials
  const pigGlass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.6, ior: 1.5,
    attenuationColor: new THREE.Color("#ebe6de"), attenuationDistance: 7,
    clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 1, envMapIntensity: 1.4, transparent: true,
  });
  const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x141414, roughness: 0.15, clearcoat: 1, transparent: true });
  const chrome = new THREE.MeshPhysicalMaterial({ color: 0xf4f4f4, metalness: 1, roughness: 0.08 });
  const satin = new THREE.MeshPhysicalMaterial({ color: 0xc8c8c8, metalness: 1, roughness: 0.32, clearcoat: 0.4 });
  const podiumMat = new THREE.MeshPhysicalMaterial({ color: 0xfbf7f0, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.4 });
  const podiumTopMat = new THREE.MeshPhysicalMaterial({ color: 0xfffcf6, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.25 });
  const spunDir = spunAnisotropyTexture();
  const steel = new THREE.MeshPhysicalMaterial({
    map: steelTexture(), metalness: 1, roughness: 0.3, anisotropy: 0.85, anisotropyMap: spunDir,
    clearcoat: 0.35, clearcoatRoughness: 0.18,
  });
  const edge = new THREE.MeshStandardMaterial({ color: 0xcfcfcf, metalness: 1, roughness: 0.26, bumpMap: reededTexture(40), bumpScale: 2.5 });
  const coinMats = [edge, steel, steel];
  const pigMats = [pigGlass, darkMat];

  const addTo = (parent, geo, mat, p = [0, 0, 0], r = [0, 0, 0], s = [1, 1, 1], shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...p); m.rotation.set(...r); m.scale.set(...s);
    m.castShadow = shadow;
    parent.add(m); return m;
  };

  // ------------------------------------------------ the stand: podium + everything on it
  const stand = new THREE.Group();
  scene.add(stand);

  const podium = addTo(stand, new THREE.CylinderGeometry(2.05, 2.05, 0.9, 160), podiumMat, [0, TOP - 0.47, 0], [0, 0, 0], [1, 1, 1], true);
  podium.receiveShadow = true;
  const podiumTop = addTo(stand, new THREE.CylinderGeometry(1.97, 2.0, 0.04, 160), podiumTopMat, [0, TOP - 0.02, 0]);
  podiumTop.receiveShadow = true;
  addTo(stand, new THREE.TorusGeometry(2.052, 0.004, 6, 220), new THREE.MeshBasicMaterial({ color: 0xa39a8d }), [0, TOP - 0.16, 0], [Math.PI / 2, 0, 0]);

  // soft shadow of the podium on the sweep
  const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 96), new THREE.ShadowMaterial({ opacity: 0.07 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = TOP - 0.92; floor.receiveShadow = true;
  stand.add(floor);
  addTo(stand, new THREE.PlaneGeometry(6.2, 6.2),
    new THREE.MeshBasicMaterial({ map: radialTexture([[0, "rgba(0,0,0,.22)"], [0.55, "rgba(0,0,0,.08)"], [1, "rgba(0,0,0,0)"]]), transparent: true, depthWrite: false }),
    [0, TOP - 0.915, 0], [-Math.PI / 2, 0, 0]);

  // "tokenized" halo: hairline orbits and fine particles around the subject, dark on the white set
  const halo = new THREE.Group();
  halo.position.y = 0.2;
  stand.add(halo);
  const haloMats = [];
  const hairline = (opacity) => {
    const m = new THREE.MeshBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity, depthWrite: false, toneMapped: false });
    haloMats.push([m, opacity]); return m;
  };
  const ring1 = addTo(halo, new THREE.TorusGeometry(2.55, 0.004, 6, 256), hairline(0.22), [0, 0, 0], [1.32, 0.12, 0]);
  const ring2 = addTo(halo, new THREE.TorusGeometry(2.85, 0.003, 6, 256), hairline(0.13), [0, 0, 0], [1.75, -0.28, 0]);
  const pGeo = new THREE.BufferGeometry();
  const PN = 260, pPos = new Float32Array(PN * 3);
  for (let i = 0; i < PN; i++) {
    const a = Math.random() * Math.PI * 2, r = 2.35 + Math.random() * 0.7, y = (Math.random() - 0.5) * 0.35;
    pPos.set([Math.cos(a) * r, y, Math.sin(a) * r], i * 3);
  }
  pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0x222222, size: 0.018, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false });
  haloMats.push([pMat, 0.4]);
  const particles = new THREE.Points(pGeo, pMat);
  particles.rotation.x = 0.28;
  halo.add(particles);

  // ------------------------------------------------ delta coin
  const R = 0.66;
  const ext = { depth: 0.022, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 3, curveSegments: 1 };
  const coinBody = new THREE.CylinderGeometry(1, 1, 0.16, 128).rotateX(Math.PI / 2);
  const coinRim = new THREE.TorusGeometry(1.0, 0.05, 24, 160);
  const deltaGeo = new THREE.ExtrudeGeometry(deltaOutline(R, 0.034), ext);
  const hairGeo = new THREE.ExtrudeGeometry(deltaOutline(R * 0.75, 0.011), ext);
  const ringGeo = new THREE.TorusGeometry(R, 0.016, 12, 160);
  const dotGeo = new THREE.SphereGeometry(0.03, 16, 12);
  // Unit coin (radius 1, faces along z): brushed steel, reeded edge, the delta mark on both faces.
  function makeCoin() {
    const g = new THREE.Group();
    addTo(g, coinBody, coinMats, [0, 0, 0], [0, 0, 0], [1, 1, 1], true);
    addTo(g, coinRim, chrome);
    for (const side of [1, -1]) {
      const face = new THREE.Group();
      face.position.z = side * 0.08;
      if (side < 0) face.rotation.y = Math.PI;
      g.add(face);
      addTo(face, ringGeo, chrome);
      addTo(face, deltaGeo, chrome);
      addTo(face, hairGeo, chrome);
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / 3;
        addTo(face, dotGeo, chrome, [Math.cos(a) * R, Math.sin(a) * R, 0.01]);
      }
    }
    return g;
  }

  // ------------------------------------------------ piggy bank
  const pigRoot = new THREE.Group();
  pigRoot.position.y = -0.15;
  stand.add(pigRoot);
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
  addTo(pig, new THREE.BoxGeometry(0.66, 0.05, 0.11), darkMat, [0, 1.035, 0]);
  addTo(pig, new THREE.BoxGeometry(0.76, 0.03, 0.19), chrome, [0, 1.02, 0]);

  // a few coins already inside (opaque: transparent objects are skipped by the transmission pass)
  const COIN = 0.3;
  const pile = [];
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random());
    const m = addTo(pig, coinBody, coinMats,
      [Math.cos(a) * r * 0.6, -0.84 + Math.floor(i / 5) * 0.05 + Math.random() * 0.03, Math.sin(a) * r * 0.4],
      [Math.PI / 2 + (Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5], [COIN * 0.86, COIN * 0.86, COIN * 0.86]);
    pile.push(m);
  }

  // the hero coin, in pig space so it lines up with the slot (slot runs along pig x, coin faces along z)
  const drop = makeCoin();
  drop.scale.setScalar(COIN);
  pig.add(drop);

  // ------------------------------------------------ balance scale (strategy 01)
  const scaleRoot = new THREE.Group();
  stand.add(scaleRoot);
  const S = (geo, mat, p, r) => addTo(scaleRoot, geo, mat, p, r, [1, 1, 1], true);
  S(new THREE.CylinderGeometry(0.75, 0.86, 0.12, 96), satin, [0, -1.55, 0]).receiveShadow = true;
  S(new THREE.CylinderGeometry(0.42, 0.6, 0.1, 96), chrome, [0, -1.44, 0]).receiveShadow = true;
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
  scaleRoot.add(new THREE.LineSegments(strGeo, new THREE.LineBasicMaterial({ color: 0x8a8a8a, transparent: true, opacity: 0.8 })));

  const ethTop = new THREE.ConeGeometry(0.3, 0.5, 4, 1).translate(0, 0.25, 0);
  const ethBot = new THREE.ConeGeometry(0.3, 0.32, 4, 1).rotateX(Math.PI).translate(0, -0.16, 0);
  const makeEth = (mat, edges) => {
    const g = new THREE.Group();
    for (const geo of [ethTop, ethBot]) {
      const m = new THREE.Mesh(geo, mat); m.castShadow = true; g.add(m);
      if (edges) g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })));
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
  const fundCoins = Array.from({ length: FUND }, () => { const m = addTo(scaleRoot, fundGeo, coinMats, [0, 0, 0], [0, 0, 0], [1, 1, 1], true); m.visible = false; return m; });

  // ------------------------------------------------ state
  let tTarget = 0, tNow = 0, visible = true, mobile = false, aspect = 1;
  let theta = 0, thetaV = 0;
  let onTick = null;
  const clock = new THREE.Clock();
  const tmpLook = new THREE.Vector3();

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
    backdropMat.uniforms.uCenter.value.set(0.5 + k.sx * 0.5, 0.5 + k.sy * 0.5 + 0.04);

    // the stand sinks out of frame once the strategy has been shown
    const exit = easeIn(seg(t, 7.5, 8.3));
    stand.position.y = -6.5 * exit;
    stand.visible = exit < 0.999;
    const haloA = 1 - smooth(seg(t, 7.4, 7.9));
    for (const [m, o] of haloMats) m.opacity = o * haloA;
    halo.visible = haloA > 0.01;
    ring1.rotation.z = time * 0.08 * idle + t * 0.35;
    ring2.rotation.z = -time * 0.05 * idle - t * 0.25;
    particles.rotation.y = time * 0.03 * idle + t * 0.18;

    // piggy bank: turns slowly, then lifts off and fades for the scale (2.65 → 3.3)
    const pigOut = smooth(seg(t, 2.65, 3.3));
    pigRoot.position.y = -0.15 + easeIn(pigOut) * 1.6;
    pigRoot.scale.setScalar(Math.max(0.0001, 1 - pigOut * 0.3));
    for (const m of pigMats) m.opacity = 1 - pigOut;
    pigRoot.visible = pigOut < 0.99;
    const solid = pigOut < 0.12; // opaque coins can't fade with the glass
    pile.forEach((m) => (m.visible = solid));
    pig.rotation.y = -2.6 + Math.sin(time * 0.3) * 0.05 * idle + seg(t, 0.2, 2.6) * 0.45;

    // the hero coin: falls from above the frame, drops through the slot and settles on the pile
    const f = seg(t, 0.12, 1.15);
    const fall = easeIn(seg(f, 0, 0.72));
    const sink = easeOut(seg(f, 0.72, 1));
    const topY = mobile ? 4.4 : 6.2;
    drop.visible = solid && f > 0.001;
    drop.position.set(lerp(0.12, 0, fall), f < 0.72 ? lerp(topY, 1.1, fall) : lerp(1.1, -0.72, sink), lerp(0.05, 0, fall) + sink * 0.12);
    const settle = smooth(seg(f, 0.82, 1));
    drop.rotation.set(settle * (Math.PI / 2 - 0.12) + (1 - fall) * 0.25 * Math.sin(time * 1.3) * idle, 0, (1 - fall) * 9 + seg(f, 0, 0.72) * 2);
    drop.scale.setScalar(COIN * (1 + (1 - fall) * 0.35));

    // balance scale: rises on the podium as the pig leaves
    const grow = easeOut(seg(t, 2.95, 3.6));
    const sc = Math.max(0.0001, grow) * (mobile ? 0.82 : 1);
    scaleRoot.visible = t > 2.95;
    scaleRoot.scale.setScalar(sc);
    scaleRoot.position.y = TOP - SCALE_FOOT * sc;

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
      const fi = clamp01((fu - i) / 1.5);
      m.visible = fi > 0;
      if (!m.visible) return;
      const e = easeInOut(fi);
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
