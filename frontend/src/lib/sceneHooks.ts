// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { useEffect, useRef, useState, type RefObject } from "react";
import { FlyScene } from "../three/scene";

export const MODEL_URL = `${import.meta.env.BASE_URL}models/housefly.glb`;

/** Creates a FlyScene inside the referenced element once it is near the viewport. */
export function useFlyScene(ref: RefObject<HTMLDivElement | null>, reducedMotion: boolean, preserveDrawingBuffer = false) {
  const [scene, setScene] = useState<FlyScene | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let s: FlyScene | null = null;
    let disposed = false;
    const start = () => {
      if (s || disposed) return;
      try {
        s = new FlyScene(el, { modelUrl: MODEL_URL, reducedMotion, preserveDrawingBuffer });
      } catch {
        setState("error");
        return;
      }
      setState("loading");
      setScene(s);
      if (import.meta.env.DEV) ((window as unknown as { __scenes?: FlyScene[] }).__scenes ??= []).push(s);
      s.loaded.then(() => !disposed && setState("ready")).catch(() => !disposed && setState("error"));
    };
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && start(), { rootMargin: "300px" });
    io.observe(el);
    return () => {
      disposed = true;
      io.disconnect();
      s?.dispose();
      setScene(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { scene, state };
}

/**
 * Playback clock mapping wall-clock time to simulated time. Display only: the results were
 * computed beforehand. `speed` = simulated ms per wall-clock ms.
 */
export function usePlayback(durationMs: number, speed: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tRef = useRef(0);
  tRef.current = t;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    if (tRef.current >= durationMs) setT(0);
    const tick = (now: number) => {
      const dt = Math.min(100, now - last);
      last = now;
      const nt = Math.min(durationMs, tRef.current + dt * speed);
      setT(nt);
      if (nt >= durationMs) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, durationMs]);
  return { t, setT, playing, setPlaying };
}

export function useReducedMotion(): boolean {
  const q = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const [v, setV] = useState(q?.matches ?? false);
  useEffect(() => {
    if (!q) return;
    const h = () => setV(q.matches);
    q.addEventListener("change", h);
    return () => q.removeEventListener("change", h);
  }, [q]);
  return v;
}
