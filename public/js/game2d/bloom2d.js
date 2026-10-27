// Cheap, good-looking bloom: bright parts of the frame are downsampled through a small mip chain
// and blurred back up (tent filter, additive). Everything runs at half resolution or less.
import * as THREE from 'three';

const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const DOWN = `
uniform sampler2D src; uniform vec2 texel; uniform float threshold; varying vec2 vUv;
void main(){
  vec3 c = texture2D(src, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(src, vUv + texel * vec2(1.0, -1.0)).rgb
         + texture2D(src, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(src, vUv + texel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  if (threshold > 0.0) { float l = max(c.r, max(c.g, c.b)); c *= smoothstep(threshold, threshold + 0.35, l); }
  gl_FragColor = vec4(c, 1.0);
}`;
const UP = `
uniform sampler2D src; uniform vec2 texel; uniform float strength; varying vec2 vUv;
void main(){
  vec3 c = texture2D(src, vUv).rgb * 4.0;
  c += (texture2D(src, vUv + texel * vec2(-1.0, 0.0)).rgb + texture2D(src, vUv + texel * vec2(1.0, 0.0)).rgb
      + texture2D(src, vUv + texel * vec2(0.0, -1.0)).rgb + texture2D(src, vUv + texel * vec2(0.0, 1.0)).rgb) * 2.0;
  c += texture2D(src, vUv + texel * vec2(-1.0, -1.0)).rgb + texture2D(src, vUv + texel * vec2(1.0, -1.0)).rgb
     + texture2D(src, vUv + texel * vec2(-1.0, 1.0)).rgb + texture2D(src, vUv + texel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 16.0 * strength, 1.0);
}`;

export class Bloom {
  constructor(levels = 5) {
    this.levels = levels;
    this.rts = Array.from({ length: levels }, () => new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, depthBuffer: false }));
    this.down = new THREE.ShaderMaterial({ uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() }, threshold: { value: 0 } }, vertexShader: VS, fragmentShader: DOWN, depthTest: false, depthWrite: false });
    this.up = new THREE.ShaderMaterial({ uniforms: { src: { value: null }, texel: { value: new THREE.Vector2() }, strength: { value: 1 } }, vertexShader: VS, fragmentShader: UP, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.down);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.threshold = 0.86;
  }

  get texture() { return this.rts[0].texture; }

  resize(w, h) {
    this.rts.forEach((rt, i) => {
      const s = 2 ** (i + 1), rw = Math.max(2, Math.round(w / s)), rh = Math.max(2, Math.round(h / s));
      if (rt.width !== rw || rt.height !== rh) rt.setSize(rw, rh);
    });
  }

  render(renderer, src, srcW, srcH) {
    this.quad.material = this.down;
    const d = this.down.uniforms;
    for (let i = 0; i < this.levels; i++) {
      const input = i === 0 ? src : this.rts[i - 1].texture;
      const iw = i === 0 ? srcW : this.rts[i - 1].width, ih = i === 0 ? srcH : this.rts[i - 1].height;
      d.src.value = input; d.texel.value.set(1 / iw, 1 / ih); d.threshold.value = i === 0 ? this.threshold : 0;
      renderer.setRenderTarget(this.rts[i]);
      renderer.render(this.scene, this.cam);
    }
    this.quad.material = this.up;
    const u = this.up.uniforms;
    for (let i = this.levels - 1; i > 0; i--) {
      u.src.value = this.rts[i].texture; u.texel.value.set(1 / this.rts[i].width, 1 / this.rts[i].height); u.strength.value = 1;
      renderer.setRenderTarget(this.rts[i - 1]);
      renderer.render(this.scene, this.cam);
    }
  }
}
