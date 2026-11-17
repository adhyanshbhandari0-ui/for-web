/**
 * Procedural anatomy for the heart simulator.
 *
 * The BodyParts3D body model in `public/models` merges every heart structure
 * into a single mesh, which is useless for selecting a valve or peeling a
 * layer. This module builds the heart from scratch instead: swept chambers,
 * tapered great vessels, hinged valve leaflets, coronary trees that follow the
 * grooves, a conduction pathway and a cellular close-up.
 *
 * Conventions
 * - Units are arbitrary but consistent: the heart is about 4.6 units tall.
 * - +Y is up, +Z is anterior (towards the viewer), +X is the patient's left.
 *   An anterior camera therefore sees the right atrium on the left of screen.
 * - Every mesh is registered in `byMesh` under the id used by `anatomy.json`,
 *   so labels, info cards and the layer panel all speak the same names.
 */

import * as THREE from "three";

export type LayerId =
  | "pericardium"
  | "muscle"
  | "valves"
  | "arteries"
  | "veins"
  | "coronaries"
  | "conduction"
  | "blood";

export type ValveRig = {
  id: string;
  group: THREE.Group;
  leaflets: THREE.Group[];
  setOpen: (open: number) => void;
  setThickness: (factor: number) => void;
};

export type HeartParts = {
  root: THREE.Group;
  organ: THREE.Group;
  cellular: THREE.Group;
  layers: Record<LayerId, THREE.Group>;
  byMesh: Map<string, THREE.Object3D>;
  valves: Record<"tricuspid" | "pulmonary" | "mitral" | "aortic", ValveRig>;
  chamberGroups: {
    rightAtrium: THREE.Group;
    rightVentricle: THREE.Group;
    leftAtrium: THREE.Group;
    leftVentricle: THREE.Group;
  };
  pulseTargets: THREE.Mesh[];
  bloodLoop: THREE.CatmullRomCurve3;
  drugLoop: THREE.CatmullRomCurve3;
  conductionPath: THREE.CatmullRomCurve3[];
  ischaemiaPatch: THREE.Mesh;
  plaque: THREE.Mesh;
  shuntJet: THREE.Mesh;
  dispose: () => void;
};

const PALETTE = {
  muscle: 0xa63a3f,
  muscleDeep: 0x7c2a2f,
  cavity: 0x4a1216,
  endocardium: 0xe8b9b4,
  fat: 0xd9b968,
  artery: 0xcf3f38,
  arteryBright: 0xe8624f,
  vein: 0x4a6fb5,
  veinDark: 0x3f5f9e,
  valve: 0xe8dcc8,
  cord: 0xf0e6d2,
  conduction: 0xf0c85a,
  purkinje: 0xf7e3a3,
  pericardium: 0x9fd8e3,
};

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type ProfileKey = { t: number; rx: number; ry: number };

function sampleProfile(profile: ProfileKey[], t: number) {
  if (t <= profile[0].t) return profile[0];
  const last = profile[profile.length - 1];
  if (t >= last.t) return last;
  for (let i = 1; i < profile.length; i += 1) {
    const a = profile[i - 1];
    const b = profile[i];
    if (t <= b.t) {
      const span = b.t - a.t || 1;
      const k = (t - a.t) / span;
      return {
        t,
        rx: lerp(a.rx, b.rx, k),
        ry: lerp(a.ry, b.ry, k),
      };
    }
  }
  return last;
}

/**
 * Sweep an elliptical cross-section along a curve.
 *
 * `computeFrenetFrames` gives a stable frame for open curves; closed curves
 * are swept with the same call and the seam is hidden by the material.
 */
function sweepGeometry(
  curve: THREE.Curve<THREE.Vector3>,
  profile: ProfileKey[],
  opts: { tubular?: number; radial?: number; capStart?: boolean; capEnd?: boolean } = {},
) {
  const tubular = opts.tubular ?? 48;
  const radial = opts.radial ?? 24;
  const frames = curve.computeFrenetFrames(tubular, false);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= tubular; i += 1) {
    const t = i / tubular;
    const point = curve.getPointAt(t);
    const normal = frames.normals[i];
    const binormal = frames.binormals[i];
    const { rx, ry } = sampleProfile(profile, t);

    for (let j = 0; j <= radial; j += 1) {
      const v = (j / radial) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      const offset = new THREE.Vector3()
        .copy(normal)
        .multiplyScalar(cos * rx)
        .addScaledVector(binormal, sin * ry);
      positions.push(point.x + offset.x, point.y + offset.y, point.z + offset.z);
      const out = offset.clone().normalize();
      normals.push(out.x, out.y, out.z);
      uvs.push(j / radial, t);
    }
  }

  for (let i = 0; i < tubular; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const addCap = (t: number, flip: boolean, ringStart: number) => {
    const point = curve.getPointAt(t);
    const centre = positions.length / 3;
    positions.push(point.x, point.y, point.z);
    const outward = curve.getTangentAt(t).multiplyScalar(flip ? -1 : 1).normalize();
    normals.push(outward.x, outward.y, outward.z);
    uvs.push(0.5, 0.5);
    for (let j = 0; j < radial; j += 1) {
      const a = ringStart + j;
      const b = ringStart + j + 1;
      if (flip) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  };

  if (opts.capStart !== false) addCap(0, true, 0);
  if (opts.capEnd !== false) addCap(1, false, tubular * (radial + 1));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function taperedTube(curve: THREE.CatmullRomCurve3, start: number, end: number, opts?: { tubular?: number; radial?: number }) {
  return sweepGeometry(
    curve,
    [
      { t: 0, rx: start, ry: start },
      { t: 0.55, rx: lerp(start, end, 0.45), ry: lerp(start, end, 0.45) },
      { t: 1, rx: end, ry: end },
    ],
    opts,
  );
}

function curveOf(points: [number, number, number][], closed = false) {
  return new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    closed,
    "catmullrom",
    0.5,
  );
}

export function buildHeart(renderer: THREE.WebGLRenderer | null): HeartParts {
  const root = new THREE.Group();
  root.name = "heart-root";

  const organ = new THREE.Group();
  organ.name = "heart-organ";
  root.add(organ);

  const layers: Record<LayerId, THREE.Group> = {
    pericardium: new THREE.Group(),
    muscle: new THREE.Group(),
    valves: new THREE.Group(),
    arteries: new THREE.Group(),
    veins: new THREE.Group(),
    coronaries: new THREE.Group(),
    conduction: new THREE.Group(),
    blood: new THREE.Group(),
  };
  (Object.keys(layers) as LayerId[]).forEach((key) => {
    layers[key].name = `layer-${key}`;
    organ.add(layers[key]);
  });

  const byMesh = new Map<string, THREE.Object3D>();
  const register = (id: string, object: THREE.Object3D) => {
    object.name = id;
    object.userData.meshId = id;
    byMesh.set(id, object);
    return object;
  };

  const muscleMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.muscle,
    roughness: 0.46,
    metalness: 0.02,
    clearcoat: 0.85,
    clearcoatRoughness: 0.32,
    sheen: 0.6,
    sheenColor: new THREE.Color(0xf3a49b),
    sheenRoughness: 0.7,
    side: THREE.FrontSide,
  });
  const cavityMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.cavity,
    roughness: 0.85,
    metalness: 0,
    side: THREE.BackSide,
  });
  const endocardiumMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.endocardium,
    roughness: 0.35,
    clearcoat: 0.6,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xffe2dc),
    side: THREE.DoubleSide,
  });
  const arteryMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.artery,
    roughness: 0.34,
    clearcoat: 0.9,
    clearcoatRoughness: 0.25,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xffb0a0),
  });
  const arteryBrightMaterial = arteryMaterial.clone();
  arteryBrightMaterial.color = new THREE.Color(PALETTE.arteryBright);
  const veinMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.vein,
    roughness: 0.4,
    clearcoat: 0.7,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xbcd0f5),
    transparent: true,
    opacity: 0.96,
  });
  const coronaryMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.arteryBright,
    roughness: 0.3,
    clearcoat: 0.95,
    clearcoatRoughness: 0.2,
  });
  const coronaryVeinMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.veinDark,
    roughness: 0.4,
    clearcoat: 0.7,
  });
  const valveMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.valve,
    roughness: 0.55,
    clearcoat: 0.5,
    transmission: 0.18,
    thickness: 0.4,
    side: THREE.DoubleSide,
  });
  const cordMaterial = new THREE.MeshStandardMaterial({ color: PALETTE.cord, roughness: 0.7 });
  const conductionMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.conduction,
    emissive: new THREE.Color(PALETTE.conduction),
    emissiveIntensity: 0.55,
    roughness: 0.5,
  });
  const purkinjeMaterial = new THREE.MeshStandardMaterial({
    color: PALETTE.purkinje,
    emissive: new THREE.Color(PALETTE.purkinje),
    emissiveIntensity: 0.4,
    roughness: 0.5,
  });
  const fatMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.fat,
    roughness: 0.62,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xfff0bb),
  });
  const pericardiumMaterial = new THREE.MeshPhysicalMaterial({
    color: PALETTE.pericardium,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transmission: 0.82,
    thickness: 0.6,
    ior: 1.32,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const owned: Array<THREE.BufferGeometry | THREE.Material> = [];
  const track = <T extends THREE.BufferGeometry | THREE.Material>(value: T) => {
    owned.push(value);
    return value;
  };

  function addChamber(
    id: string,
    points: [number, number, number][],
    profile: ProfileKey[],
    wallScale: number,
    options?: { depth?: number; colour?: number },
  ) {
    const group = new THREE.Group();
    register(id, group);
    const curve = curveOf(points);
    const outerGeometry = track(sweepGeometry(curve, profile, { tubular: 44, radial: 30 }));
    const wallMaterial = muscleMaterial.clone();
    wallMaterial.color = new THREE.Color(options?.colour ?? PALETTE.muscle);
    owned.push(wallMaterial);
    const outer = new THREE.Mesh(outerGeometry, wallMaterial);
    outer.castShadow = true;
    outer.receiveShadow = true;
    outer.userData.meshId = id;
    group.add(outer);

    const innerProfile = profile.map((key) => ({
      t: key.t,
      rx: key.rx * wallScale,
      ry: key.ry * wallScale,
    }));
    const innerGeometry = track(sweepGeometry(curve, innerProfile, { tubular: 36, radial: 22 }));
    const inner = new THREE.Mesh(innerGeometry, cavityMaterial);
    inner.userData.meshId = id;
    group.add(inner);

    // Endocardial lining: a slightly larger copy of the cavity surface.
    const liningGeometry = track(sweepGeometry(curve, innerProfile.map((key) => ({
      t: key.t,
      rx: key.rx * 1.035,
      ry: key.ry * 1.035,
    })), { tubular: 30, radial: 18 }));
    const lining = new THREE.Mesh(liningGeometry, endocardiumMaterial);
    lining.userData.meshId = "endocardium";
    group.add(lining);
    // One shared anchor for the endocardium layer, taken from the left ventricle.
    if (!byMesh.has("endocardium")) register("endocardium", lining);

    layers.muscle.add(group);
    return { group, curve, outer, inner, wallMaterial };
  }

  const rightAtrium = addChamber(
    "right-atrium",
    [
      [-1.18, 1.62, 0.18],
      [-1.4, 1.16, 0.34],
      [-1.3, 0.66, 0.3],
    ],
    [
      { t: 0, rx: 0.34, ry: 0.36 },
      { t: 0.32, rx: 0.58, ry: 0.62 },
      { t: 0.7, rx: 0.6, ry: 0.66 },
      { t: 1, rx: 0.34, ry: 0.4 },
    ],
    0.88,
  );

  const rightVentricle = addChamber(
    "right-ventricle",
    [
      [-0.62, 1.02, 0.52],
      [-0.78, 0.1, 0.72],
      [-0.6, -1.05, 0.6],
      [-0.38, -1.85, 0.42],
    ],
    [
      { t: 0, rx: 0.44, ry: 0.42 },
      { t: 0.3, rx: 0.62, ry: 0.58 },
      { t: 0.68, rx: 0.54, ry: 0.5 },
      { t: 1, rx: 0.2, ry: 0.18 },
    ],
    0.9,
    { colour: 0x8a4f7a },
  );

  const leftAtrium = addChamber(
    "left-atrium",
    [
      [0.72, 1.72, -0.62],
      [1.02, 1.3, -0.78],
      [0.82, 0.92, -0.6],
    ],
    [
      { t: 0, rx: 0.3, ry: 0.3 },
      { t: 0.35, rx: 0.52, ry: 0.52 },
      { t: 0.72, rx: 0.54, ry: 0.5 },
      { t: 1, rx: 0.28, ry: 0.3 },
    ],
    0.88,
    { colour: 0x9a3038 },
  );

  const leftVentricle = addChamber(
    "left-ventricle",
    [
      [0.62, 1.02, 0.02],
      [0.8, -0.24, 0.2],
      [0.72, -1.5, 0.34],
      [0.55, -2.42, 0.4],
    ],
    [
      { t: 0, rx: 0.52, ry: 0.48 },
      { t: 0.18, rx: 0.74, ry: 0.7 },
      { t: 0.62, rx: 0.62, ry: 0.6 },
      { t: 0.88, rx: 0.34, ry: 0.34 },
      { t: 1, rx: 0.1, ry: 0.1 },
    ],
    0.72,
    { colour: PALETTE.muscle },
  );

  // Atrial appendages and the apical cap.
  const appendage = (id: string, points: [number, number, number][], radius: number) => {
    const curve = curveOf(points);
    const geometry = track(taperedTube(curve, radius, radius * 0.55, { tubular: 28, radial: 18 }));
    const mesh = new THREE.Mesh(geometry, muscleMaterial);
    register(id, mesh);
    layers.muscle.add(mesh);
    return mesh;
  };
  appendage(
    "right-atrial-appendage",
    [
      [-1.1, 1.3, 0.5],
      [-0.95, 1.42, 0.86],
      [-0.72, 1.3, 0.96],
    ],
    0.26,
  );
  appendage(
    "left-atrial-appendage",
    [
      [0.9, 1.5, -0.2],
      [1.16, 1.62, 0.06],
      [1.32, 1.54, 0.3],
    ],
    0.24,
  );

  const apexGeometry = track(new THREE.SphereGeometry(0.3, 24, 18));
  const apexMesh = new THREE.Mesh(apexGeometry, muscleMaterial);
  apexMesh.position.set(0.55, -2.42, 0.4);
  apexMesh.scale.set(1, 1.35, 1);
  register("apex", apexMesh);
  layers.muscle.add(apexMesh);

  // Septa as flattened swept slabs.
  const septumGeometry = track(new THREE.BoxGeometry(0.16, 3.1, 1.5, 1, 16, 8));
  const septal = new THREE.Mesh(septumGeometry, muscleMaterial.clone());
  (septal.material as THREE.MeshPhysicalMaterial).color = new THREE.Color(0xb8696c);
  septal.position.set(0.16, -0.45, 0.16);
  septal.rotation.z = 0.12;
  register("interventricular-septum", septal);
  layers.muscle.add(septal);

  const atrialSeptum = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.52, 22, 16)),
    muscleMaterial.clone(),
  );
  (atrialSeptum.material as THREE.MeshPhysicalMaterial).color = new THREE.Color(0xa65056);
  atrialSeptum.position.set(0.1, 1.2, -0.5);
  atrialSeptum.scale.set(0.28, 0.9, 0.85);
  atrialSeptum.rotation.z = 0.2;
  register("interatrial-septum", atrialSeptum);
  layers.muscle.add(atrialSeptum);

  const fossa = new THREE.Mesh(
    track(new THREE.CircleGeometry(0.17, 24)),
    new THREE.MeshStandardMaterial({ color: 0xd6c3a5, roughness: 0.8, side: THREE.DoubleSide }),
  );
  fossa.position.set(0.22, 1.28, -0.16);
  fossa.rotation.y = -0.5;
  fossa.rotation.x = 0.2;
  register("fossa-ovalis", fossa);
  layers.muscle.add(fossa);

  // Trabeculae, pectinate ridges and the moderator band: cheap instanced bumps.
  const ridgeGeometry = track(new THREE.CapsuleGeometry(0.035, 0.5, 3, 6));
  const ridgeCount = 54;
  const ridges = new THREE.InstancedMesh(ridgeGeometry, muscleMaterial.clone(), ridgeCount);
  (ridges.material as THREE.MeshPhysicalMaterial).color = new THREE.Color(0x7a4a5a);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const position = new THREE.Vector3();
  for (let i = 0; i < ridgeCount; i += 1) {
    const t = i / ridgeCount;
    const side = i % 2 === 0 ? 1 : -1;
    position.set(
      lerp(-0.9, 0.9, t) + side * 0.05,
      -1.9 + t * 3.4 + Math.sin(t * 9) * 0.08,
      side * (0.28 + Math.cos(t * 7) * 0.08),
    );
    quaternion.setFromEuler(new THREE.Euler(t * 2.1, t * 3.2, t * 1.4));
    scale.set(1, 0.7 + (i % 5) * 0.08, 1);
    matrix.compose(position, quaternion, scale);
    ridges.setMatrixAt(i, matrix);
  }
  ridges.userData.meshId = "trabeculae-carneae";
  byMesh.set("trabeculae-carneae", ridges);
  layers.muscle.add(ridges);

  const pectinate = new THREE.InstancedMesh(ridgeGeometry, fatMaterial, 22);
  for (let i = 0; i < 22; i += 1) {
    const t = i / 22;
    position.set(-1.36 + Math.sin(t * 6) * 0.16, 1.5 - t * 0.9, 0.34 + Math.cos(t * 5) * 0.22);
    quaternion.setFromEuler(new THREE.Euler(0.2, t * 2.8, 0.4));
    scale.set(1, 0.6, 1);
    matrix.compose(position, quaternion, scale);
    pectinate.setMatrixAt(i, matrix);
  }
  pectinate.userData.meshId = "pectinate-muscles";
  byMesh.set("pectinate-muscles", pectinate);
  layers.muscle.add(pectinate);

  // --- Valves -------------------------------------------------------------
  function buildValve(
    id: string,
    centre: THREE.Vector3,
    radius: number,
    leaflets: number,
    rotation: THREE.Euler,
    opening: number,
  ): ValveRig {
    const group = new THREE.Group();
    group.position.copy(centre);
    group.rotation.copy(rotation);
    register(id, group);

    const annulus = new THREE.Mesh(
      track(new THREE.TorusGeometry(radius, radius * 0.13, 12, 40)),
      valveMaterial,
    );
    annulus.rotation.x = Math.PI / 2;
    group.add(annulus);

    const leafletGroups: THREE.Group[] = [];
    for (let i = 0; i < leaflets; i += 1) {
      const hinge = new THREE.Group();
      hinge.rotation.y = (i / leaflets) * Math.PI * 2;
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.quadraticCurveTo(radius * 0.55, radius * 0.55, radius * 0.94, 0);
      shape.quadraticCurveTo(radius * 0.5, -radius * 0.18, 0, 0);
      const geometry = track(new THREE.ShapeGeometry(shape, 12));
      const mesh = new THREE.Mesh(geometry, valveMaterial);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(radius * 0.46, 0, 0);
      mesh.userData.meshId = id;
      hinge.add(mesh);
      group.add(hinge);
      leafletGroups.push(hinge);
    }

    const rig: ValveRig = {
      id,
      group,
      leaflets: leafletGroups,
      setOpen(open: number) {
        const clamped = Math.max(0, Math.min(1, open));
        leafletGroups.forEach((hinge, index) => {
          const direction = index % 2 === 0 ? 1 : -1;
          hinge.rotation.z = direction * clamped * opening;
        });
      },
      setThickness(factor: number) {
        group.scale.setScalar(factor);
      },
    };
    rig.setOpen(0);
    layers.valves.add(group);
    return rig;
  }

  const tricuspid = buildValve("tricuspid-valve", new THREE.Vector3(-0.9, 0.66, 0.36), 0.42, 3, new THREE.Euler(0.22, 0.25, 0), 0.5);
  const pulmonary = buildValve("pulmonary-valve", new THREE.Vector3(-0.16, 1.02, 0.46), 0.3, 3, new THREE.Euler(-0.2, 0.1, 0), 0.55);
  const mitral = buildValve("mitral-valve", new THREE.Vector3(0.72, 0.72, -0.02), 0.44, 2, new THREE.Euler(0.18, -0.35, 0), 0.45);
  const aortic = buildValve("aortic-valve", new THREE.Vector3(0.42, 0.78, 0.3), 0.32, 3, new THREE.Euler(-0.25, -0.2, 0), 0.55);

  // Chordae tendineae and papillary muscles.
  const cordGroup = new THREE.Group();
  register("chordae-tendineae", cordGroup);
  const cordMaterialCord = cordMaterial;
  const cordPairs: Array<[THREE.Vector3, THREE.Vector3]> = [
    [new THREE.Vector3(0.5, 0.2, 0.1), new THREE.Vector3(0.62, 0.66, 0.02)],
    [new THREE.Vector3(0.9, 0.1, -0.2), new THREE.Vector3(0.76, 0.66, -0.06)],
    [new THREE.Vector3(0.55, -0.1, 0.28), new THREE.Vector3(0.7, 0.62, 0.12)],
    [new THREE.Vector3(-1.0, 0.2, 0.5), new THREE.Vector3(-0.92, 0.64, 0.4)],
    [new THREE.Vector3(-0.75, 0.15, 0.62), new THREE.Vector3(-0.84, 0.64, 0.46)],
  ];
  cordPairs.forEach(([from, to]) => {
    const geometry = track(new THREE.CylinderGeometry(0.008, 0.012, from.distanceTo(to), 4));
    const cord = new THREE.Mesh(geometry, cordMaterialCord);
    cord.position.copy(from).add(to).multiplyScalar(0.5);
    cord.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      to.clone().sub(from).normalize(),
    );
    cordGroup.add(cord);
  });
  layers.valves.add(cordGroup);

  const papillary = new THREE.Group();
  register("papillary-muscles", papillary);
  [
    [0.52, 0.16, 0.14],
    [0.86, 0.06, -0.2],
    [-0.95, 0.2, 0.44],
  ].forEach(([x, y, z]) => {
    const bump = new THREE.Mesh(track(new THREE.CapsuleGeometry(0.07, 0.2, 4, 10)), muscleMaterial);
    bump.position.set(x, y, z);
    bump.rotation.z = 0.3;
    papillary.add(bump);
  });
  layers.valves.add(papillary);

  const fibrous = new THREE.Mesh(
    track(new THREE.TorusGeometry(0.62, 0.05, 8, 40)),
    new THREE.MeshStandardMaterial({ color: 0xd6c3a5, roughness: 0.7 }),
  );
  fibrous.position.set(0.35, 0.74, 0.1);
  fibrous.rotation.x = Math.PI / 2;
  fibrous.rotation.z = 0.2;
  register("fibrous-skeleton", fibrous);
  layers.valves.add(fibrous);

  // --- Great vessels ------------------------------------------------------
  function addVessel(
    id: string,
    points: [number, number, number][],
    start: number,
    end: number,
    layer: LayerId,
    material: THREE.Material,
    pulse = false,
  ) {
    const curve = curveOf(points);
    const geometry = track(taperedTube(curve, start, end, { tubular: 42, radial: 20 }));
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    register(id, mesh);
    layers[layer].add(mesh);
    if (pulse) mesh.userData.pulse = true;
    return mesh;
  }

  const pulseTargets: THREE.Mesh[] = [];
  const svc = addVessel("superior-vena-cava", [
    [-0.96, 1.86, -0.04],
    [-1.0, 2.5, -0.12],
    [-0.92, 3.05, -0.2],
  ], 0.24, 0.2, "veins", veinMaterial);
  pulseTargets.push(svc);
  addVessel("inferior-vena-cava", [
    [-1.22, 0.6, 0.12],
    [-1.16, -0.4, 0.0],
    [-1.05, -1.25, -0.2],
  ], 0.26, 0.22, "veins", veinMaterial);

  const pulmonaryTrunk = addVessel("pulmonary-trunk", [
    [0.0, 1.02, 0.5],
    [0.02, 1.7, 0.34],
    [-0.06, 2.2, 0.0],
  ], 0.3, 0.24, "arteries", arteryMaterial, true);
  pulseTargets.push(pulmonaryTrunk);

  const leftPa = addVessel("pulmonary-arteries", [
    [-0.06, 2.2, 0.0],
    [0.7, 2.44, -0.24],
    [1.5, 2.4, -0.44],
  ], 0.22, 0.14, "arteries", arteryMaterial, true);
  pulseTargets.push(leftPa);
  const rightPa = addVessel("pulmonary-arteries-right", [
    [-0.06, 2.2, 0.0],
    [-0.75, 2.42, -0.26],
    [-1.5, 2.36, -0.45],
  ], 0.22, 0.14, "arteries", arteryMaterial, true);
  pulseTargets.push(rightPa);

  [
    [0.0, 1.5, -1.05],
    [0.55, 1.75, -1.0],
    [-0.55, 1.72, -1.02],
    [1.15, 1.2, -0.9],
  ].forEach(([x, y, z], index) => {
    addVessel(`pulmonary-vein-${index}`, [
      [x, y, z],
      [x * 0.6 + 0.3, y - 0.2, z + 0.35],
      [0.86, 1.2, -0.66],
    ], 0.14, 0.11, "veins", arteryBrightMaterial);
  });

  const ascendingAorta = addVessel("aorta", [
    [0.42, 0.86, 0.34],
    [0.38, 1.6, 0.24],
    [0.22, 2.16, 0.02],
  ], 0.32, 0.28, "arteries", arteryMaterial, true);
  pulseTargets.push(ascendingAorta);
  const arch = addVessel("aortic-arch", [
    [0.22, 2.16, 0.02],
    [-0.1, 2.56, -0.22],
    [-0.5, 2.52, -0.56],
    [-0.72, 2.1, -0.78],
  ], 0.28, 0.24, "arteries", arteryBrightMaterial, true);
  pulseTargets.push(arch);
  const descending = addVessel("descending-aorta", [
    [-0.72, 2.1, -0.78],
    [-0.82, 1.0, -0.9],
    [-0.9, -0.6, -0.94],
    [-0.95, -2.1, -0.9],
  ], 0.24, 0.18, "arteries", arteryMaterial, true);
  pulseTargets.push(descending);

  // Three arch branches.
  [
    [[-0.16, 2.5, -0.2], [-0.32, 2.95, -0.36], [-0.46, 3.1, -0.44]],
    [[-0.36, 2.56, -0.4], [-0.52, 3.0, -0.52], [-0.66, 3.14, -0.58]],
    [[-0.54, 2.44, -0.62], [-0.86, 2.86, -0.78], [-1.06, 2.96, -0.84]],
  ].forEach((points, index) => {
    addVessel(`arch-branch-${index}`, points as [number, number, number][], 0.09, 0.07, "arteries", arteryBrightMaterial);
  });

  // --- Coronaries ---------------------------------------------------------
  const ladCurve = curveOf([
    [0.34, 0.62, 0.44],
    [0.44, 0.1, 0.66],
    [0.46, -0.7, 0.68],
    [0.5, -1.5, 0.55],
    [0.52, -2.05, 0.44],
  ]);
  const lad = new THREE.Mesh(
    track(taperedTube(ladCurve, 0.075, 0.03, { tubular: 60, radial: 12 })),
    coronaryMaterial,
  );
  register("lad-artery", lad);
  layers.coronaries.add(lad);

  const leftMain = new THREE.Mesh(
    track(taperedTube(curveOf([[0.34, 0.74, 0.38], [0.2, 0.66, 0.5], [0.3, 0.6, 0.56]]), 0.1, 0.08, { tubular: 16, radial: 12 })),
    coronaryMaterial,
  );
  register("left-main-coronary", leftMain);
  layers.coronaries.add(leftMain);

  const circumflex = new THREE.Mesh(
    track(taperedTube(curveOf([
      [0.36, 0.62, 0.48],
      [0.86, 0.66, 0.2],
      [1.02, 0.24, -0.3],
      [0.94, -0.28, -0.74],
    ]), 0.07, 0.028, { tubular: 48, radial: 12 })),
    coronaryMaterial,
  );
  register("circumflex-artery", circumflex);
  layers.coronaries.add(circumflex);

  const rca = new THREE.Mesh(
    track(taperedTube(curveOf([
      [-0.1, 0.7, 0.4],
      [-0.5, 0.62, 0.5],
      [-0.98, 0.46, 0.36],
      [-1.16, 0.0, 0.1],
      [-1.0, -0.5, -0.1],
    ]), 0.072, 0.03, { tubular: 52, radial: 12 })),
    coronaryMaterial,
  );
  register("right-coronary-artery", rca);
  layers.coronaries.add(rca);

  const pda = new THREE.Mesh(
    track(taperedTube(curveOf([
      [-0.9, -0.5, -0.2],
      [-0.4, -1.1, -0.72],
      [0.1, -1.7, -0.72],
      [0.34, -2.1, -0.5],
    ]), 0.06, 0.026, { tubular: 48, radial: 12 })),
    coronaryMaterial,
  );
  register("posterior-descending", pda);
  layers.coronaries.add(pda);

  const greatCardiacVein = new THREE.Mesh(
    track(taperedTube(curveOf([
      [0.44, -1.3, 0.5],
      [0.3, -0.4, 0.62],
      [0.16, 0.4, 0.5],
      [-0.1, 0.7, 0.28],
    ]), 0.05, 0.07, { tubular: 44, radial: 10 })),
    coronaryVeinMaterial,
  );
  register("cardiac-veins", greatCardiacVein);
  layers.coronaries.add(greatCardiacVein);

  const coronarySinus = new THREE.Mesh(
    track(taperedTube(curveOf([
      [-0.1, 0.72, 0.2],
      [-0.62, 0.62, 0.02],
      [-1.05, 0.6, 0.06],
    ]), 0.09, 0.08, { tubular: 24, radial: 12 })),
    coronaryVeinMaterial,
  );
  register("coronary-sinus", coronarySinus);
  layers.coronaries.add(coronarySinus);

  // Ischaemia and plaque overlays are always built but hidden until a
  // condition asks for them, which keeps condition switching allocation-free.
  const ischaemiaPatch = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.62, 26, 18, 0, Math.PI * 2, 0, Math.PI * 0.62)),
    new THREE.MeshStandardMaterial({
      color: 0x4b2b33,
      roughness: 0.9,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
    }),
  );
  ischaemiaPatch.position.set(0.5, -1.1, 0.5);
  ischaemiaPatch.scale.set(0.9, 1.5, 0.9);
  ischaemiaPatch.visible = false;
  register("ischaemia", ischaemiaPatch);
  layers.muscle.add(ischaemiaPatch);

  const plaque = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.085, 16, 12)),
    new THREE.MeshStandardMaterial({ color: 0xe8dcc8, roughness: 0.95 }),
  );
  plaque.position.set(0.44, 0.16, 0.66);
  plaque.scale.set(1, 1.9, 1);
  plaque.visible = false;
  register("plaque", plaque);
  layers.coronaries.add(plaque);

  const shuntJet = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.02, 0.05, 0.7, 12, 1, true)),
    new THREE.MeshBasicMaterial({ color: 0xff8fa3, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  shuntJet.position.set(0.16, -0.2, 0.2);
  shuntJet.rotation.z = Math.PI / 2.4;
  shuntJet.visible = false;
  register("shunt", shuntJet);
  layers.muscle.add(shuntJet);

  // --- Conduction ---------------------------------------------------------
  const saNode = new THREE.Mesh(
    track(new THREE.SphereGeometry(0.09, 18, 14)),
    conductionMaterial,
  );
  saNode.position.set(-0.98, 1.52, 0.16);
  register("sa-node", saNode);
  layers.conduction.add(saNode);

  const avNode = new THREE.Mesh(track(new THREE.SphereGeometry(0.07, 16, 12)), conductionMaterial);
  avNode.position.set(0.14, 0.98, -0.12);
  register("av-node", avNode);
  layers.conduction.add(avNode);

  const hisCurve = curveOf([
    [0.14, 0.94, -0.12],
    [0.16, 0.66, -0.06],
    [0.16, 0.34, 0.02],
  ]);
  const his = new THREE.Mesh(track(taperedTube(hisCurve, 0.045, 0.04, { tubular: 22, radial: 10 })), conductionMaterial);
  register("bundle-of-his", his);
  layers.conduction.add(his);

  const rightBundle = curveOf([
    [0.16, 0.34, 0.02],
    [-0.16, -0.4, 0.36],
    [-0.24, -1.3, 0.5],
    [-0.3, -1.9, 0.44],
  ]);
  const leftBundle = curveOf([
    [0.16, 0.34, 0.02],
    [0.42, -0.4, 0.22],
    [0.5, -1.4, 0.3],
    [0.52, -2.1, 0.36],
  ]);
  [rightBundle, leftBundle].forEach((curve) => {
    const mesh = new THREE.Mesh(track(taperedTube(curve, 0.032, 0.02, { tubular: 40, radial: 8 })), conductionMaterial);
    layers.conduction.add(mesh);
  });
  register("bundle-branches", layers.conduction);

  const purkinjeCurves = [
    curveOf([[0.4, -0.9, 0.42], [0.7, -1.2, 0.3], [0.6, -1.8, 0.34]]),
    curveOf([[-0.2, -1.0, 0.4], [-0.5, -1.4, 0.4], [-0.45, -1.9, 0.4]]),
    curveOf([[0.45, -0.6, 0.5], [0.2, -1.0, 0.62], [0.0, -1.4, 0.6]]),
  ];
  purkinjeCurves.forEach((curve) => {
    const mesh = new THREE.Mesh(track(taperedTube(curve, 0.014, 0.008, { tubular: 30, radial: 6 })), purkinjeMaterial);
    layers.conduction.add(mesh);
  });
  register("purkinje-fibres", layers.conduction);

  // --- Pericardium, fat and epicardium -----------------------------------
  const pericardium = new THREE.Mesh(
    track(new THREE.SphereGeometry(1, 48, 32)),
    pericardiumMaterial,
  );
  pericardium.scale.set(1.85, 2.5, 1.5);
  pericardium.position.set(0.0, 0.1, -0.05);
  register("pericardium", pericardium);
  layers.pericardium.add(pericardium);

  const pericardialFluid = new THREE.Mesh(
    track(new THREE.SphereGeometry(1, 32, 24)),
    new THREE.MeshPhysicalMaterial({
      color: 0xbfeaf2,
      transmission: 0.95,
      thickness: 0.4,
      roughness: 0.05,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
    }),
  );
  pericardialFluid.scale.set(1.76, 2.4, 1.42);
  pericardialFluid.position.copy(pericardium.position);
  register("pericardial-fluid", pericardialFluid);
  layers.pericardium.add(pericardialFluid);

  const epicardium = new THREE.Mesh(
    track(new THREE.SphereGeometry(1, 36, 24)),
    new THREE.MeshPhysicalMaterial({
      color: 0xc98c6b,
      roughness: 0.4,
      clearcoat: 0.8,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
    }),
  );
  epicardium.scale.set(1.5, 2.16, 1.2);
  epicardium.position.set(0.0, 0.0, 0.0);
  register("epicardium", epicardium);
  layers.muscle.add(epicardium);

  const fatPads = new THREE.Group();
  register("epicardial-fat", fatPads);
  const fatGeometry = track(new THREE.SphereGeometry(0.12, 12, 8));
  [
    [0.5, 0.62, 0.62],
    [0.42, 0.18, 0.7],
    [-0.18, 0.66, 0.6],
    [-0.7, 0.56, 0.52],
    [0.9, 0.5, -0.1],
    [-0.98, -0.1, 0.1],
    [0.2, -2.05, 0.5],
    [-0.2, -1.9, 0.4],
  ].forEach(([x, y, z]) => {
    const pad = new THREE.Mesh(fatGeometry, fatMaterial);
    pad.position.set(x, y, z);
    pad.scale.set(1.4, 1.1, 1.2);
    fatPads.add(pad);
  });
  layers.muscle.add(fatPads);

  const mediastinum = new THREE.Mesh(
    track(new THREE.BoxGeometry(4.6, 5.2, 2.6)),
    new THREE.MeshBasicMaterial({ color: 0x7f8aa3, transparent: true, opacity: 0.06, side: THREE.BackSide }),
  );
  register("mediastinum", mediastinum);
  layers.pericardium.add(mediastinum);

  // Group containers that the simulator animates directly.
  const chamberGroups = {
    rightAtrium: rightAtrium.group,
    rightVentricle: rightVentricle.group,
    leftAtrium: leftAtrium.group,
    leftVentricle: leftVentricle.group,
  };

  byMesh.set("heart", organ);
  byMesh.set("myocardium", layers.muscle);
  byMesh.set("blood", layers.blood);
  byMesh.set("capillaries", layers.blood);

  // --- Paths used by particles -------------------------------------------
  const bloodLoop = curveOf([
    [-1.05, -1.2, -0.2],
    [-1.22, 0.6, 0.12],
    [-1.3, 1.0, 0.3],
    [-1.0, 0.5, 0.5],
    [-0.7, -0.4, 0.66],
    [-0.5, -1.5, 0.55],
    [-0.1, 1.1, 0.5],
    [-0.05, 2.2, 0.0],
    [0.7, 2.44, -0.24],
    [1.5, 2.36, -0.5],
    [1.1, 1.55, -0.9],
    [0.86, 1.2, -0.66],
    [0.9, 0.6, -0.2],
    [0.8, -0.6, 0.2],
    [0.55, -2.0, 0.4],
    [0.42, 0.86, 0.34],
    [0.22, 2.16, 0.02],
    [-0.5, 2.52, -0.56],
    [-0.86, 1.0, -0.9],
    [-0.95, -1.4, -0.9],
  ], true);

  const drugLoop = curveOf([
    [-0.2, -2.9, 0.7],
    [-0.7, -2.4, 0.3],
    [-1.0, -1.7, 0.0],
    [-1.05, -1.2, -0.2],
    [-1.22, 0.6, 0.12],
    [-1.3, 1.0, 0.3],
    [-1.0, 0.5, 0.5],
    [-0.7, -0.4, 0.66],
    [-0.5, -1.5, 0.55],
    [-0.1, 1.1, 0.5],
    [-0.05, 2.2, 0.0],
    [0.7, 2.44, -0.24],
    [1.5, 2.36, -0.5],
    [1.1, 1.55, -0.9],
    [0.86, 1.2, -0.66],
    [0.9, 0.6, -0.2],
    [0.8, -0.6, 0.2],
    [0.42, 0.86, 0.34],
    [0.22, 2.16, 0.02],
    [0.34, 0.62, 0.44],
    [0.46, -0.7, 0.68],
    [0.5, -1.5, 0.55],
    [0.52, -2.05, 0.44],
  ]);

  // --- Cellular close-up --------------------------------------------------
  const cellular = new THREE.Group();
  cellular.name = "heart-cellular";
  cellular.visible = false;
  cellular.position.set(0, 0, 0);
  root.add(cellular);

  const cellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd0707a,
    roughness: 0.4,
    clearcoat: 0.7,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xffc9cf),
  });
  const cardiomyocyte = new THREE.Mesh(
    track(new THREE.CapsuleGeometry(0.55, 2.4, 12, 24)),
    cellMaterial,
  );
  cardiomyocyte.rotation.z = Math.PI / 2;
  cardiomyocyte.rotation.y = 0.3;
  cardiomyocyte.userData.meshId = "cardiomyocyte";
  cellular.add(cardiomyocyte);

  const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xe79aa2, roughness: 0.6 });
  const bandGeometry = track(new THREE.BoxGeometry(0.02, 1.0, 1.0));
  for (let i = 0; i < 22; i += 1) {
    const band = new THREE.Mesh(bandGeometry, bandMaterial);
    band.position.set(-1.55 + i * 0.145, 0, 0);
    band.scale.set(1, 1, 0.98);
    band.userData.alternate = i % 2 === 0;
    cellular.add(band);
  }

  const discMaterial = new THREE.MeshStandardMaterial({ color: 0xf2d7c6, roughness: 0.5 });
  [-0.62, 0.62].forEach((x) => {
    const disc = new THREE.Mesh(track(new THREE.BoxGeometry(0.05, 1.25, 1.25)), discMaterial);
    disc.position.set(x, 0, 0);
    disc.userData.meshId = "intercalated-discs";
    cellular.add(disc);
  });

  const tubuleMaterial = new THREE.MeshStandardMaterial({ color: 0xc8b0e8, roughness: 0.5 });
  for (let i = 0; i < 6; i += 1) {
    const tubule = new THREE.Mesh(
      track(new THREE.TorusGeometry(0.5, 0.035, 6, 20, Math.PI)),
      tubuleMaterial,
    );
    tubule.rotation.y = Math.PI / 2;
    tubule.rotation.z = Math.PI / 2;
    tubule.position.set(-1.0 + i * 0.4, 0, 0);
    tubule.userData.meshId = "t-tubules";
    cellular.add(tubule);
  }

  const capillary = new THREE.Mesh(
    track(new THREE.CylinderGeometry(0.34, 0.34, 5.2, 24, 1, true)),
    new THREE.MeshPhysicalMaterial({
      color: 0xf2d7c6,
      transparent: true,
      opacity: 0.28,
      roughness: 0.2,
      clearcoat: 0.8,
      side: THREE.DoubleSide,
    }),
  );
  capillary.rotation.z = Math.PI / 2;
  capillary.position.set(0, 1.5, 0);
  capillary.userData.meshId = "endothelium";
  cellular.add(capillary);

  const rbcGeometry = track(new THREE.SphereGeometry(0.26, 16, 12));
  for (let i = 0; i < 3; i += 1) {
    const rbc = new THREE.Mesh(
      rbcGeometry,
      new THREE.MeshPhysicalMaterial({ color: 0xd8342a, roughness: 0.35, clearcoat: 0.9 }),
    );
    rbc.scale.set(1, 0.62, 1);
    rbc.position.set(-1.6 + i * 1.5, 1.5, 0);
    rbc.rotation.x = Math.PI / 2;
    rbc.userData.meshId = "blood";
    cellular.add(rbc);
  }

  const calciumMaterial = new THREE.MeshStandardMaterial({
    color: 0x9be0d0,
    emissive: new THREE.Color(0x4fd0b4),
    emissiveIntensity: 0.6,
    roughness: 0.3,
  });
  for (let i = 0; i < 26; i += 1) {
    const ion = new THREE.Mesh(track(new THREE.SphereGeometry(0.055, 10, 8)), calciumMaterial);
    ion.position.set(
      (Math.random() - 0.5) * 3.2,
      (Math.random() - 0.5) * 1.4,
      (Math.random() - 0.5) * 1.4,
    );
    ion.userData.meshId = "calcium-trigger";
    ion.userData.drift = Math.random() * Math.PI * 2;
    cellular.add(ion);
  }

  const sarcomereGeometry = track(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 8));
  for (let i = 0; i < 10; i += 1) {
    const filament = new THREE.Mesh(sarcomereGeometry, new THREE.MeshStandardMaterial({ color: 0xe79aa2, roughness: 0.5 }));
    filament.rotation.z = Math.PI / 2;
    filament.position.set(-1.4 + i * 0.28, 0.72, 0.3);
    filament.userData.meshId = "sarcomere";
    cellular.add(filament);
  }

  const conductionPaths = [hisCurve, rightBundle, leftBundle, ...purkinjeCurves];

  const dispose = () => {
    owned.forEach((item) => item.dispose());
  };

  return {
    root,
    organ,
    cellular,
    layers,
    byMesh,
    valves: { tricuspid, pulmonary, mitral, aortic },
    chamberGroups,
    pulseTargets,
    bloodLoop,
    drugLoop,
    conductionPath: conductionPaths,
    ischaemiaPatch,
    plaque,
    shuntJet,
    dispose,
  };
}

/** Biconcave red-cell stand-in used by every particle system. */
export function redCellGeometry() {
  const geometry = new THREE.SphereGeometry(0.055, 10, 8);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const radius = Math.sqrt(x * x + z * z);
    const dimple = Math.max(0, 1 - (radius / 0.055) ** 2) * 0.018;
    position.setY(i, y * 0.55 - dimple);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export { PALETTE, curveOf, taperedTube, sweepGeometry };
