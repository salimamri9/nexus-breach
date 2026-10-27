// GPU sprite helpers for the 2D view. Everything lies flat on the ground plane (x, z in metres),
// seen from straight above. A sprite "faces" +x; rotation.y = -angle turns it to a map angle.
import * as THREE from 'three';

export const QUAD = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export function texture(src, opts = {}) {
  const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : new THREE.Texture(src);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = opts.anisotropy ?? 4;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Blending that never touches the destination alpha: the ground pass keeps "wetness" in alpha,
// and sprites drawn over the ground must leave it alone.
export function keepAlpha(mat, additive = false) {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
  return mat;
}

// uv rectangle (u0, v0, u1, v1) of an atlas frame
export function frameRect(atlas, f) {
  const W = atlas.image.width, H = atlas.image.height;
  return new THREE.Vector4(f.x / W, 1 - (f.y + f.h) / H, (f.x + f.w) / W, 1 - f.y / H);
}

const spriteVS = `
  uniform vec4 rect; varying vec2 vUv;
  void main(){ vUv = mix(rect.xy, rect.zw, uv); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const spriteFS = `
  uniform sampler2D map; uniform vec3 color; uniform float alpha; varying vec2 vUv;
  void main(){ vec4 t = texture2D(map, vUv); float a = t.a * alpha; if (a < 0.01) discard; gl_FragColor = vec4(t.rgb * color, a); }`;

// a single textured quad (characters, terminals, drones…)
export function spriteMaterial(map, rect = new THREE.Vector4(0, 0, 1, 1), opts = {}) {
  return keepAlpha(new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, rect: { value: rect }, color: { value: new THREE.Color(opts.color ?? 0xffffff) }, alpha: { value: opts.alpha ?? 1 } },
    vertexShader: spriteVS, fragmentShader: spriteFS,
    transparent: true, depthWrite: false, depthTest: opts.depthTest ?? true,
  }), !!opts.additive);
}

export function sprite(map, rect, w, h, opts) {
  const m = new THREE.Mesh(QUAD, spriteMaterial(map, rect, opts));
  m.scale.set(w, 1, h);
  m.frustumCulled = false;
  return m;
}

// many static sprites from one atlas in a single draw call; per-instance uv rect + alpha
export function instancedSprites(map, items, opts = {}) {
  const mesh = new THREE.InstancedMesh(QUAD, keepAlpha(new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, color: { value: new THREE.Color(opts.color ?? 0xffffff) }, time: { value: 0 } },
    vertexShader: `
      attribute vec4 aRect; attribute float aAlpha; attribute float aPhase; varying vec2 vUv; varying float vA; uniform float time;
      void main(){ vUv = mix(aRect.xy, aRect.zw, uv); vA = aAlpha ${opts.blink ? '* step(0.3, sin(time * 2.2 + aPhase))' : ''};
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D map; uniform vec3 color; varying vec2 vUv; varying float vA;
      void main(){ vec4 t = texture2D(map, vUv); float a = t.a * vA; if (a < 0.01) discard; gl_FragColor = vec4(t.rgb * color, a); }`,
    transparent: true, depthWrite: false,
  }), !!opts.additive), Math.max(1, items.length));
  const rects = new Float32Array(Math.max(1, items.length) * 4), alpha = new Float32Array(Math.max(1, items.length)), phase = new Float32Array(Math.max(1, items.length));
  const d = new THREE.Object3D();
  items.forEach((it, i) => {
    d.position.set(it.x, it.y ?? 0, it.z);
    d.rotation.set(0, -(it.rot || 0), 0);
    d.scale.set(it.w, 1, it.h);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
    rects.set([it.rect.x, it.rect.y, it.rect.z, it.rect.w], i * 4);
    alpha[i] = it.alpha ?? 1;
    phase[i] = it.phase ?? 0;
  });
  mesh.count = items.length;
  mesh.geometry = QUAD.clone();
  mesh.geometry.setAttribute('aRect', new THREE.InstancedBufferAttribute(rects, 4));
  mesh.geometry.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(alpha, 1));
  mesh.geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  mesh.frustumCulled = false;
  return mesh;
}
