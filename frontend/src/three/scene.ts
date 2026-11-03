// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { ArenaWorld, arenaPose, type ArenaEpisode, type ArenaPose } from "./arenaWorld";
import { BrainCloud, type BrainActivity, type BrainAtlas } from "./brain";
import { footOffset, LEGS, PHASE_OFFSET, stepFrequency, type LegId } from "./gait";
import { rigLegs, setFootOffsets, type LegRig } from "./legs";
import { Proboscis, proboscisPose } from "./proboscis";

/**
 * The supplied mesh's body axis is turned ~34.6 degrees from +z (measured from the eye and abdomen
 * vertex colours) and it stands pitched nose-down by ~4 degrees (its six feet are 0-0.067 units above
 * the floor). Step 1 turns and shifts it so the head faces +z on the midline; step 2 levels it by
 * rotating the least-squares plane through the six lowest foot points to horizontal, then drops it
 * onto y = 0. Remaining foot heights (up to ~0.03) are closed by the leg rig (legs.ts).
 */
export const MODEL_ALIGN = {
  rotY: 0.6032,
  offsetX: 0.025,
  footPlaneNormal: new THREE.Vector3(0.02323, 0.99718, 0.0714),
  dropY: -0.039,
};
const LEVEL = new THREE.Quaternion().setFromUnitVectors(MODEL_ALIGN.footPlaneNormal.clone().normalize(), new THREE.Vector3(0, 1, 0));
const level = (v: THREE.Vector3) => v.applyQuaternion(LEVEL).add(new THREE.Vector3(0, MODEL_ALIGN.dropY, 0));

/** Anatomical anchors, measured on the turned mesh (step 1) and carried through the levelling (step 2). See docs/visualisation.md. */
export const ANCHORS = {
  mouth: level(new THREE.Vector3(0, 0.218, 0.39)),
  headCenter: level(new THREE.Vector3(0, 0.31, 0.38)),
  headWidth: 0.23, // eye-to-eye, used to size the brain cloud inside the head
  proboscisScale: 0.12,
};

export type ViewMode = "fly" | "brain";

export interface SceneOptions {
  modelUrl: string;
  reducedMotion: boolean;
  preserveDrawingBuffer?: boolean;
  background?: string;
}

const CAMS: Record<ViewMode, { pos: THREE.Vector3; target: THREE.Vector3 }> = {
  fly: { pos: new THREE.Vector3(1.0, 0.6, 1.2), target: new THREE.Vector3(0, 0.2, 0.08) },
  brain: { pos: new THREE.Vector3(0.21, 0.4, 0.66), target: ANCHORS.headCenter.clone() },
};

export const DRIVER_COLORS = { model: new THREE.Color("#f6c945"), app: new THREE.Color("#f472b6") };

export class FlyScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
  readonly controls: OrbitControls;
  readonly flyRoot = new THREE.Group(); // moves in the arena; the body sits in here
  readonly body = new THREE.Group();
  readonly proboscis: Proboscis;
  private flyMaterial: THREE.MeshStandardMaterial | null = null;
  private xray: THREE.ShaderMaterial = makeXrayMaterial();
  private xrayMeshes: THREE.Mesh[] = [];
  private drop = new THREE.Group(); // sugar cube with a syrup drop on top
  private dropMat: THREE.MeshStandardMaterial;
  private brainGroup = new THREE.Group();
  brain: BrainCloud | null = null;
  private view: ViewMode = "fly";
  private viewK = 0; // 0 = fly, 1 = brain (animated)
  private viewTarget = 0;
  private dirty = true;
  private raf = 0;
  private lastFrame = 0;
  private disposed = false;
  private ro: ResizeObserver;
  private ground: THREE.Mesh;
  legRig: LegRig | null = null;
  private key: THREE.DirectionalLight;
  private arena: ArenaWorld | null = null;
  private arenaPhase: Float32Array | null = null; // cumulative gait phase at each control window
  private followOffset = new THREE.Vector3(2.6, 4.4, -4.8);
  private driverOverlay = false;
  onFrame: ((dtS: number) => boolean) | null = null; // return true to keep animating
  loaded: Promise<void>;

  constructor(readonly container: HTMLElement, readonly opts: SceneOptions) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.className = "fly3d-canvas";
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(opts.background ?? "#0d1124");

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2235, 1.1));
    const key = (this.key = new THREE.DirectionalLight(0xffffff, 2.3));
    key.position.set(1.6, 2.4, 1.4);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = key.shadow.camera.bottom = -1.2;
    key.shadow.camera.right = key.shadow.camera.top = 1.2;
    key.shadow.bias = -0.0005;
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 1.2);
    rim.position.set(-1.5, 1.2, -1.8);
    this.scene.add(rim);

    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(3, 64).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1a1f3d, roughness: 0.95 }),
    );
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.dropMat = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.55, emissive: 0x3aa0ff, emissiveIntensity: 0 });
    this.proboscis = new Proboscis(ANCHORS.proboscisScale);
    this.proboscis.root.position.copy(ANCHORS.mouth);
    this.body.add(this.proboscis.root);
    // food: a sugar cube whose top meets the fully extended labellum, with a syrup drop on top
    this.proboscis.setPose(proboscisPose(1));
    this.body.updateMatrixWorld(true);
    const tip = this.proboscis.tipWorld();
    this.proboscis.setPose(proboscisPose(0));
    const h = Math.max(0.02, tip.y - 0.032);
    const cube = new THREE.Mesh(new RoundedBoxGeometry(0.1, h, 0.1, 3, 0.008), new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.85 }));
    cube.position.y = h / 2;
    cube.castShadow = cube.receiveShadow = true;
    const dropGeo = new THREE.SphereGeometry(0.028, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    dropGeo.scale(1.3, 0.55, 1.3);
    const syrup = new THREE.Mesh(dropGeo, this.dropMat);
    syrup.position.y = h;
    this.drop.add(cube, syrup);
    this.drop.position.set(tip.x, 0, tip.z);
    this.body.add(this.drop);
    this.brainGroup.position.copy(ANCHORS.headCenter);
    this.body.add(this.brainGroup);
    this.flyRoot.add(this.body);
    this.scene.add(this.flyRoot);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !opts.reducedMotion;
    this.controls.minDistance = 0.2;
    this.controls.maxDistance = 4;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener("change", () => this.requestRender());
    this.applyCamera(0);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.loaded = this.loadModel(opts.modelUrl);
  }

  private async loadModel(url: string): Promise<void> {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url);
    if (this.disposed) return;
    this.flyMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.58, metalness: 0.0 });
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) meshes.push(o);
    });
    for (const o of meshes) {
      // gltfpack copies the OBJ's sRGB vertex colours into COLOR_0, which glTF defines as linear
      const col = o.geometry.getAttribute("color");
      if (col) {
        const c = new THREE.Color();
        const lin = new Float32Array(col.count * 3);
        for (let i = 0; i < col.count; i++) {
          c.setRGB(col.getX(i), col.getY(i), col.getZ(i), THREE.SRGBColorSpace);
          lin[i * 3] = c.r;
          lin[i * 3 + 1] = c.g;
          lin[i * 3 + 2] = c.b;
        }
        o.geometry.setAttribute("color", new THREE.BufferAttribute(lin, 3));
      }
      o.material = this.flyMaterial!;
      o.castShadow = true;
      o.receiveShadow = true;
      // see-through outline for the "inside the head" view, sharing the same geometry
      const x = new THREE.Mesh(o.geometry, this.xray);
      x.visible = false;
      x.renderOrder = 5;
      o.add(x);
      this.xrayMeshes.push(x);
    }
    const aligned = new THREE.Group();
    aligned.rotation.y = MODEL_ALIGN.rotY;
    aligned.position.x = MODEL_ALIGN.offsetX;
    aligned.add(gltf.scene);
    const levelled = new THREE.Group();
    levelled.quaternion.copy(LEVEL);
    levelled.position.y = MODEL_ALIGN.dropY;
    levelled.add(aligned);
    this.body.add(levelled);
    // legs that can step (arena only); the depth material gets the same bend for correct shadows
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    this.legRig = rigLegs(meshes[0], this.body, [this.flyMaterial, depth]);
    meshes[0].customDepthMaterial = depth;
    this.requestRender();
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updatePointScale();
    this.requestRender();
  }

  setSize(w: number, h: number): void {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updatePointScale();
  }

  private updatePointScale(): void {
    if (!this.brain) return;
    const h = this.renderer.domElement.height;
    this.brain.setViewport(h, this.camera.fov, 0.0032);
  }

  // ------------------------------------------------------------- state setters

  setExtension(e: number): void {
    this.proboscis.setPose(proboscisPose(e));
    this.requestRender();
  }

  setStim(on: boolean, visible = true): void {
    this.drop.visible = visible;
    this.dropMat.emissiveIntensity = on ? 0.9 : 0;
    this.dropMat.opacity = on ? 0.8 : 0.45;
    this.requestRender();
  }

  setBrain(atlas: BrainAtlas | null): void {
    if (this.brain) {
      this.brainGroup.remove(this.brain.points);
      this.brain.dispose();
      this.brain = null;
    }
    if (atlas) {
      // fit the Drosophila brain's width (incl. optic lobes) to ~90% of the head width
      const s = (ANCHORS.headWidth * 0.9) / atlas.sizeUm[0];
      this.brain = new BrainCloud(atlas, s);
      this.brainGroup.add(this.brain.points);
      this.updatePointScale();
      this.applyView();
    }
    this.requestRender();
  }

  setActivity(a: BrainActivity | null): void {
    this.brain?.setActivity(a);
    this.requestRender();
  }

  setSimTime(tMs: number): void {
    this.brain?.setTime(tMs);
    this.requestRender();
  }

  setDriverOverlay(on: boolean): void {
    this.driverOverlay = on;
    if (this.legRig) this.legRig.uniforms.uLegTint.value = on && this.arena ? 0.55 : 0;
    for (const m of this.proboscis.materials) {
      m.emissive.copy(on ? DRIVER_COLORS.model : new THREE.Color(0));
      m.emissiveIntensity = on ? 0.55 : 0;
    }
    this.requestRender();
  }

  get overlayOn(): boolean {
    return this.driverOverlay;
  }

  setView(v: ViewMode, animate = !this.opts.reducedMotion): void {
    this.view = v;
    this.viewTarget = v === "brain" ? 1 : 0;
    if (!animate) {
      this.viewK = this.viewTarget;
      this.applyView();
      this.applyCamera(this.viewK);
    }
    this.requestRender();
  }

  get currentView(): ViewMode {
    return this.view;
  }

  private applyView(): void {
    const k = this.viewK;
    if (this.flyMaterial) {
      // solid body fades out while an x-ray outline (rim-lit edges only) fades in
      const op = 1 - smooth(0.12, 0.6, k);
      this.flyMaterial.transparent = op < 0.999;
      this.flyMaterial.opacity = op;
      this.flyMaterial.depthWrite = op > 0.5;
      this.flyMaterial.visible = op > 0.001;
      const xr = smooth(0.25, 0.7, k);
      this.xray.uniforms.uOpacity.value = xr;
      for (const m of this.xrayMeshes) m.visible = xr > 0.001;
    }
    this.brain?.setOpacity(smooth(0.3, 0.75, k));
  }

  private orbitYaw = 0;

  /** Extra camera yaw around the current target (scripted camera moves for the video). */
  setOrbit(yaw: number): void {
    this.orbitYaw = yaw;
    this.applyCamera(this.viewK);
    this.requestRender();
  }

  private applyCamera(k: number): void {
    const s = k * k * (3 - 2 * k);
    this.camera.position.lerpVectors(CAMS.fly.pos, CAMS.brain.pos, s);
    this.controls.target.lerpVectors(CAMS.fly.target, CAMS.brain.target, s);
    if (this.orbitYaw) {
      const off = this.camera.position.clone().sub(this.controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.orbitYaw);
      this.camera.position.copy(this.controls.target).add(off);
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /** Move the orbit camera with the fly (arena follow-cam), keeping the user's chosen angle and distance. */
  follow(target: THREE.Vector3, _prev?: THREE.Vector3): void {
    const delta = target.clone().sub(this.controls.target);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.controls.update();
    this.requestRender();
  }

  // ------------------------------------------------------------- arena (hybrid demonstration)

  setArena(ep: ArenaEpisode | null): void {
    if (this.arena) {
      this.scene.remove(this.arena.group);
      this.arena.dispose();
      this.arena = null;
      this.arenaPhase = null;
    }
    this.ground.visible = !ep;
    this.drop.visible = !ep;
    if (ep) {
      this.arena = new ArenaWorld(ep);
      this.scene.add(this.arena.group);
      // gait phase = integral of step frequency over time, so any frame can be drawn on its own
      const r = ep.record;
      const ph = new Float32Array(r.t_s.length + 1);
      for (let k = 0; k < r.t_s.length; k++) ph[k + 1] = ph[k] + stepFrequency(r.speed[k] / 2.5) * ep.control_dt_s;
      this.arenaPhase = ph;
      this.setArenaTime(0, true);
    } else {
      this.flyRoot.position.set(0, 0, 0);
      this.flyRoot.rotation.set(0, 0, 0);
      this.key.position.set(1.6, 2.4, 1.4);
      this.key.target.position.set(0, 0, 0);
      if (this.legRig) setFootOffsets(this.legRig, restOffsets());
      this.applyCamera(this.viewK);
    }
    this.setDriverOverlay(this.driverOverlay);
    this.requestRender();
  }

  /**
   * Draw the arena at simulated time t (s). With `bodyFrozen` the APP-driven parts (walking, turning,
   * legs) stay still and only the model-driven proboscis moves.
   */
  setArenaTime(t: number, snapCamera = false, bodyFrozen = false): ArenaPose | null {
    if (!this.arena || !this.arenaPhase) return null;
    const ep = this.arena.ep;
    const pose = arenaPose(ep, bodyFrozen ? 0 : t);
    const live = arenaPose(ep, t);
    const prev = this.flyRoot.position.clone();
    this.flyRoot.position.set(pose.x, 0, pose.z);
    this.flyRoot.rotation.y = pose.yaw;
    // the shadow-casting light travels with the fly so its shadow stays sharp
    this.key.position.set(pose.x + 1.6, 2.4, pose.z + 1.4);
    this.key.target.position.set(pose.x, 0, pose.z);
    this.arena.update(live);
    this.setExtension(live.extension);
    if (this.legRig) {
      const dt = ep.control_dt_s;
      const f = Math.min(this.arenaPhase.length - 1, Math.max(0, t / dt));
      const k = Math.floor(f);
      const phase = bodyFrozen ? 0 : this.arenaPhase[k] + (this.arenaPhase[Math.min(k + 1, this.arenaPhase.length - 1)] - this.arenaPhase[k]) * (f - k);
      const fr = stepFrequency(pose.speedBl);
      const stride = bodyFrozen || fr === 0 ? 0 : (pose.speedBl * BODY_UNITS_PER_BL) / fr;
      const offs = {} as Record<LegId, { dz: number; dy: number }>;
      for (const l of LEGS) offs[l] = footOffset(phase + PHASE_OFFSET[l], stride);
      setFootOffsets(this.legRig, offs);
    }
    if (snapCamera) {
      this.controls.target.set(pose.x, 0.25, pose.z);
      this.camera.position.copy(this.controls.target).add(this.followOffset);
      this.controls.update();
    } else {
      this.follow(this.flyRoot.position.clone().setY(0.25), prev);
    }
    this.requestRender();
    return live;
  }

  // ------------------------------------------------------------- render loop

  requestRender(): void {
    this.dirty = true;
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(t: number): void {
    this.raf = 0;
    const dt = this.lastFrame ? Math.min(0.1, (t - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = t;
    let again = false;
    if (this.viewK !== this.viewTarget) {
      const step = dt / 1.4;
      this.viewK = this.viewTarget > this.viewK ? Math.min(this.viewTarget, this.viewK + step) : Math.max(this.viewTarget, this.viewK - step);
      this.applyView();
      this.applyCamera(this.viewK);
      again = true;
    }
    if (this.onFrame?.(dt)) again = true;
    if (this.controls.enableDamping && this.controls.update()) again = true;
    if (this.dirty || again) {
      this.renderer.render(this.scene, this.camera);
      this.dirty = false;
    }
    if (again) this.requestRender();
    else this.lastFrame = 0;
  }

  /** Synchronous render (video capture). */
  renderNow(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Jump the camera/view transition to a given progress (deterministic video frames). */
  setViewProgress(k: number): void {
    this.viewK = this.viewTarget = Math.min(1, Math.max(0, k));
    this.view = this.viewK > 0.5 ? "brain" : "fly";
    this.applyView();
    this.applyCamera(this.viewK);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.brain?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

function makeXrayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vC;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vC = color;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vC;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
        vec3 col = mix(vec3(0.45, 0.55, 0.9), vC * 1.6 + 0.15, 0.35);
        float a = (0.025 + 0.42 * rim) * uOpacity;
        gl_FragColor = vec4(col * a, a);
      }
    `,
  });
}

const BODY_UNITS_PER_BL = 0.86;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function restOffsets(): Record<LegId, { dz: number; dy: number }> {
  const o = {} as Record<LegId, { dz: number; dy: number }>;
  for (const l of LEGS) o[l] = { dz: 0, dy: 0 };
  return o;
}
