import * as THREE from "three";
import type { PartAnchor } from "@/components/anatomy/model";
import type { DoseRoute } from "./playback";

type Point = [number, number, number];

// Waypoints in the atlas's normalized coordinate space. The vessel branches
// show the direction of blood flow and approximate the missing small vessels.
const stomach: Point = [-0.073, 0.53, -0.016];
const bowel: Point = [-0.015, 0.23, -0.004];
const liver: Point = [-0.095, 0.57, 0.036];
const rightHeart: Point = [-0.032, 0.79, 0.055];
const leftHeart: Point = [0.066, 0.81, 0.019];
const rightLung: Point = [-0.164, 0.79, 0.015];
const leftLung: Point = [0.163, 0.81, 0.008];
const arch: Point = [0.028, 0.944, -0.037];
const abdominalAorta: Point = [0.025, 0.52, -0.067];
const tracks: Record<DoseRoute, Point[][]> = {
  swallow: [[[0, 1.28, 0.19], [0, 1.28, 0.08], [0, 1.19, -0.052],
    [-0.008, 0.99, -0.082], [0.005, 0.79, -0.086], [-0.02, 0.62, -0.048], stomach]],
  absorption: [[stomach, [-0.092, 0.454, -0.01], [0.057, 0.434, -0.039],
    [0.032, 0.334, -0.011], [-0.066, 0.284, -0.016], bowel]],
  portal: [[bowel, [0.039, 0.337, -0.057], [0.025, 0.43, -0.08], [-0.039, 0.52, -0.06], liver]],
  "right-heart": [[liver, [-0.076, 0.61, -0.063], [-0.028, 0.676, -0.015], [-0.034, 0.733, 0.011], rightHeart]],
  lungs: [
    [rightHeart, [0.009, 0.883, 0.036], [-0.09, 0.868, -0.004], rightLung],
    [rightHeart, [0.009, 0.883, 0.036], [0.112, 0.88, -0.003], leftLung],
  ],
  "left-heart": [
    [rightLung, [-0.11, 0.777, -0.063], [-0.028, 0.788, -0.051], leftHeart],
    [leftLung, [0.137, 0.757, -0.048], [0.082, 0.772, -0.034], leftHeart],
  ],
  brain: [[leftHeart, [0.027, 0.882, 0.006], arch, [0.036, 1.023, -0.029],
    [0.036, 1.161, -0.026], [0.062, 1.281, 0.009], [0.076, 1.415, 0.022]]],
  body: [[leftHeart, [0.027, 0.882, 0.006], arch, [0.036, 0.789, -0.091],
    abdominalAorta, [0.031, 0.305, -0.059], [0.093, 0.161, -0.031]]],
  liver: [[abdominalAorta, [0.026, 0.575, -0.064], [-0.015, 0.59, -0.043], liver]],
  kidneys: [
    [abdominalAorta, [0.022, 0.448, -0.066], [-0.053, 0.443, -0.063], [-0.122, 0.445, -0.087]],
    [abdominalAorta, [0.023, 0.46, -0.065], [0.062, 0.459, -0.056], [0.103, 0.466, -0.079]],
  ],
};

const TAIL_POINTS = 11;

export function createDoseJourney(scene: THREE.Scene) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);

  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0xe59a37,
    transparent: true,
    opacity: 0.82,
    depthTest: false,
    depthWrite: false,
  });
  const segments = new Map(Object.entries(tracks).map(([id, paths]) => {
    const curves = paths.map((path) => new THREE.CatmullRomCurve3(
      path.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
    ));
    const bounds = new THREE.Box3();
    const lines = curves.map((curve) => {
      const points = curve.getPoints(128);
      for (const point of points) bounds.expandByPoint(point);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), lineMaterial);
      line.renderOrder = 5;
      line.visible = false;
      group.add(line);
      return line;
    });
    const anchor: PartAnchor = {
      centre: bounds.getCenter(new THREE.Vector3()),
      radius: bounds.getSize(new THREE.Vector3()).length() * 0.5,
    };
    return [id, { curves, lines, anchor }] as const;
  }));

  const pillGeometry = new THREE.CapsuleGeometry(0.017, 0.04, 12, 24);
  const pillVertices = pillGeometry.getAttribute("position");
  const pillColors = new Float32Array(pillVertices.count * 3);
  const ivory = new THREE.Color(0xfff7d5);
  const amber = new THREE.Color(0xffa42f);
  for (let i = 0; i < pillVertices.count; i++) {
    (pillVertices.getY(i) >= 0 ? ivory : amber).toArray(pillColors, i * 3);
  }
  pillGeometry.setAttribute("color", new THREE.BufferAttribute(pillColors, 3));
  const pill = new THREE.Mesh(pillGeometry, new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthTest: false, depthWrite: false,
  }));
  pill.renderOrder = 7;
  group.add(pill);

  const tailGeometry = new THREE.BufferGeometry();
  const trailPositions = new THREE.BufferAttribute(new Float32Array(TAIL_POINTS * 2 * 3), 3);
  const strengths = new THREE.BufferAttribute(new Float32Array(TAIL_POINTS * 2), 1);
  for (let i = 0; i < strengths.count; i++) strengths.setX(i, 1 - (i % TAIL_POINTS) / TAIL_POINTS);
  tailGeometry.setAttribute("position", trailPositions);
  tailGeometry.setAttribute("aStrength", strengths);
  const tail = new THREE.Points(tailGeometry, new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 } },
    vertexShader: `
      attribute float aStrength;
      uniform float uPixelRatio;
      varying float vStrength;
      void main() {
        vStrength = aStrength;
        gl_PointSize = (4.0 + 19.0 * aStrength * aStrength) * uPixelRatio;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float vStrength;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float halo = pow(max(0.0, 1.0 - radius), 1.6) * 0.72;
        float core = 1.0 - smoothstep(0.26, 0.38, radius);
        vec3 colour = mix(vec3(1.0, 0.62, 0.22), vec3(1.0, 0.98, 0.81), core);
        gl_FragColor = vec4(colour, (halo + core * 0.9) * vStrength);
      }
    `,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  }));
  tail.renderOrder = 6;
  tail.frustumCulled = false;
  group.add(tail);

  const point = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let route: DoseRoute | undefined;
  let position = 0;
  let target = 0;

  return {
    anchor(id: DoseRoute) {
      return segments.get(id)!.anchor;
    },
    setRoute(id: DoseRoute | undefined, fraction: number, immediate: boolean) {
      if (route !== id) {
        if (route) for (const line of segments.get(route)!.lines) line.visible = false;
        if (id) for (const line of segments.get(id)!.lines) line.visible = true;
        route = id;
        immediate = true;
      }
      target = THREE.MathUtils.clamp(fraction, 0, 1);
      if (immediate || target === 1) position = target;
    },
    render(dt: number, pixelRatio: number, modelReady: boolean) {
      group.visible = modelReady && route !== undefined;
      if (!modelReady || !route) return;
      const { curves } = segments.get(route)!;
      position = THREE.MathUtils.damp(position, target, 29, dt);
      pill.visible = route === "swallow";
      tail.visible = !pill.visible;
      if (pill.visible) {
        curves[0].getPointAt(position, pill.position);
        pill.quaternion.setFromUnitVectors(up, curves[0].getTangentAt(position, tangent));
        return;
      }
      tail.material.uniforms.uPixelRatio.value = pixelRatio;
      tailGeometry.setDrawRange(0, curves.length * TAIL_POINTS);
      for (const [track, curve] of curves.entries()) {
        for (let i = 0; i < TAIL_POINTS; i++) {
          curve.getPointAt(Math.max(0, position - i * 0.019), point);
          trailPositions.setXYZ(track * TAIL_POINTS + i, point.x, point.y, point.z);
        }
      }
      trailPositions.needsUpdate = true;
    },
    dispose() {
      group.traverse((node) => {
        if (node instanceof THREE.Line || node instanceof THREE.Mesh || node instanceof THREE.Points) {
          node.geometry.dispose();
        }
      });
      lineMaterial.dispose();
      pill.material.dispose();
      tail.material.dispose();
      group.removeFromParent();
    },
  };
}
