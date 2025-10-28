import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { AnaglyphEffect } from 'three/addons/effects/AnaglyphEffect.js';

/* ---------- RUTAS Y CONFIG ---------- */
const MODEL_PATH = 'models/fbx/Paladin_WProp_J_Nordstrom.fbx';
const ANIM_FILES = [
  { key: 'protege',  file: 'models/fbx/Boxing.fbx' },
  { key: 'espadazo',  file: 'models/fbx/Double_Dagger_Stab.fbx' },
  { key: 'patada',   file: 'models/fbx/Martelo_2.fbx' },
  { key: 'defensa',  file: 'models/fbx/Punching.fbx' },
  { key: 'correr', file: 'models/fbx/Fast_Run.fbx' }
];

const MODEL_SCALE  = 0.012;

// Cámara más cerca y FOV un poco mayor para aumentar parallax
const CAM_FOV   = 55;
const CAM_START = new THREE.Vector3(1.6, 1.45, 2.0);

// “Profundidad 3D” controlada con el slider (z del muñeco)
const DEPTH_MIN      = -1.60;   // más cerca de la cámara
const DEPTH_MAX      = -0.20;   // más lejos
const DEPTH_DEFAULT  = -1.00;

/* ---------- DOM ---------- */
const viewer = document.getElementById('viewer');
const animSelect = document.getElementById('animSelect');
const eyeSep = document.getElementById('eyeSep');       // slider (lo usamos como profundidad 3D)
const eyeSepVal = document.getElementById('eyeSepVal');
const rotateModelSwitch = document.getElementById('rotateModelSwitch');

/* ---------- GLOBALES ---------- */
let scene, camera, renderer, effect, controls, clock;
let mixer, character;
const actions = {};
let currentAction = null;

let draggingRotate = false;   // arrastre para rotar modelo
let lastX = 0;

/* ---------- INIT ---------- */
init();
animate();

async function init(){
  clock = new THREE.Clock();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f1a);

  camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.01, 100);
  camera.position.copy(CAM_START);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMappingExposure = 1.35; // un toque más brillante para contornos
  viewer.appendChild(renderer.domElement);

  // ANAGLYPH GLOBAL
  effect = new AnaglyphEffect(renderer);
  effect.setSize(viewer.clientWidth, viewer.clientHeight);

  /* Luces con contraste para perfilar rojo/cian */
  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.2);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.45);
  dir.position.set(-5, 10, -3);
  scene.add(dir);
  const rim = new THREE.DirectionalLight(0xffe8d8, 1.1);
  rim.position.set(3, 6, 6);
  scene.add(rim);

  /* Piso + Grid visibles */
  const grid = new THREE.GridHelper(60, 60, 0x9fb3c7, 0x3b5064);
  grid.material.transparent = true;
  grid.material.opacity = 0.9;
  scene.add(grid);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshStandardMaterial({ color: 0x101522, roughness: 1 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.position.y = -0.001;
  scene.add(ground);

  /* OrbitControls – SIEMPRE habilitado para orbitar */
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.1, 0);
  controls.enableDamping = true;

  /* Modelo y animaciones */
  await loadCharacter();
  await loadAnimations();

  /* UI */
  window.addEventListener('resize', onResize);
  onResize();

  window.addEventListener('keydown', (e)=>{
    const map = { '1':'protege', '2':'espadazo', '3':'patada', '4':'defensa', '5':'correr' };
    if (map[e.key]) { animSelect && (animSelect.value = map[e.key]); play(map[e.key]); }
  });

  animSelect && animSelect.addEventListener('change', (e)=> play(e.target.value));

  // Slider: mapeamos 0.04–0.18 a DEPTH_MIN–DEPTH_MAX
  if (eyeSep) {
    if (eyeSepVal) eyeSepVal.textContent = parseFloat(eyeSep.value).toFixed(3);
    applyDepthFromSlider();
    eyeSep.addEventListener('input', ()=>{
      eyeSepVal && (eyeSepVal.textContent = parseFloat(eyeSep.value).toFixed(3));
      applyDepthFromSlider();
    });
  }

  // Rotar modelo: mantén SHIFT mientras arrastras (o activa el switch)
  viewer.addEventListener('pointerdown', (ev)=>{
    const wantRotate = (rotateModelSwitch && rotateModelSwitch.checked) || ev.shiftKey;
    if (wantRotate) {
      draggingRotate = true;
      lastX = ev.clientX;
    }
  });
  window.addEventListener('pointerup', ()=> draggingRotate = false);
  window.addEventListener('pointermove', (ev)=>{
    if (!draggingRotate || !character) return;
    const dx = ev.clientX - lastX;
    lastX = ev.clientX;
    character.rotation.y -= dx * 0.01;
  });
}

async function loadCharacter(){
  const loader = new FBXLoader();
  const obj = await new Promise((resolve, reject)=>{
    loader.load(MODEL_PATH, resolve, undefined, reject);
  });

  obj.scale.setScalar(MODEL_SCALE);

  obj.traverse(o=>{
    if (o.isMesh && o.material){
      if (o.material.isMeshStandardMaterial){
        o.material.color.set(0xffffff);
        o.material.metalness = 0.05;
        o.material.roughness = 0.5;
        o.material.emissive = new THREE.Color(0x202020);
        o.material.emissiveIntensity = 1.0; // resalta contornos rojo/cian
      }
      o.material.needsUpdate = true;
    }
  });

  obj.position.set(0, 0.0, DEPTH_DEFAULT); // se ajusta con el slider
  scene.add(obj);

  character = obj;
  mixer = new THREE.AnimationMixer(character);
}

async function loadAnimations(){
  const loader = new FBXLoader();
  for (const a of ANIM_FILES){
    try{
      const animObj = await new Promise((resolve, reject)=> loader.load(a.file, resolve, undefined, reject));
      const clip = animObj.animations && animObj.animations[0];
      if (!clip) continue;
      const action = mixer.clipAction(clip);
      action.enabled = true;
      action.loop = THREE.LoopRepeat;
      actions[a.key] = action;
    }catch(err){
      console.warn('No se pudo cargar animación:', a.file, err);
    }
  }
  if (actions.idle){ play('idle'); }
  else {
    const firstKey = Object.keys(actions)[0];
    if (firstKey) play(firstKey);
  }
}

function play(key){
  const next = actions[key];
  if (!next || next === currentAction) return;
  const fade = 0.25;
  next.reset().play();
  if (currentAction) currentAction.crossFadeTo(next, fade, false);
  currentAction = next;
}

function onResize(){
  const w = viewer.clientWidth, h = viewer.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  effect.setSize(w, h);
}

function animate(){
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  controls.update();          // orbitar siempre disponible
  mixer && mixer.update(dt);
  effect.render(scene, camera); // anaglifo global
}

/* ---------- Helpers ---------- */
// Mapea 0.04–0.18 a DEPTH_MIN–DEPTH_MAX y posiciona el modelo
function applyDepthFromSlider(){
  if (!character || !eyeSep) return;
  const t = (parseFloat(eyeSep.value) - 0.04) / (0.18 - 0.04); // 0..1
  const z = THREE.MathUtils.lerp(DEPTH_MIN, DEPTH_MAX, t);
  character.position.z = z;
}
