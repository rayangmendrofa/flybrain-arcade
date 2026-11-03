// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { exportPng, exportSvg } from "../lib/exportPlot";

export type Category = "data" | "model" | "app";

export const CATEGORY: Record<Category, { label: string; long: string; glyph: string }> = {
  data: { label: "DATA", long: "Measured connectivity & annotations", glyph: "◆" },
  model: { label: "MODEL", long: "Simulated neural activity (under model assumptions)", glyph: "∿" },
  app: { label: "APP", long: "Application-defined mapping (sensory, animation, motor)", glyph: "✎" },
};

export function CategoryTag({ cat, compact = false }: { cat: Category; compact?: boolean }) {
  const c = CATEGORY[cat];
  return (
    <span className={`cat cat-${cat}`} title={c.long}>
      <span aria-hidden="true">{c.glyph}</span> {compact ? c.label : `${c.label} · ${c.long}`}
    </span>
  );
}

export function Panel(props: {
  title: string;
  cats: Category[];
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <section className={`panel ${props.className ?? ""}`} aria-labelledby={props.id ? `${props.id}-h` : undefined} id={props.id}>
      <header className="panel-head">
        <h2 id={props.id ? `${props.id}-h` : undefined}>{props.title}</h2>
        <div className="panel-cats">
          {props.cats.map((c) => (
            <CategoryTag key={c} cat={c} compact />
          ))}
        </div>
        {props.actions && <div className="panel-actions">{props.actions}</div>}
      </header>
      {props.children}
    </section>
  );
}

export function PlotExport({ svgRef, name, title }: { svgRef: RefObject<SVGSVGElement | null>; name: string; title: string }) {
  return (
    <span className="btn-row small">
      <button type="button" className="btn ghost" onClick={() => exportSvg(svgRef.current, name, title)} aria-label={`Export ${title} as SVG`}>
        SVG
      </button>
      <button type="button" className="btn ghost" onClick={() => exportPng(svgRef.current, name, title)} aria-label={`Export ${title} as PNG`}>
        PNG
      </button>
    </span>
  );
}

/** Width of an element, updated on resize. */
export function useWidth<T extends HTMLElement>(fallback = 600): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setW(Math.max(240, Math.floor(width)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function usePrefersReducedMotion(): boolean {
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

export const fmt = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "—" : x.toFixed(d));
export const shortId = (id: string) => (id.length > 10 ? `…${id.slice(-6)}` : id);
