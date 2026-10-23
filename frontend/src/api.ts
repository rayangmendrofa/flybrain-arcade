import type { Comparison, ExperimentConfig, Job, NeuronGroup, Raster, ReplayMeta, RunSummary, Status } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const body = await r.json();
      msg = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  status: () => req<Status>("/api/status"),
  groups: () => req<{ silencing_groups: NeuronGroup[]; all_cell_types: NeuronGroup[]; synthetic_groups: NeuronGroup[]; note: string }>("/api/neurons/groups"),
  lookup: (id: string) => req<{ found: boolean; id: string; name?: string | null; cell_type?: string | null }>(`/api/neurons/lookup?id=${encodeURIComponent(id)}`),
  baseline: (cfg: ExperimentConfig) => req<Job>("/api/baseline", { method: "POST", body: JSON.stringify(cfg) }),
  intervention: (baseline_run_id: string, silenced_ids: string[]) =>
    req<Job>("/api/intervention", { method: "POST", body: JSON.stringify({ baseline_run_id, silenced_ids }) }),
  job: (id: string) => req<Job>(`/api/jobs/${id}`),
  cancel: (id: string) => req<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  run: (id: string) => req<RunSummary>(`/api/runs/${id}`),
  raster: (id: string, trial: number) => req<Raster>(`/api/runs/${id}/raster?trial=${trial}`),
  compare: (b: string, i: string) => req<Comparison>(`/api/compare?baseline=${b}&intervention=${i}`),
  replays: () => req<ReplayMeta[]>("/api/replays"),
  loadReplay: (name: string) => req<{ meta: ReplayMeta; runs: { baseline?: string; intervention?: string } }>(`/api/replays/${name}/load`, { method: "POST" }),
};

export const exportUrl = (runId: string, name: string) => `/api/runs/${runId}/export/${name}`;
export const compareExportUrl = (b: string, i: string) => `/api/compare/export.json?baseline=${b}&intervention=${i}`;

/** Poll a job until it finishes. Polling cadence never touches the simulation itself. */
export async function waitForJob(id: string, onUpdate: (j: Job) => void, signal: { stopped: boolean }): Promise<Job> {
  for (;;) {
    const j = await api.job(id);
    onUpdate(j);
    if (j.status === "done" || j.status === "error" || j.status === "cancelled") return j;
    if (signal.stopped) return j;
    await new Promise((r) => setTimeout(r, 300));
  }
}
