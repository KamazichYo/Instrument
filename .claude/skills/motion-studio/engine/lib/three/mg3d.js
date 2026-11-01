/*!
 * MG3 — 3D-слой Motion Studio поверх three.js (r187, MIT). Детерминированный: кадр = функция времени.
 * Подключение: lib/mg.js → lib/three/three.mg.js → lib/three/mg3d.js
 *   const S = MG3.stage(comp, { look: 'studio' });   // сцена, камера, свет, пост-обработка; рендер каждого кадра сам
 *   const m = new THREE.Mesh(geo, MG3.mat.glossy('#ff5a1f')); S.add(m);
 *   tl.from(m, { y: 3, rotY: -90, scale: 0 }, { at: 0.2, dur: 0.8, ease: 'land' });   // MG-таймлайн двигает 3D-объекты
 * Лицензия: MIT.
 */
(function () {
  'use strict';
  const T = window.THREE;
  if (!T) throw new Error('MG3: сначала подключи lib/three/three.mg.js');
  const D2R = Math.PI / 180;

  // ---------- ассеты: встроенные (embed.mjs) или по пути ----------
  window.MG_ASSETS = window.MG_ASSETS || {};
  const url = (p) => window.MG_ASSETS[p] || window.MG_ASSETS[p.split('/').pop()] || p;

  // ---------- образы освещения ----------
  const LOOKS = {
    studio: { bg: ['#1d1a26', '#060608'], env: 0.55, exposure: 0.92, key: ['#ffffff', 2.4], rim: ['#ff8a5c', 3.0], fill: 0.25, bloom: [0.22, 0.45, 0.93], grain: 0.035, vignette: 0.32 },
    bright: { envMap: 'room', bg: ['#fbfaf7', '#e7e3db'], env: 0.8, exposure: 1.0, key: ['#ffffff', 1.6], rim: ['#ffffff', 1.0], fill: 0.6, bloom: false, grain: 0.02, vignette: 0.12 },
    neon: { bg: ['#120a24', '#030208'], env: 0.3, exposure: 1.0, key: ['#9aa7ff', 1.2], rim: ['#ff2fd2', 4.0], fill: 0.2, bloom: [0.7, 0.55, 0.75], grain: 0.045, vignette: 0.4 },
    sunset: { bg: ['#ffb27a', '#3a1f45'], env: 0.6, exposure: 1.0, key: ['#ffd6a8', 2.6], rim: ['#ff6aa0', 2.0], fill: 0.4, bloom: [0.4, 0.5, 0.8], grain: 0.03, vignette: 0.3 },
    noir: { bg: ['#17171a', '#000000'], env: 1.0, exposure: 0.95, key: ['#ffffff', 3.2], rim: ['#ffffff', 1.5], fill: 0.08, bloom: [0.25, 0.4, 0.9], grain: 0.05, vignette: 0.5 },
  };

  function gradientTexture(c1, c2, w, h) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = Math.round(512 * h / w) || 512;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(cv.width * 0.5, cv.height * 0.42, 0, cv.width * 0.5, cv.height * 0.5, Math.max(cv.width, cv.height) * 0.75);
    gr.addColorStop(0, c1); gr.addColorStop(1, c2); g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
    const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace; return tx;
  }

  // «Студия с софтбоксами»: тёмная комната и светящиеся полосы — хром и глянец получают контрастные отражения
  function stripsScene(warm = '#ffffff') {
    const sc = new T.Scene(); sc.background = new T.Color('#050506');
    const mk = (w, h, x, y, z, ry, i, c = warm) => { const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ color: new T.Color(c).multiplyScalar(i), side: T.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); m.rotateZ(ry); sc.add(m); };
    mk(12, 1.2, 0, 6, 2, 0, 6);          // верхний длинный
    mk(1.4, 9, -8, 1, 3, 0, 4);          // левый вертикальный
    mk(1.4, 9, 8, 1, -2, 0, 3);          // правый
    mk(10, 0.6, 0, -2, -9, 0, 2.5);      // контровая полоса
    mk(4, 4, 6, 4, 7, 0, 1.2, '#ffd7b0'); // тёплый софтбокс
    mk(18, 5, 0, 1.5, 11, 0, 0.9);       // большой фронтальный — лицевые грани хрома не уходят в чёрное
    mk(30, 30, 0, -12, 0, 0, 0.12);      // слабый «пол» снизу
    return sc;
  }

  // финальный проход: зерно (меняется по кадру, детерминированно), виньетка, хроматическая аберрация
  const FinishShader = {
    uniforms: { tDiffuse: { value: null }, uGrain: { value: 0.03 }, uVig: { value: 0.3 }, uAb: { value: 0 }, uSeed: { value: 0 }, uRes: { value: new T.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uGrain, uVig, uAb, uSeed; uniform vec2 uRes; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + uSeed * 0.618) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5; vec4 c;
        if (uAb > 0.0) { vec2 o = d * uAb * 0.02; c = vec4(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b, texture2D(tDiffuse, vUv).a); }
        else c = texture2D(tDiffuse, vUv);
        c.rgb *= 1.0 - uVig * smoothstep(0.25, 0.85, length(d * vec2(uRes.x / uRes.y, 1.0)) );
        c.rgb += (h(floor(vUv * uRes)) - 0.5) * uGrain;
        gl_FragColor = c;
      }`,
  };

  /**
   * Сцена с камерой, светом и пост-обработкой. Рендерит каждый кадр в comp.onSeek.
   * opts: look ('studio'|'bright'|'neon'|'sunset'|'noir'), bg ('#hex' | ['#c1','#c2'] | 'transparent'),
   *       fov 30, camera [x,y,z], target [x,y,z], floor (true | {y, shadow, color}), shadows true,
   *       bloom [strength, radius, threshold] | false, grain, vignette, aberration, fog [near, far], exposure, env
   */
  function stage(comp, opts = {}) {
    const L = Object.assign({}, LOOKS[opts.look || 'studio'], opts);
    const alpha = MG.ALPHA || L.bg === 'transparent';
    const W = comp.width, H = comp.height;
    const canvas = document.createElement('canvas');
    canvas.className = 'mg3-canvas';
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    const host = opts.host ? (typeof opts.host === 'string' ? document.querySelector(opts.host) : opts.host) : comp.stage;
    host.insertBefore(canvas, host.firstChild);

    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = L.exposure;
    renderer.shadowMap.enabled = L.shadows !== false;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    if (alpha) renderer.setClearColor(0x000000, 0);

    const scene = new T.Scene();
    if (!alpha) scene.background = Array.isArray(L.bg) ? gradientTexture(L.bg[0], L.bg[1], W, H) : new T.Color(L.bg);
    if (L.fog) scene.fog = new T.Fog(Array.isArray(L.bg) ? L.bg[1] : L.bg, L.fog[0], L.fog[1]);
    if (L.env) {
      const pm = new T.PMREMGenerator(renderer);
      scene.environment = pm.fromScene(L.envMap === 'room' ? new T.RoomEnvironment() : stripsScene(), 0.03).texture;
      scene.environmentIntensity = L.env;
    }

    const camera = new T.PerspectiveCamera(L.fov || 30, W / H, L.near || 0.1, L.far || 200);
    const target = new T.Vector3(...(L.target || [0, 0, 0]));
    camera.position.set(...(L.camera || [0, 1.2, 9]));
    // вертикаль: тот же объект должен поместиться по ширине — отодвигаем камеру
    if (H > W && !opts.camera) camera.position.multiplyScalar(1.55);
    // орбита (необязательно): S.orbit.{radius, yaw, pitch} в градусах — удобно анимировать облёт таймлайном
    const orbit = opts.orbit ? Object.assign({ radius: camera.position.distanceTo(target), yaw: 0, pitch: 8 }, opts.orbit) : null;

    // свет: ключ (с тенью), контровой (подсветка силуэта), заполнение небом
    const key = new T.DirectionalLight(L.key[0], L.key[1]);
    key.position.set(4, 7, 5); key.castShadow = L.shadows !== false;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
    key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 6;
    const rim = new T.DirectionalLight(L.rim[0], L.rim[1]); rim.position.set(-5, 3, -6);
    const fill = new T.HemisphereLight('#ffffff', '#202028', L.fill);
    scene.add(key, rim, fill, key.target);

    let floor = null;
    if (L.floor) {
      const f = L.floor === true ? {} : L.floor;
      floor = new T.Mesh(new T.PlaneGeometry(200, 200), f.color ? new T.MeshStandardMaterial({ color: f.color, roughness: f.roughness ?? 0.6, metalness: 0 }) : new T.ShadowMaterial({ opacity: f.shadow ?? 0.35 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = f.y ?? -1; floor.receiveShadow = true;
      scene.add(floor);
    }

    const composer = new T.EffectComposer(renderer);
    composer.setPixelRatio(1); composer.setSize(W, H);
    composer.addPass(new T.RenderPass(scene, camera));
    let bloom = null;
    if (L.bloom) { bloom = new T.UnrealBloomPass(new T.Vector2(W, H), L.bloom[0], L.bloom[1], L.bloom[2]); composer.addPass(bloom); }
    composer.addPass(new T.OutputPass());
    const finish = new T.ShaderPass(FinishShader);
    finish.uniforms.uGrain.value = alpha ? 0 : L.grain || 0;
    finish.uniforms.uVig.value = alpha ? 0 : L.vignette || 0;
    finish.uniforms.uAb.value = L.aberration || 0;
    finish.uniforms.uRes.value.set(W, H);
    composer.addPass(finish);

    const timed = []; // материалы с uTime
    const frameFns = [];
    const S = {
      THREE: T, scene, camera, renderer, composer, target, orbit, key, rim, fill, floor, bloom, finish, look: L, width: W, height: H,
      add(...o) { scene.add(...o); return o[0]; },
      /** fn(t) — своя логика 3D в каждом кадре (до рендера) */
      onFrame(fn) { frameFns.push(fn); return S; },
      /** материал с uniform uTime получит время композиции */
      timed(mat) { timed.push(mat); return mat; },
      render(t) {
        for (const fn of frameFns) fn(t);
        for (const m of timed) if (m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = t;
        if (orbit) {
          const y = orbit.yaw * D2R, p = orbit.pitch * D2R;
          camera.position.set(target.x + orbit.radius * Math.sin(y) * Math.cos(p), target.y + orbit.radius * Math.sin(p), target.z + orbit.radius * Math.cos(y) * Math.cos(p));
        }
        camera.lookAt(target);
        camera.updateProjectionMatrix();
        finish.uniforms.uSeed.value = Math.floor(t * comp.fps);
        composer.render();
      },
    };
    comp.onSeek((t) => S.render(t));
    return S;
  }

  // ---------- материалы ----------
  const mat = {
    glossy: (c, o = {}) => new T.MeshPhysicalMaterial({ color: c, roughness: 0.22, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08, ...o }),
    matte: (c, o = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.85, metalness: 0, ...o }),
    clay: (c = '#e9e4dc', o = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.95, metalness: 0, ...o }),
    metal: (c = '#c9ccd2', o = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.28, metalness: 1, ...o }),
    chrome: (c = '#ffffff', o = {}) => new T.MeshStandardMaterial({ color: c, roughness: 0.04, metalness: 1, ...o }),
    gold: (o = {}) => new T.MeshStandardMaterial({ color: '#ffcf6b', roughness: 0.2, metalness: 1, ...o }),
    glass: (tint = '#ffffff', o = {}) => new T.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.6, ior: 1.45, clearcoat: 1, attenuationColor: tint, attenuationDistance: 2, ...o }),
    frosted: (tint = '#ffffff', o = {}) => new T.MeshPhysicalMaterial({ color: tint, metalness: 0, roughness: 0.35, transmission: 1, thickness: 0.8, ior: 1.4, ...o }),
    emissive: (c, intensity = 2.5, o = {}) => new T.MeshStandardMaterial({ color: '#000000', emissive: c, emissiveIntensity: intensity, ...o }),
    iridescent: (c = '#ffffff', o = {}) => new T.MeshPhysicalMaterial({ color: c, roughness: 0.15, metalness: 0.3, iridescence: 1, iridescenceIOR: 1.6, clearcoat: 1, ...o }),
  };

  // ---------- геометрия ----------
  const roundedBox = (w = 1, h = 1, d = 1, r = 0.12, seg = 6) => new T.RoundedBoxGeometry(w, h, d, seg, r);

  /** Объёмный текст по буквам (для стаггера): { group, letters: [Mesh], width, height }. Кириллица — в шрифтах inter-display-*. */
  function text3d(str, o = {}) {
    const name = o.font || 'inter-display-bold';
    const data = (window.MG_FONTS || {})[name];
    if (!data) throw new Error(`MG3.text3d: нет шрифта «${name}» — подключи lib/three/${name}.font.js или сделай свой через font3d.mjs`);
    const font = new T.Font(data);
    const size = o.size ?? 1, depth = o.depth ?? size * 0.28, bevel = o.bevel ?? size * 0.025;
    const material = o.material || mat.glossy(o.color || '#f4f2ee');
    const sideMaterial = o.sideMaterial || material;
    const group = new T.Group(); const letters = [];
    const scale = size / data.resolution;
    let x = 0; const tracking = (o.tracking ?? -0.02) * size;
    for (const ch of str) {
      const g = data.glyphs[ch] || data.glyphs['?'];
      const adv = (g ? g.ha : 500) * scale;
      if (ch !== ' ' && g && g.o) {
        const geo = new T.TextGeometry(ch, { font, size, depth, curveSegments: o.curveSegments ?? 10, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 4 });
        geo.computeBoundingBox();
        const bb = geo.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, cz = (bb.min.z + bb.max.z) / 2;
        geo.translate(-cx, -cy, -cz); // пивот в центре буквы — вращения выглядят естественно
        const m = new T.Mesh(geo, [material, sideMaterial]);
        m.position.set(x + cx, cy, 0); m.castShadow = true; m.receiveShadow = true;
        m.userData.char = ch; group.add(m); letters.push(m);
      }
      x += adv + tracking;
    }
    const width = x - tracking;
    const align = o.align || 'center';
    const shiftX = align === 'center' ? -width / 2 : align === 'right' ? -width : 0;
    const capH = size * 0.72;
    letters.forEach((m) => { m.position.x += shiftX; m.position.y -= capH / 2; });
    return { group, letters, width, height: capH };
  }

  /** Отражение в «полу»: зеркальные копии мешей следуют за оригиналами (дешевле настоящего зеркала). */
  function reflect(S, src, o = {}) {
    const y0 = o.y ?? (S.floor ? S.floor.position.y : -1), op = o.opacity ?? 0.22;
    const meshes = []; src.traverse((m) => { if (m.isMesh) meshes.push(m); });
    const pairs = meshes.map((m) => {
      const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mt) => { const c = mt.clone(); c.transparent = true; c.opacity = op; c.depthWrite = false; if (c.transmission) c.transmission = 0; return c; });
      const r = new T.Mesh(m.geometry, Array.isArray(m.material) ? mats : mats[0]); r.renderOrder = -1; S.add(r); return [m, r];
    });
    const mirror = new T.Matrix4().makeScale(1, -1, 1).premultiply(new T.Matrix4().makeTranslation(0, 2 * y0, 0));
    S.onFrame(() => { src.updateMatrixWorld(true); for (const [m, r] of pairs) { r.matrixAutoUpdate = false; r.matrix.multiplyMatrices(mirror, m.matrixWorld); r.matrixWorldNeedsUpdate = true; } });
    return pairs.map((p) => p[1]);
  }

  /** Частицы-пылинки/боке: детерминированно, позиция = функция uTime. */
  function particles(S, o = {}) {
    const n = o.count || 400, r = MG.rng(o.seed || 7), spread = o.spread || [12, 7, 10];
    const pos = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * spread[0]; pos[i * 3 + 1] = (r() - 0.5) * spread[1]; pos[i * 3 + 2] = (r() - 0.5) * spread[2]; seed[i] = r(); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new T.BufferAttribute(seed, 1));
    const m = new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uColor: { value: new T.Color(o.color || '#ffd9b8') }, uSize: { value: (o.size || 6) * (S.height / 1080) }, uDrift: { value: o.drift ?? 0.15 }, uOpacity: { value: o.opacity ?? 0.6 } },
      vertexShader: `attribute float aSeed; uniform float uTime, uSize, uDrift; varying float vA;
        void main(){ vec3 p = position; p.y += sin(uTime * 0.6 + aSeed * 40.0) * uDrift; p.x += cos(uTime * 0.4 + aSeed * 23.0) * uDrift; p.y += uTime * uDrift * 0.3 * (aSeed - 0.3);
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uSize * (0.4 + aSeed) * (8.0 / -mv.z); vA = 0.35 + 0.65 * fract(aSeed * 7.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(uColor, a * vA * uOpacity); }`,
    });
    const pts = new T.Points(g, m); S.timed(m); S.add(pts); return pts;
  }

  /** GLB/GLTF (в т.ч. из Meshy, Spline, Blender). Встроенный через embed.mjs — работает и по двойному клику. */
  function loadGLB(path) {
    return new Promise((res, rej) => new T.GLTFLoader().load(url(path), (g) => {
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      res(g);
    }, undefined, (e) => rej(new Error('MG3.loadGLB: не загрузился ' + path + ' — ' + (e.message || e) + '. Встрой файл: node engine/embed.mjs ' + path))));
  }
  /** Встроенные анимации GLB: вернёт fn(t) — повесь в S.onFrame */
  function clips(gltf, root, names) {
    const mixer = new T.AnimationMixer(root || gltf.scene);
    (gltf.animations || []).filter((c) => !names || names.includes(c.name)).forEach((c) => mixer.clipAction(c).play());
    return (t) => mixer.setTime(t);
  }
  /** Нормализует объект: центр в (0,0,0), наибольший размер = size, низ на y = floorY (если задан) */
  function normalize(obj, size = 2, floorY) {
    const box = new T.Box3().setFromObject(obj), s = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3());
    const k = size / Math.max(s.x, s.y, s.z || 1e-6);
    obj.scale.multiplyScalar(k);
    obj.position.sub(c.multiplyScalar(k));
    if (floorY !== undefined) obj.position.y += floorY + (s.y * k) / 2;
    return obj;
  }
  /** Текстура из картинки (скриншот, обложка). Встроенные ассеты — без проблем с file:// */
  function texture(path, o = {}) {
    return new Promise((res, rej) => new T.TextureLoader().load(url(path), (tx) => { tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 8; Object.assign(tx, o); res(tx); }, undefined, () => rej(new Error('MG3.texture: ' + path))));
  }
  /** Текстура с текстом/графикой из canvas 2D: draw(ctx, w, h). Шрифты MG (Inter, Unbounded…) доступны. */
  function canvasTexture(w, h, draw) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const tx = new T.CanvasTexture(cv); tx.colorSpace = T.SRGBColorSpace; tx.anisotropy = 8; return tx;
  }
  /** Проекция 3D-точки в пиксели сцены — чтобы привязать DOM-подпись к объекту */
  function toScreen(S, v3) { const p = v3.clone().project(S.camera); return { x: (p.x * 0.5 + 0.5) * S.width, y: (-p.y * 0.5 + 0.5) * S.height, behind: p.z > 1 }; }

  window.MG3 = { stage, mat, reflect, roundedBox, text3d, particles, loadGLB, clips, normalize, texture, canvasTexture, toScreen, gradientTexture, LOOKS, url, D2R };
})();
