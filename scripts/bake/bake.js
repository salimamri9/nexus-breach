// Renders the 3D source models top-down (orthographic) into sprite atlases for the 2D client.
// Sprites face +x (map angle 0); screen up = map -y. Run through scripts/bake-sprites.mjs.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const PPM = 64;          // sprite pixels per metre
const SS = 2;            // supersampling
const PROPS = ['covered_car', 'trashbag', 'old_tyre', 'utility_box_01', 'utility_box_02', 'metal_trash_can', 'wooden_crate_01', 'barrel_03',
  'dead_tree_trunk', 'dead_tree_trunk_02', 'exterior_aircon_unit', 'security_camera_01', 'portable_searchlight', 'propane_tank', 'power_box_01',
  'old_military_crate', 'street_rat', 'cement_bag', 'portable_generator', 'fire_hydrant', 'steel_frame_shelves_01', 'street_lamp_01', 'street_lamp_02',
  'concrete_road_barrier', 'concrete_road_barrier_02'];

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xe8eeff, 0x4a4438, 1.9));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-3, 8, -4); // from the top-left of the screen
scene.add(sun);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
cam.up.set(0, 0, -1);

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const load = (id) => loader.loadAsync(`/art-src/models/${id}.glb`);

// render obj (already in the scene) with the frame centred on (cx, cz), w × h metres
function shoot(w, h, cx = 0, cz = 0, ppm = PPM) {
  const pw = Math.round(w * ppm), ph = Math.round(h * ppm);
  renderer.setSize(pw * SS, ph * SS, false);
  cam.left = -w / 2; cam.right = w / 2; cam.top = h / 2; cam.bottom = -h / 2;
  cam.position.set(cx, 60, cz);
  cam.lookAt(cx, 0, cz);
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const c = document.createElement('canvas');
  c.width = pw; c.height = ph;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(renderer.domElement, 0, 0, pw, ph);
  return c;
}

// simple shelf packer → one atlas canvas + frame table
function pack(items, width = 2048) {
  items.sort((a, b) => b.c.height - a.c.height);
  let x = 0, y = 0, rowH = 0;
  for (const it of items) {
    if (x + it.c.width > width) { x = 0; y += rowH + 2; rowH = 0; }
    it.x = x; it.y = y;
    x += it.c.width + 2;
    rowH = Math.max(rowH, it.c.height);
  }
  const atlas = document.createElement('canvas');
  atlas.width = width; atlas.height = y + rowH;
  const g = atlas.getContext('2d');
  const frames = {};
  for (const it of items) {
    g.drawImage(it.c, it.x, it.y);
    frames[it.name] = { x: it.x, y: it.y, w: it.c.width, h: it.c.height, mw: it.mw, mh: it.mh };
  }
  return { png: atlas.toDataURL('image/png'), frames };
}

async function bakeCharacters() {
  const gltf = await load('soldier');
  const items = [], anims = {};
  const counts = { Idle: 8, Walk: 14, Run: 12 };
  for (const [name, n] of Object.entries(counts)) {
    const model = SkeletonUtils.clone(gltf.scene);
    model.rotation.y = -Math.PI / 2; // face +x
    scene.add(model);
    const mixer = new THREE.AnimationMixer(model);
    const clip = gltf.animations.find((a) => a.name === name);
    mixer.clipAction(clip).play();
    anims[name.toLowerCase()] = [];
    for (let i = 0; i < n; i++) {
      mixer.setTime((clip.duration * i) / n);
      model.updateMatrixWorld(true);
      const id = `${name.toLowerCase()}_${i}`;
      items.push({ name: id, c: shoot(2, 2, 0, 0), mw: 2, mh: 2 });
      anims[name.toLowerCase()].push(id);
    }
    scene.remove(model);
  }
  // sleepers: lying on their back and on their side
  const poses = [{ id: 'sleeper_back', z: 0 }, { id: 'sleeper_side', z: 0.9 }, { id: 'sleeper_curl', z: -1.2 }];
  for (const p of poses) {
    const model = SkeletonUtils.clone(gltf.scene);
    const mixer = new THREE.AnimationMixer(model);
    mixer.clipAction(gltf.animations.find((a) => a.name === 'Idle')).play();
    mixer.setTime(0.4 + p.z);
    const lie = new THREE.Group();
    model.rotation.y = Math.PI; // face +z, then tip over so the face points up
    lie.add(model);
    lie.rotation.set(-Math.PI / 2, 0, 0);
    const outer = new THREE.Group();
    outer.add(lie);
    outer.rotation.y = p.z * 0.4;
    lie.rotation.z = p.z;
    scene.add(outer);
    outer.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(outer, true);
    const c = bb.getCenter(new THREE.Vector3());
    items.push({ name: p.id, c: shoot(2.4, 2.4, c.x, c.z), mw: 2.4, mh: 2.4 });
    scene.remove(outer);
  }
  return { ...pack(items, 1024), anims };
}

async function bakeProps() {
  const items = [];
  for (const id of PROPS) {
    let g;
    try { g = await load(id); } catch { continue; }
    const obj = g.scene;
    obj.updateMatrixWorld(true);
    let bb = new THREE.Box3().setFromObject(obj);
    let size = bb.getSize(new THREE.Vector3());
    const holder = new THREE.Group();
    holder.add(obj);
    if (size.z > size.x) holder.rotation.y = Math.PI / 2; // long axis along +x
    scene.add(holder);
    holder.updateMatrixWorld(true);
    bb = new THREE.Box3().setFromObject(holder);
    size = bb.getSize(new THREE.Vector3());
    const c = bb.getCenter(new THREE.Vector3());
    const w = size.x + 0.2, h = size.z + 0.2;
    const ppm = Math.min(PPM, 320 / Math.max(w, h));
    items.push({ name: id, c: shoot(w, h, c.x, c.z, ppm), mw: w, mh: h, ox: c.x, oz: c.z });
    scene.remove(holder);
  }
  return pack(items, 2048);
}

window.bake = async () => {
  const chars = await bakeCharacters();
  const props = await bakeProps();
  return { chars, props };
};
window.ready = true;
