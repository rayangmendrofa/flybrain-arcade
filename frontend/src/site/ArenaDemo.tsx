import { lazy, Suspense, useEffect, useState } from "react";
import type { Arena3DEpisode } from "../components/Arena3D";
import { siteData } from "./data";

const Arena3D = lazy(() => import("../components/Arena3D"));

/** Hybrid demonstration on the showcase page: the two precomputed episodes. */
export function ArenaDemo({ reducedMotion }: { reducedMotion: boolean }) {
  const [eps, setEps] = useState<Arena3DEpisode[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([siteData.arena("intact"), siteData.arena("roundup_silenced")])
      .then(([a, b]) =>
        setEps([
          { key: "intact", label: "Intact model", tone: "base", ep: a },
          { key: "roundup", label: "Roundup silenced", tone: "int", ep: b },
        ]),
      )
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);
  if (err) return <p className="error">Could not load the arena episodes: {err}</p>;
  if (!eps) return <p className="note">Loading…</p>;
  return (
    <Suspense fallback={<p className="note">Loading…</p>}>
      <Arena3D episodes={eps} reducedMotion={reducedMotion} />
    </Suspense>
  );
}
