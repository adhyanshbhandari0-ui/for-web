/**
 * Heart rendering engine.
 *
 * Owns the WebGL2 renderer, a damped orbit camera with zoom-to-cursor, the
 * cardiac cycle animation, instanced blood and drug particles, layer and
 * condition state, label projection and picking.
 *
 * React never re-renders per frame: the engine exposes `latest` (a mutable
 * readout) that panels poll, and pushes labels, zoom and tier changes through
 * throttled callbacks.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import { anatomy, physiology } from "./data";
import { buildHeart, redCellGeometry, type HeartParts, type LayerId } from "./geometry";

export type Tier = 0 | 1 | 2 | 3;

export type LabelPlacement = {
  id: string;
  text: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  visible: boolean;
};

export type Readout = {
  hr: number;
  beatIndex: number;
  phase: string;
  phaseLabel: string;
  progress: number;
  seconds: number;
  lvVolume: number;
  lvPressure: number;
  aorticPressure: number;
  laPressure: number;
  raPressure: number;
  ejectionFraction: number;
  cardiacOutput: number;
  ecg: number;
  systole: number;
  diastole: number;
  valves: { mitral: number; aortic: number; tricuspid: number; pulmonary: number };
};

export type HeartEngineOptions = {
  canvas: HTMLCanvasElement;
  overlay?: HTMLCanvasElement | null;
  onPick?: (meshId: string | null) => void;
  onHover?: (meshId: string | null) => void;
  onLabels?: (labels: LabelPlacement[]) => void;
  onZoom?: (zoom: number, tier: Tier) => void;
  onTier?: (tier: Tier) => void;
  reducedMotion?: boolean;
  onCameraIdle?: () => void;
};

type ConditionId = string;

const BASE_RADIUS = 7.6;
const MIN_ZOOM = 1;
const MAX_ZOOM = 100;
const MAX_RADIUS = BASE_RADIUS / MIN_ZOOM;
const MIN_RADIUS = BASE_RADIUS / MAX_ZOOM;

const TIER_IDS: Record<Tier, string[]> = {
  0: ["heart", "right-atrium", "right-ventricle", "left-atrium", "left-ventricle", "aorta", "pulmonary-trunk"],
  1: [
    "right-atrium",
    "right-ventricle",
    "left-atrium",
    "left-ventricle",
    "aorta",
    "aortic-arch",
    "pulmonary-trunk",
    "pulmonary-veins",
    "superior-vena-cava",
    "inferior-vena-cava",
    "lad-artery",
    "circumflex-artery",
    "right-coronary-artery",
    "sa-node",
    "av-node",
  ],
  2: [
    "tricuspid-valve",
    "mitral-valve",
    "aortic-valve",
    "pulmonary-valve",
    "chordae-tendineae",
    "papillary-muscles",
    "interventricular-septum",
    "endocardium",
    "epicardial-fat",
    "fibrous-skeleton",
  ],
  3: [
    "cardiomyocyte",
    "sarcomere",
    "intercalated-discs",
    "t-tubules",
    "calcium-trigger",
    "endothelium",
    "blood",
  ],
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function phaseLookup(u: number) {
  const phases = physiology.cycle.phases;
  for (const phase of phases) {
    if (u >= phase.start && u < phase.end) return phase;
  }
  return phases[phases.length - 1];
}

export class HeartEngine {
  readonly parts: HeartParts;
  readonly readout: Readout;

  private canvas: HTMLCanvasElement;
  private overlay: HTMLCanvasElement | null;
  private options: HeartEngineOptions;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private clock = new THREE.Clock();
  private raf = 0;
  private disposed = false;

  private target = new THREE.Vector3(0, 0.15, 0);
  private desiredTarget = new THREE.Vector3(0, 0.15, 0);
  private theta = 0.42;
  private phi = 1.28;
  private radius = BASE_RADIUS;
  private desiredTheta = 0.42;
  private desiredPhi = 1.28;
  private desiredRadius = BASE_RADIUS;

  private pointers = new Map<number, { x: number; y: number }>();
  private dragMode: "none" | "rotate" | "pan" = "none";
  private pinchStart = 0;
  private lastX = 0;
  private lastY = 0;
  private moved = 0;

  private u = 0.08;
  private paused = false;
  private speed = 1;
  private hr = 68;
  private beatIndex = 0;
  private condition: ConditionId = "normal";
  private esvScale = 1;
  private edvScale = 1;
  private wallScale = 1;

  private bloodParticles: THREE.InstancedMesh | null = null;
  private drugParticles: THREE.InstancedMesh | null = null;
  private drugActive: string | null = null;
  private bloodT = 0;
  private drugT = 0;
  private particleState: { t: number; lane: number; speed: number }[] = [];

  private ghostMaterial: THREE.MeshStandardMaterial;
  private xray = false;
  private originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private layerOpacity: Record<LayerId, number> = {
    pericardium: 1,
    muscle: 1,
    valves: 1,
    arteries: 1,
    veins: 1,
    coronaries: 1,
    conduction: 1,
    blood: 1,
  };
  private clippingPlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0.35);
  private clippingOn = false;

  private labelIds: string[] = TIER_IDS[0];
  private labelAnchors = new Map<string, THREE.Vector3>();
  private lastLabelPush = 0;
  private lastZoomPush = 0;
  private tier: Tier = 0;

  private ride: { active: boolean; t: number } = { active: false, t: 0 };
  private fly: { active: boolean; elapsed: number; fromTarget: THREE.Vector3; fromRadius: number } = {
    active: false,
    elapsed: 0,
    fromTarget: new THREE.Vector3(),
    fromRadius: BASE_RADIUS,
  };

  private audio: AudioContext | null = null;
  private muted = true;
  private lastSoundGate = 0;
  private reducedMotion: boolean;

  constructor(options: HeartEngineOptions) {
    this.options = options;
    this.canvas = options.canvas;
    this.overlay = options.overlay ?? null;
    this.reducedMotion = options.reducedMotion ?? false;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.localClippingEnabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200);
    this.applyCamera(0, true);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new RoomEnvironment();
    const env = pmrem.fromScene(envScene, 0.06);
    this.scene.environment = env.texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff2ec, 2.4);
    key.position.set(4.2, 6.0, 5.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.0012;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x9fc6ff, 0.85);
    fill.position.set(-5, 1.5, 3);
    this.scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffb9a1, 1.5);
    rim.position.set(-2.5, -3.2, -5.5);
    this.scene.add(rim);

    this.scene.add(new THREE.AmbientLight(0x33415a, 0.9));

    this.parts = buildHeart(this.renderer);
    this.scene.add(this.parts.root);

    this.ghostMaterial = new THREE.MeshStandardMaterial({
      color: 0x8fd8ff,
      transparent: true,
      opacity: 0.16,
      roughness: 0.4,
      metalness: 0.1,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.buildParticles();
    this.cacheLabelAnchors();

    this.readout = {
      hr: this.hr,
      beatIndex: 0,
      phase: physiology.cycle.phases[0].id,
      phaseLabel: physiology.cycle.phases[0].label,
      progress: 0,
      seconds: 0,
      lvVolume: physiology.volumes.endDiastolicMl,
      lvPressure: physiology.pressures.lvDiastolic,
      aorticPressure: physiology.pressures.aorticDiastolic,
      laPressure: physiology.pressures.laMean,
      raPressure: physiology.pressures.raMean,
      ejectionFraction: physiology.volumes.ejectionFractionPct,
      cardiacOutput: 5,
      ecg: 0,
      systole: physiology.cycle.systoleSeconds,
      diastole: physiology.cycle.diastoleSeconds,
      valves: { mitral: 1, aortic: 0, tricuspid: 1, pulmonary: 0 },
    };

    this.setupComposer();
    this.bindEvents();
    this.resize();
    this.loop();
  }

  // --- public API --------------------------------------------------------

  get latest() {
    return this.readout;
  }

  get isPaused() {
    return this.paused;
  }

  get heartRate() {
    return this.hr;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  setSpeed(speed: number) {
    this.speed = clamp(speed, 0.1, 3);
  }

  setHeartRate(bpm: number) {
    this.hr = clamp(Math.round(bpm), 30, 200);
    this.condition = this.condition === "tachycardia" || this.condition === "bradycardia" ? "normal" : this.condition;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!muted && !this.audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.audio = new Ctor();
    }
    void this.audio?.resume();
  }

  setLayer(id: LayerId, opacity: number) {
    this.layerOpacity[id] = clamp(opacity, 0, 1);
    const group = this.parts.layers[id];
    group.visible = this.layerOpacity[id] > 0.015;
    group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (!material) return;
        const base = material.userData.baseOpacity ?? material.opacity ?? 1;
        material.userData.baseOpacity = base;
        material.transparent = true;
        material.opacity = base * this.layerOpacity[id];
        material.depthWrite = this.layerOpacity[id] > 0.55 && base > 0.5;
        material.needsUpdate = true;
      });
    });
  }

  setLabelsVisible(visible: boolean) {
    this.labelIds = visible ? TIER_IDS[this.tier] : [];
  }

  setXray(on: boolean) {
    if (this.xray === on) return;
    this.xray = on;
    this.parts.organ.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (on) {
        if (this.originalMaterials.has(mesh)) return;
        this.originalMaterials.set(mesh, mesh.material);
        mesh.material = this.ghostMaterial;
      } else {
        const original = this.originalMaterials.get(mesh);
        if (original) mesh.material = original;
        this.originalMaterials.delete(mesh);
      }
    });
  }

  setExploded(amount: number) {
    const a = clamp(amount, 0, 1);
    this.parts.layers.pericardium.position.set(0, a * 0.9, a * 1.5);
    this.parts.layers.valves.position.set(a * 0.25, 0, a * 0.3);
    this.parts.layers.coronaries.position.set(0, 0, a * 0.5);
    this.parts.layers.conduction.position.set(0, 0, a * 0.2);
    this.parts.layers.veins.position.set(-a * 0.25, 0, 0);
    this.parts.layers.arteries.position.set(a * 0.25, 0, 0);
  }

  setClipping(on: boolean) {
    this.clippingOn = on;
    const planes = on ? [this.clippingPlane] : [];
    this.parts.organ.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => {
        if (!material) return;
        material.clippingPlanes = planes;
        material.clipShadows = true;
        material.needsUpdate = true;
      });
    });
  }

  setClippingOffset(offset: number) {
    this.clippingPlane.constant = clamp(offset, -2.4, 2.4);
  }

  setCondition(id: ConditionId) {
    this.condition = id;
    const parts = this.parts;
    parts.ischaemiaPatch.visible = id === "ischaemia";
    parts.plaque.visible = id === "plaque";
    parts.shuntJet.visible = id === "septal-defect";

    this.esvScale = 1;
    this.edvScale = 1;
    this.wallScale = 1;

    if (id === "heart-failure") {
      this.esvScale = 1.75;
      this.edvScale = 1.35;
    } else if (id === "hypertrophy") {
      this.wallScale = 1.32;
      this.edvScale = 0.86;
      this.esvScale = 0.9;
    } else if (id === "ischaemia") {
      this.esvScale = 1.25;
    } else if (id === "tachycardia") {
      this.hr = 148;
    } else if (id === "bradycardia") {
      this.hr = 46;
    } else if (id === "heart-block") {
      this.hr = 48;
    }

    if (id === "normal" || id === "plaque" || id === "afib" || id === "stenosis" || id === "regurgitation" || id === "septal-defect" || id === "heart-failure" || id === "hypertrophy" || id === "ischaemia") {
      if (this.hr > 145 || this.hr < 50) this.hr = 68;
    }
  }

  setDrug(id: string | null) {
    this.drugActive = id;
    if (this.drugParticles) this.drugParticles.visible = Boolean(id);
    if (id) this.drugT = 0;
  }

  setZoom(multiplier: number) {
    this.desiredRadius = clamp(BASE_RADIUS / clamp(multiplier, MIN_ZOOM, MAX_ZOOM), MIN_RADIUS, MAX_RADIUS);
  }

  zoomBy(factor: number) {
    this.desiredRadius = clamp(this.desiredRadius * factor, MIN_RADIUS, MAX_RADIUS);
  }

  reset() {
    this.desiredTarget.set(0, 0.15, 0);
    this.desiredTheta = 0.42;
    this.desiredPhi = 1.28;
    this.desiredRadius = BASE_RADIUS;
    this.ride.active = false;
    this.options.onCameraIdle?.();
  }

  focus(meshId: string) {
    const object = this.parts.byMesh.get(meshId);
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    const distance = clamp(size * 2.1, 0.45, BASE_RADIUS * 0.92);
    this.fly.active = true;
    this.fly.elapsed = 0;
    this.fly.fromTarget.copy(this.desiredTarget);
    this.fly.fromRadius = this.desiredRadius;
    this.desiredTarget.copy(centre);
    this.desiredRadius = distance;
  }

  rideBlood() {
    this.ride.active = true;
    this.ride.t = 0;
  }

  stepPhase(direction: 1 | -1) {
    const phases = physiology.cycle.phases;
    const current = phaseLookup(this.u);
    const index = phases.findIndex((phase) => phase.id === current.id);
    const nextIndex = clamp(index + direction, 0, phases.length - 1);
    this.u = phases[nextIndex].start + 0.001;
    this.paused = true;
    this.applyCycle(0);
  }

  pickAt(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(pointer, this.camera);
    const hits = raycaster.intersectObjects(this.parts.organ.children, true);
    for (const hit of hits) {
      let node: THREE.Object3D | null = hit.object;
      while (node && !node.userData.meshId) node = node.parent;
      const id = node?.userData.meshId as string | undefined;
      if (id) return id;
    }
    return null;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? this.canvas.clientWidth ?? 1;
    const height = parent?.clientHeight ?? this.canvas.clientHeight ?? 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(width, height);
    if (this.overlay) {
      this.overlay.width = Math.round(width * dpr);
      this.overlay.height = Math.round(height * dpr);
      this.overlay.style.width = `${width}px`;
      this.overlay.style.height = `${height}px`;
      this.overlayCtx = this.overlay.getContext("2d");
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.unbindEvents();
    this.parts.dispose();
    this.bloodParticles?.geometry.dispose();
    this.bloodParticles?.dispose();
    this.drugParticles?.geometry.dispose();
    this.drugParticles?.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
    this.scene.environment?.dispose();
    void this.audio?.close();
  }

  // --- setup -------------------------------------------------------------

  private setupComposer() {
    try {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.32, 0.75, 0.86);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      // Multisampled targets give MSAA edge quality without a separate SMAA pass.
      composer.renderTarget1.samples = 4;
      composer.renderTarget2.samples = 4;
      this.composer = composer;
    } catch {
      this.composer = null;
    }
  }

  private buildParticles() {
    const geometry = redCellGeometry();
    const material = new THREE.MeshStandardMaterial({
      roughness: 0.32,
      metalness: 0.05,
      vertexColors: false,
    });
    const count = 540;
    const blood = new THREE.InstancedMesh(geometry, material, count);
    blood.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    blood.frustumCulled = false;
    this.parts.layers.blood.add(blood);
    this.bloodParticles = blood;

    const drugMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb04a,
      emissive: new THREE.Color(0xff8a1f),
      emissiveIntensity: 1.1,
      roughness: 0.3,
    });
    const drug = new THREE.InstancedMesh(geometry.clone(), drugMaterial, 120);
    drug.frustumCulled = false;
    drug.visible = false;
    this.parts.layers.blood.add(drug);
    this.drugParticles = drug;

    this.particleState = Array.from({ length: count }, () => ({
      t: Math.random(),
      lane: Math.random() * 2 - 1,
      speed: 0.85 + Math.random() * 0.35,
    }));

    const rich = new THREE.Color("#e2493b");
    const poor = new THREE.Color("#4a5fa8");
    for (let i = 0; i < count; i += 1) {
      const t = this.particleState[i].t;
      const colour = t < 0.5 ? poor : rich;
      blood.instanceColor!.setXYZ(i, colour.r, colour.g, colour.b);
    }
    blood.instanceColor!.needsUpdate = true;
  }

  private cacheLabelAnchors() {
    for (const item of anatomy.items) {
      const object = this.parts.byMesh.get(item.mesh);
      if (!object) continue;
      const box = new THREE.Box3().setFromObject(object);
      if (box.isEmpty()) continue;
      this.labelAnchors.set(item.id, box.getCenter(new THREE.Vector3()));
    }
  }

  // --- input -------------------------------------------------------------

  private bindEvents() {
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerUp);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("resize", this.onResize);
    this.onResize();
  }

  private unbindEvents() {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerUp);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("resize", this.onResize);
  }

  private onResize = () => {
    this.resize();
  };

  private onContextMenu = (event: Event) => {
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent) => {
    this.canvas.setPointerCapture?.(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.moved = 0;
    this.ride.active = false;
    if (event.button === 2 || event.shiftKey) this.dragMode = "pan";
    else this.dragMode = "rotate";
    if (this.pointers.size === 2) {
      const [a, b] = Array.from(this.pointers.values());
      this.pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
      this.dragMode = "pan";
    }
    event.preventDefault();
  };

  private onPointerMove = (event: PointerEvent) => {
    if (!this.pointers.has(event.pointerId)) {
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size >= 2) {
      const [a, b] = Array.from(this.pointers.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchStart > 0) {
        this.desiredRadius = clamp(
          this.desiredRadius * (this.pinchStart / Math.max(12, distance)),
          MIN_RADIUS,
          MAX_RADIUS,
        );
      }
      this.pinchStart = distance;
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      this.panBy(midX - this.lastX, midY - this.lastY);
      this.lastX = midX;
      this.lastY = midY;
      return;
    }

    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.moved += Math.abs(dx) + Math.abs(dy);

    if (this.dragMode === "pan") {
      this.panBy(dx, dy);
    } else if (this.dragMode === "rotate") {
      this.desiredTheta -= dx * 0.0062;
      this.desiredPhi = clamp(this.desiredPhi - dy * 0.0055, 0.28, 2.86);
    }
  };

  private onPointerUp = (event: PointerEvent) => {
    const wasDragging = this.dragMode !== "none";
    this.dragMode = "none";
    this.pointers.delete(event.pointerId);
    this.pinchStart = this.pointers.size > 0 ? this.pinchStart : 0;
    if (wasDragging && this.moved < 7) {
      const id = this.pickAt(event.clientX, event.clientY);
      this.options.onPick?.(id);
    }
    if (this.moved >= 7) this.options.onCameraIdle?.();
  };

  private onWheel = (event: WheelEvent) => {
    event.preventDefault();
    this.ride.active = false;
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const delta = event.deltaY * scale;
    const factor = Math.exp(clamp(delta, -240, 240) * 0.0016);

    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const planePoint = this.target.clone();
    const normal = this.camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(-1);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint);
    const hit = new THREE.Vector3();
    const intersects = raycaster.ray.intersectPlane(plane, hit);

    const nextRadius = clamp(this.desiredRadius * factor, MIN_RADIUS, MAX_RADIUS);
    if (intersects && this.pointers.size === 0) {
      const ratio = 1 - nextRadius / this.desiredRadius;
      this.desiredTarget.addScaledVector(hit.clone().sub(this.desiredTarget), ratio * 0.85);
      this.desiredTarget.clamp(new THREE.Vector3(-2.4, -3.0, -2.4), new THREE.Vector3(2.4, 3.0, 2.4));
    }
    this.desiredRadius = nextRadius;
  };

  private panBy(dx: number, dy: number) {
    const scale = this.desiredRadius * 0.0016;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.desiredTarget.addScaledVector(right, -dx * scale);
    this.desiredTarget.addScaledVector(up, dy * scale);
    this.desiredTarget.clamp(new THREE.Vector3(-2.4, -3.0, -2.4), new THREE.Vector3(2.4, 3.0, 2.4));
  }

  // --- frame -------------------------------------------------------------

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.updateCamera(delta);
    this.updateCycle(delta);
    this.updateParticles(delta);
    this.updateLabels();
    this.render();
  };

  private updateCamera(delta: number) {
    if (this.ride.active) {
      this.ride.t = (this.ride.t + delta * 0.045) % 1;
      const point = this.parts.bloodLoop.getPointAt(this.ride.t);
      const ahead = this.parts.bloodLoop.getPointAt((this.ride.t + 0.01) % 1);
      const tangent = ahead.clone().sub(point).normalize();
      const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const offset = side.multiplyScalar(0.34).add(new THREE.Vector3(0, 0.12, 0));
      this.camera.position.copy(point).add(offset);
      this.camera.lookAt(ahead.add(offset));
      this.camera.near = 0.02;
      this.camera.far = 60;
      this.camera.updateProjectionMatrix();
      return;
    }

    const damping = this.reducedMotion ? 1 : 1 - Math.exp(-delta * 9);

    if (this.fly.active) {
      this.fly.elapsed += delta;
      const k = clamp(this.fly.elapsed / 0.85, 0, 1);
      const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      this.desiredRadius = lerpNumber(this.fly.fromRadius, this.desiredRadius, ease);
      if (k >= 1) this.fly.active = false;
    }

    this.theta += (this.desiredTheta - this.theta) * damping;
    this.phi += (this.desiredPhi - this.phi) * damping;
    this.radius += (this.desiredRadius - this.radius) * damping;
    this.target.lerp(this.desiredTarget, damping);

    this.applyCamera(delta);
  }

  private applyCamera(_delta: number, immediate = false) {
    const sinPhi = Math.sin(this.phi);
    const x = this.radius * sinPhi * Math.sin(this.theta);
    const y = this.radius * Math.cos(this.phi);
    const z = this.radius * sinPhi * Math.cos(this.theta);
    this.camera.position.set(this.target.x + x, this.target.y + y, this.target.z + z);
    this.camera.lookAt(this.target);

    this.camera.near = clamp(this.radius * 0.012, 0.008, 1.2);
    this.camera.far = clamp(this.radius * 26, 24, 320);
    this.camera.updateProjectionMatrix();

    if (immediate) return;

    const zoom = BASE_RADIUS / this.radius;
    const nextTier: Tier = zoom > 13 ? 3 : zoom > 4.4 ? 2 : zoom > 1.7 ? 1 : 0;
    if (nextTier !== this.tier) {
      this.tier = nextTier;
      this.labelIds = this.labelIds.length > 0 ? TIER_IDS[nextTier] : [];
      this.options.onTier?.(nextTier);
      this.parts.cellular.visible = nextTier === 3;
      this.parts.organ.visible = nextTier !== 3;
    }

    const now = performance.now();
    if (now - this.lastZoomPush > 90) {
      this.lastZoomPush = now;
      this.options.onZoom?.(zoom, this.tier);
    }
  }

  private updateCycle(delta: number) {
    const beatSeconds = 60 / this.hr;
    const systole = clamp(0.33 - (this.hr - 68) * 0.0008, 0.16, 0.42);
    const diastole = Math.max(0.12, beatSeconds - systole);

    if (!this.paused) {
      const advance = (delta / beatSeconds) * this.speed;
      const before = this.u;
      this.u += advance;
      if (this.u >= 1) {
        this.u -= 1;
        this.beatIndex += 1;
      }
      this.maybePlaySounds(before, this.u);
    }
    this.applyCycle(delta);

    const lvVolume = this.readout.lvVolume;
    const co = (lvVolume * this.hr) / 1000;
    this.readout.hr = this.hr;
    this.readout.beatIndex = this.beatIndex;
    this.readout.cardiacOutput = Number(co.toFixed(2));
    this.readout.systole = Number(systole.toFixed(2));
    this.readout.diastole = Number(diastole.toFixed(2));
    this.readout.seconds = Number((this.u * beatSeconds).toFixed(2));
  }

  private maybePlaySounds(before: number, after: number) {
    if (this.muted || !this.audio) return;
    const sounds = physiology.cycle.sounds;
    for (const sound of sounds) {
      const crossed = before <= sound.at && after >= sound.at && before < after;
      if (crossed && this.lastSoundGate < this.beatIndex + sound.at) {
        const first = sound.id.toLowerCase() === "s1";
        this.playThump(first ? 78 : 132, first ? 0.24 : 0.16);
        this.lastSoundGate = this.beatIndex + sound.at;
      }
    }
  }

  private playThump(frequency: number, duration: number) {
    if (!this.audio) return;
    const now = this.audio.currentTime;
    const oscillator = this.audio.createOscillator();
    const gain = this.audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.62, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.24, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.audio.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private applyCycle(_delta: number) {
    const u = this.u;
    const phase = phaseLookup(u);

    const edv = physiology.volumes.endDiastolicMl * this.edvScale;
    const esv = physiology.volumes.endSystolicMl * this.esvScale;

    const atrialSqueeze = smoothstep(0.02, 0.1, u) * (1 - smoothstep(0.1, 0.15, u));
    const ejection = smoothstep(0.16, 0.23, u) * (1 - smoothstep(0.38, 0.44, u));
    const filling = smoothstep(0.46, 0.68, u);

    let volume = esv + (edv - esv) * filling;
    if (u < 0.13) volume = edv * (0.9 + 0.1 * smoothstep(0.02, 0.12, u));
    if (u >= 0.13 && u < 0.17) volume = edv;
    if (u >= 0.17 && u < 0.44) {
      const k = smoothstep(0.17, 0.43, u);
      volume = edv + (esv - edv) * k;
    }
    if (u >= 0.44 && u < 0.47) volume = esv;

    const contractility = 1 / this.esvScale;
    const lvPressureDiastole = physiology.pressures.lvDiastolic;
    const lvPressureSystole = physiology.pressures.lvSystolic * (0.7 + 0.3 * contractility);
    let lvPressure = lvPressureDiastole + 2 * filling;
    if (u >= 0.12 && u < 0.17) {
      lvPressure = lerpNumber(lvPressureDiastole, lvPressureSystole * 0.86, smoothstep(0.12, 0.17, u));
    } else if (u >= 0.17 && u < 0.44) {
      const k = smoothstep(0.17, 0.3, u) * (1 - smoothstep(0.34, 0.44, u));
      lvPressure = lerpNumber(lvPressureSystole * 0.9, lvPressureSystole, k);
    } else if (u >= 0.44 && u < 0.52) {
      lvPressure = lerpNumber(lvPressureSystole * 0.9, lvPressureDiastole, smoothstep(0.44, 0.52, u));
    }

    const aorticSystolic = physiology.pressures.aorticSystolic;
    const aorticDiastolic = physiology.pressures.aorticDiastolic;
    let aorticPressure = aorticDiastolic + 3 * smoothstep(0.46, 0.95, u);
    if (u >= 0.16 && u < 0.44) {
      aorticPressure = lerpNumber(aorticSystolic * 0.92, aorticSystolic, smoothstep(0.17, 0.26, u));
      if (u > 0.4) aorticPressure = lerpNumber(aorticSystolic, aorticSystolic * 0.94, smoothstep(0.4, 0.44, u));
    } else if (u >= 0.44 && u < 0.6) {
      aorticPressure = lerpNumber(aorticSystolic * 0.94, aorticDiastolic, smoothstep(0.44, 0.6, u));
    }

    const laPressure = physiology.pressures.laMean + 4 * atrialSqueeze + 3 * (1 - filling) * 0.4;
    const raPressure = physiology.pressures.raMean + 2 * atrialSqueeze;

    const mitralOpen = clamp(
      Math.max(
        smoothstep(0.44, 0.5, u) * (1 - smoothstep(0.14, 0.2, u)),
        u > 0.98 ? 1 : 0,
      ),
      0,
      1,
    );
    const aorticOpen = clamp(smoothstep(0.16, 0.2, u) * (1 - smoothstep(0.4, 0.45, u)), 0, 1);
    const tricuspidOpen = clamp(
      Math.max(smoothstep(0.45, 0.52, u) * (1 - smoothstep(0.13, 0.19, u)), u > 0.98 ? 1 : 0),
      0,
      1,
    );
    const pulmonaryOpen = clamp(smoothstep(0.17, 0.22, u) * (1 - smoothstep(0.4, 0.46, u)), 0, 1);

    const stenosed = this.condition === "stenosis";
    const leaky = this.condition === "regurgitation";
    const aorticGain = stenosed ? 0.55 : 1;
    const mitralLeak = leaky ? 0.35 : 0;

    // The panels must report what the meshes actually show, so each valve's
    // displayed opening is computed once and reused for mesh and readout.
    const mitralShown = Math.max(mitralOpen * (1 - mitralLeak), mitralLeak * ejection);
    const aorticShown = aorticOpen * aorticGain;

    this.parts.valves.mitral.setOpen(mitralShown);
    this.parts.valves.tricuspid.setOpen(tricuspidOpen);
    this.parts.valves.aortic.setOpen(aorticShown);
    this.parts.valves.pulmonary.setOpen(pulmonaryOpen);

    const atriumScale = 1 - 0.13 * atrialSqueeze;
    const stretch = this.condition === "heart-failure" ? 1.08 : 1;
    const wall = this.wallScale * (this.condition === "heart-failure" ? 0.92 : 1);

    this.parts.chamberGroups.rightAtrium.scale.setScalar(atriumScale);
    this.parts.chamberGroups.leftAtrium.scale.setScalar(atriumScale * 0.98);

    const ventSqueeze = ejection;
    const shortness = 1 - 0.16 * ventSqueeze;
    const bulge = 1 + 0.09 * ventSqueeze;
    const twist = this.reducedMotion ? 0 : 0.1 * ventSqueeze;

    this.parts.chamberGroups.leftVentricle.scale.set(
      bulge * stretch * wall,
      shortness,
      bulge * stretch * wall,
    );
    this.parts.chamberGroups.leftVentricle.rotation.y = twist;
    this.parts.chamberGroups.rightVentricle.scale.set(
      bulge * 0.9,
      shortness * 0.96,
      bulge * 0.95,
    );
    this.parts.chamberGroups.rightVentricle.rotation.y = -twist * 0.6;

    const pulse = 0.012 + 0.05 * smoothstep(0.16, 0.26, u) * (1 - smoothstep(0.5, 0.8, u));
    this.parts.pulseTargets.forEach((mesh) => {
      mesh.scale.setScalar(1 + pulse);
    });

    const ecg = this.ecgValue(u, this.condition === "afib");
    const ejectionFraction = ((edv - esv) / edv) * 100;

    this.readout.phase = phase.id;
    this.readout.phaseLabel = phase.label;
    this.readout.progress = u;
    this.readout.lvVolume = Math.round(volume);
    this.readout.lvPressure = Math.round(lvPressure);
    this.readout.aorticPressure = Math.round(aorticPressure);
    this.readout.laPressure = Math.round(laPressure);
    this.readout.raPressure = Math.round(raPressure);
    this.readout.ejectionFraction = Math.round(ejectionFraction);
    this.readout.ecg = ecg;
    this.readout.valves = {
      mitral: mitralShown,
      aortic: aorticShown,
      tricuspid: tricuspidOpen,
      pulmonary: pulmonaryOpen,
    };

    this.animateConduction(u);
  }

  private ecgValue(u: number, irregular: boolean) {
    const p = 0.06;
    const qrs = 0.15;
    const t = 0.36;
    let value = 0;
    if (!irregular) {
      value += 0.22 * Math.exp(-((u - p) ** 2) / (2 * 0.006 ** 2));
    }
    value += -0.16 * Math.exp(-((u - (qrs - 0.018)) ** 2) / (2 * 0.0035 ** 2));
    value += 1.0 * Math.exp(-((u - qrs) ** 2) / (2 * 0.004 ** 2));
    value += -0.28 * Math.exp(-((u - (qrs + 0.02)) ** 2) / (2 * 0.005 ** 2));
    value += 0.32 * Math.exp(-((u - t) ** 2) / (2 * 0.02 ** 2));
    return value;
  }

  private animateConduction(u: number) {
    const conduction = this.parts.layers.conduction;
    const travel = (u * 1.4) % 1;
    conduction.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material?.emissive) return;
      const distance = mesh.position.length() / 3.4;
      const wave = Math.exp(-(((travel - distance) % 1) ** 2) / 0.02);
      material.emissiveIntensity = 0.35 + wave * 1.6;
    });
  }

  private updateParticles(delta: number) {
    const ejection = smoothstep(0.16, 0.24, this.u) * (1 - smoothstep(0.38, 0.46, this.u));
    const filling = smoothstep(0.46, 0.6, this.u) * (1 - smoothstep(0.92, 1.0, this.u));
    const baseSpeed = 0.018 + ejection * 0.16 + filling * 0.05;

    const dummy = new THREE.Object3D();
    const blood = this.bloodParticles;
    if (blood) {
      const rich = new THREE.Color("#e2493b");
      const poor = new THREE.Color("#4a5fa8");
      const colour = new THREE.Color();
      for (let i = 0; i < this.particleState.length; i += 1) {
        const state = this.particleState[i];
        state.t = (state.t + baseSpeed * state.speed * delta * 8) % 1;
        const point = this.parts.bloodLoop.getPointAt(state.t);
        const tangent = this.parts.bloodLoop.getTangentAt(state.t);
        const side = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
        const offset = side.multiplyScalar(state.lane * 0.11).addScaledVector(tangent, 0);
        dummy.position.copy(point).add(offset);
        dummy.rotation.set(state.t * 12, state.t * 9, state.t * 6);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        blood.setMatrixAt(i, dummy.matrix);
        const oxygenRich = state.t > 0.48 && state.t < 0.9;
        colour.copy(oxygenRich ? rich : poor);
        blood.instanceColor!.setXYZ(i, colour.r, colour.g, colour.b);
      }
      blood.instanceMatrix.needsUpdate = true;
      blood.instanceColor!.needsUpdate = true;
    }

    const drug = this.drugParticles;
    if (drug && this.drugActive) {
      const count = drug.count;
      for (let i = 0; i < count; i += 1) {
        const t = (this.drugT + i / count) % 1;
        const point = this.parts.drugLoop.getPointAt(t);
        dummy.position.copy(point);
        dummy.rotation.set(t * 8, t * 6, 0);
        dummy.scale.setScalar(1.25);
        dummy.updateMatrix();
        drug.setMatrixAt(i, dummy.matrix);
      }
      drug.instanceMatrix.needsUpdate = true;
      this.drugT = (this.drugT + delta * 0.045) % 1;
    }
  }

  private updateLabels() {
    const now = performance.now();
    if (now - this.lastLabelPush < 110) {
      return;
    }
    this.lastLabelPush = now;

    if (this.labelIds.length === 0 || !this.overlay) {
      this.drawLeaderLines([]);
      this.options.onLabels?.([]);
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const placements: LabelPlacement[] = [];
    const centreX = rect.width / 2;
    const centreY = rect.height / 2;

    for (const id of this.labelIds) {
      const anchor = this.labelAnchors.get(id);
      const item = anatomy.items.find((entry) => entry.id === id);
      if (!anchor || !item) continue;
      const projected = anchor.clone().project(this.camera);
      if (projected.z > 1) continue;
      const x = (projected.x * 0.5 + 0.5) * rect.width;
      const y = (-projected.y * 0.5 + 0.5) * rect.height;
      if (x < -80 || y < -80 || x > rect.width + 80 || y > rect.height + 80) continue;
      const dirX = x - centreX;
      const dirY = y - centreY;
      const length = Math.hypot(dirX, dirY) || 1;
      const distance = clamp(46 + this.radius * 5, 46, 104);
      const tx = x + (dirX / length) * distance;
      const ty = y + (dirY / length) * distance;
      placements.push({ id, text: item.name, x, y, tx, ty, visible: true });
    }

    this.drawLeaderLines(placements);
    this.options.onLabels?.(placements);
  }

  private drawLeaderLines(placements: LabelPlacement[]) {
    const ctx = this.overlayCtx;
    if (!ctx || !this.overlay) return;
    const dpr = this.overlay.width / (this.overlay.clientWidth || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (placements.length === 0) return;
    ctx.strokeStyle = "rgba(162, 236, 249, 0.55)";
    ctx.fillStyle = "rgba(162, 236, 249, 0.9)";
    ctx.lineWidth = 1;
    ctx.font = "500 11px ui-sans-serif, system-ui, sans-serif";
    for (const placement of placements) {
      ctx.beginPath();
      ctx.moveTo(placement.x, placement.y);
      ctx.lineTo(placement.tx, placement.ty);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(placement.x, placement.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
    if (this.composer) {
      this.composer.render();
    }
  }
}

function lerpNumber(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
