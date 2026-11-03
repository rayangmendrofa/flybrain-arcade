import { useEffect, useRef, useState } from "react";
import type { BrainActivity, BrainAtlas } from "../lib/brainData";
import { FlyScene, type ViewMode } from "../three/scene";

export const MODEL_URL = `${import.meta.env.BASE_URL}models/housefly.glb`;

export interface Fly3DProps {
  extension: number;
  stimOn: boolean;
  simT: number;
  atlas: BrainAtlas | null;
  activity: BrainActivity | null;
  view: ViewMode;
  overlay: boolean;
  reducedMotion: boolean;
  label: string;
  onScene?: (s: FlyScene | null) => void;
}

/** three.js stage. All state comes in through props; the scene only draws it. */
export default function Fly3D(props: Fly3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FlyScene | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!host.current) return;
    let s: FlyScene;
    try {
      s = new FlyScene(host.current, { modelUrl: MODEL_URL, reducedMotion: props.reducedMotion });
    } catch {
      setStatus("error");
      return;
    }
    sceneRef.current = s;
    props.onScene?.(s);
    if (import.meta.env.DEV) (window as unknown as { __flyScene?: FlyScene }).__flyScene = s;
    s.loaded.then(() => setStatus("ready")).catch(() => setStatus("error"));
    return () => {
      props.onScene?.(null);
      sceneRef.current = null;
      s.dispose();
    };
    // the scene is created once; props are pushed in by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => sceneRef.current?.setExtension(props.extension), [props.extension]);
  useEffect(() => sceneRef.current?.setStim(props.stimOn), [props.stimOn]);
  useEffect(() => sceneRef.current?.setBrain(props.atlas), [props.atlas]);
  useEffect(() => {
    sceneRef.current?.setActivity(props.activity);
    sceneRef.current?.setSimTime(props.simT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.activity, props.atlas]);
  useEffect(() => sceneRef.current?.setSimTime(props.simT), [props.simT]);
  useEffect(() => sceneRef.current?.setView(props.view), [props.view]);
  useEffect(() => sceneRef.current?.setDriverOverlay(props.overlay), [props.overlay]);

  return (
    <div className="fly3d" ref={host} role="img" aria-label={props.label}>
      {status === "loading" && <div className="fly3d-msg">Loading 3D fly…</div>}
      {status === "error" && <div className="fly3d-msg">The 3D view could not start (WebGL unavailable or model failed to load). Switch to the 2D cartoon.</div>}
    </div>
  );
}
