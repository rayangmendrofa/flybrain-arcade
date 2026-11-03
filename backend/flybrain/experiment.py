# FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
# Built on the Drosophila whole-brain model of Shiu et al. (2024):
# https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
"""Validated, bounded experiment configuration ("Sugar, Spikes & Silence").

FlyWire root IDs are int64 values above 2**53, so they travel as strings in
JSON to avoid silent precision loss in JavaScript.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Engine = Literal["numba-port", "brian2-reference", "synthetic"]

# Bounds. Upstream/paper sugar GRN activation range is 10-200 Hz (Fig. 1d);
# 0 Hz is allowed as a no-stimulus control.
RATE_MIN_HZ, RATE_MAX_HZ = 0.0, 200.0
DURATION_MIN_MS, DURATION_MAX_MS = 100, 2000
MAX_TRIALS = {"numba-port": 30, "brian2-reference": 3, "synthetic": 30}
MAX_DURATION_MS = {"numba-port": 2000, "brian2-reference": 1000, "synthetic": 2000}
MAX_SILENCED = 200


class StimulusConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: Literal["sugar_grns"] = Field(
        "sugar_grns", description="Verified upstream group: 21 labellar sugar GRNs (synthetic engine: 12 synthetic sensory neurons)")
    rate_hz: float = Field(100.0, ge=RATE_MIN_HZ, le=RATE_MAX_HZ, description="Poisson rate per target neuron (upstream r_poi)")
    onset_ms: float = Field(0.0, ge=0.0, description="Stimulation onset within the trial")
    offset_ms: float | None = Field(None, ge=0.0, description="Stimulation offset; null = end of trial (upstream protocol)")


class ExperimentConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine: Engine = "numba-port"
    duration_ms: int = Field(1000, ge=DURATION_MIN_MS, le=DURATION_MAX_MS)
    seed: int = Field(1, ge=0, le=2**31 - 1)
    n_trials: int = Field(5, ge=1, le=30)
    stimulus: StimulusConfig = StimulusConfig()
    silenced_ids: list[str] = Field(default_factory=list, max_length=MAX_SILENCED)
    rate_window_ms: tuple[float, float] | None = Field(
        None, description="Firing-rate measurement window [start, end) in ms; null = whole trial (upstream get_rate)")

    @field_validator("silenced_ids")
    @classmethod
    def _ids_numeric_unique(cls, v: list[str]) -> list[str]:
        out = []
        for s in v:
            s = s.strip()
            if not (s.isdigit() or (s.startswith("SYN-") and s[4:].isdigit())):
                raise ValueError(f"Not a neuron ID: {s!r}")
            if s not in out:
                out.append(s)
        return out

    @model_validator(mode="after")
    def _check(self) -> "ExperimentConfig":
        if self.n_trials > MAX_TRIALS[self.engine]:
            raise ValueError(f"{self.engine} supports at most {MAX_TRIALS[self.engine]} trials per run")
        if self.duration_ms > MAX_DURATION_MS[self.engine]:
            raise ValueError(f"{self.engine} supports at most {MAX_DURATION_MS[self.engine]} ms per run")
        off = self.stim_offset_ms
        if not (0 <= self.stimulus.onset_ms < off <= self.duration_ms):
            raise ValueError("Stimulus window must satisfy 0 <= onset < offset <= duration")
        if self.engine == "brian2-reference" and (self.stimulus.onset_ms != 0 or off != self.duration_ms):
            raise ValueError("brian2-reference runs the unmodified upstream protocol: stimulation must span the whole trial")
        if self.rate_window_ms is not None:
            a, b = self.rate_window_ms
            if not (0 <= a < b <= self.duration_ms):
                raise ValueError("Rate window must satisfy 0 <= start < end <= duration")
        if self.engine != "synthetic" and any(s.startswith("SYN-") for s in self.silenced_ids):
            raise ValueError("Synthetic neuron IDs can only be used with the synthetic engine")
        if self.engine == "synthetic" and any(not s.startswith("SYN-") for s in self.silenced_ids):
            raise ValueError("The synthetic engine only has synthetic neurons (SYN-…)")
        return self

    @property
    def stim_offset_ms(self) -> float:
        return float(self.duration_ms if self.stimulus.offset_ms is None else self.stimulus.offset_ms)

    @property
    def window_ms(self) -> tuple[float, float]:
        return self.rate_window_ms or (0.0, float(self.duration_ms))

    def matched_for_comparison(self, other: "ExperimentConfig") -> list[str]:
        """Fields that must be equal between a baseline and an intervention."""
        diffs = []
        for f in ("engine", "duration_ms", "seed", "n_trials", "stimulus", "rate_window_ms"):
            if getattr(self, f) != getattr(other, f):
                diffs.append(f)
        return diffs
