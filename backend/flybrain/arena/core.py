"""Hybrid embodied arena: environment, sensory encoder, output decoder, movement controller.

    environment -> sensory encoder -> neural model -> output decoder -> movement

Only the *neural model* box is the published Shiu et al. model. Everything else
here is an application-specific assumption, written down in ``INTERFACES``
(served to the UI) and docs/arena.md. The published model has no walking,
steering, vision or learning; steering and walking come from a handcrafted
controller. No learning happens anywhere in this module.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field

CONTROL_DT_S = 0.05  # control/update interval (simulated seconds) for all interfaces
ARENA_W_MM, ARENA_H_MM = 120.0, 80.0

# app-defined constants (all shown in the UI)
DECODER_TAU_S = 0.10  # smoothing of decoded MN9 rate
DECODER_R0_HZ, DECODER_R1_HZ = 5.0, 100.0  # same ramp as the fly animation
FEED_GATE = 0.25  # extension above which the controller stops to "feed" (proboscis-extension gate)
CONSUME_PER_S = 0.08  # patch amount removed per second at full extension
TURN_NOISE = 1.2  # rad / sqrt(s)
LOOKAHEAD_MM = 5.0
MAX_TURN_RATE = 4.0  # rad/s for obstacle avoidance


class ArenaConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine: Literal["numba-port", "synthetic"] = "numba-port"
    layout: Literal["two_patches", "obstacle_course", "single_patch"] = "two_patches"
    duration_s: float = Field(10.0, ge=1.0, le=30.0)
    seed: int = Field(1, ge=0, le=2**31 - 1)
    grn_max_rate_hz: float = Field(100.0, ge=0.0, le=200.0)
    decoder: Literal["mn9", "none"] = Field("mn9", description="'none' = controller-only control condition (no neural input)")
    walk_speed_mm_s: float = Field(12.0, ge=1.0, le=30.0)
    silenced_ids: list[str] = Field(default_factory=list, max_length=200)


@dataclass
class Patch:
    x: float
    y: float
    r: float
    amount: float  # 0..1 'sugar concentration' of the cue, depletes while feeding

    def contains(self, x: float, y: float) -> bool:
        return (x - self.x) ** 2 + (y - self.y) ** 2 <= self.r**2


@dataclass
class Obstacle:
    x: float
    y: float
    w: float
    h: float

    def contains(self, x: float, y: float, pad: float = 0.0) -> bool:
        return self.x - pad <= x <= self.x + self.w + pad and self.y - pad <= y <= self.y + self.h + pad


@dataclass
class Layout:
    patches: list[Patch]
    obstacles: list[Obstacle]
    start: tuple[float, float, float]  # x, y (mm), heading (rad)


def make_layout(name: str) -> Layout:
    if name == "single_patch":
        return Layout([Patch(70, 40, 9, 1.0)], [], (20, 40, 0.0))
    if name == "obstacle_course":
        return Layout([Patch(100, 18, 8, 1.0), Patch(98, 64, 8, 0.6)],
                      [Obstacle(40, 0, 6, 50), Obstacle(72, 30, 6, 50)], (15, 65, -0.3))
    return Layout([Patch(40, 30, 9, 1.0), Patch(90, 55, 9, 0.5)], [Obstacle(62, 5, 5, 28)], (12, 60, -0.4))


# --------------------------------------------------------------------------- environment

def cue_at(layout: Layout, x: float, y: float) -> tuple[int, float]:
    """Contact food cue: (patch index or -1, concentration 0..1). Taste is contact-based, so no gradient."""
    for k, p in enumerate(layout.patches):
        if p.contains(x, y):
            return k, p.amount
    return -1, 0.0


def blocked(layout: Layout, x: float, y: float, pad: float = 1.5) -> bool:
    if not (pad <= x <= ARENA_W_MM - pad and pad <= y <= ARENA_H_MM - pad):
        return True
    return any(o.contains(x, y, pad) for o in layout.obstacles)


# --------------------------------------------------------------------------- encoder / decoder

def encode(concentration: float, max_rate_hz: float) -> float:
    """Sensory encoder: Poisson rate (Hz) applied to each of the stimulated GRNs for the next window."""
    return max_rate_hz * float(np.clip(concentration, 0.0, 1.0))


@dataclass
class Decoder:
    smoothed_hz: float = 0.0

    def update(self, spikes_in_window: int, window_s: float) -> tuple[float, float, float]:
        rate = spikes_in_window / window_s
        a = 1.0 - math.exp(-window_s / DECODER_TAU_S)
        self.smoothed_hz += (rate - self.smoothed_hz) * a
        ext = min(1.0, max(0.0, (self.smoothed_hz - DECODER_R0_HZ) / (DECODER_R1_HZ - DECODER_R0_HZ)))
        return rate, self.smoothed_hz, ext


# --------------------------------------------------------------------------- controller (handcrafted)

@dataclass
class Controller:
    rng: np.random.Generator
    x: float
    y: float
    heading: float
    walk_speed: float
    log: dict = field(default_factory=dict)

    def step(self, layout: Layout, extension: float, dt: float) -> dict:
        """Handcrafted walking/steering. The neural model only enters through ``extension``."""
        feeding = extension > FEED_GATE
        speed = 0.0 if feeding else self.walk_speed * (1.0 - extension)
        noise_turn = TURN_NOISE * math.sqrt(dt) * float(self.rng.standard_normal())
        avoid_turn = 0.0
        ax = self.x + LOOKAHEAD_MM * math.cos(self.heading)
        ay = self.y + LOOKAHEAD_MM * math.sin(self.heading)
        if blocked(layout, ax, ay):
            free = []
            for d in (math.pi / 4, -math.pi / 4, math.pi / 2, -math.pi / 2):
                h = self.heading + d
                if not blocked(layout, self.x + LOOKAHEAD_MM * math.cos(h), self.y + LOOKAHEAD_MM * math.sin(h)):
                    free.append(d)
            d = free[0] if free else math.pi
            avoid_turn = math.copysign(min(abs(d), MAX_TURN_RATE * dt), d) if free else MAX_TURN_RATE * dt
        if not feeding:
            self.heading = (self.heading + noise_turn + avoid_turn + math.pi) % (2 * math.pi) - math.pi
        nx = self.x + speed * dt * math.cos(self.heading)
        ny = self.y + speed * dt * math.sin(self.heading)
        collided = blocked(layout, nx, ny, pad=0.5)
        if collided:
            self.heading = (self.heading + (math.pi / 2 if self.rng.random() < 0.5 else -math.pi / 2)) % (2 * math.pi)
        else:
            self.x, self.y = nx, ny
        return {"speed": 0.0 if collided else speed, "feeding": feeding, "noise_turn": noise_turn,
                "avoid_turn": avoid_turn, "collided": collided}


# --------------------------------------------------------------------------- interface documentation

def interfaces(engine: str, decoder: str) -> list[dict]:
    synth = engine == "synthetic"
    inputs = "12 synthetic sensory neurons (SYN-0…11)" if synth else "the 21 labellar sugar GRNs listed in upstream example.ipynb (FlyWire v630 IDs)"
    output = "synthetic output A (SYN-399)" if synth else "MN9, FlyWire v630 ID 720575940660219265 (upstream Fig. 1 readout)"
    return [
        {"name": "Environment", "from": "arena", "to": "sensory encoder",
         "variables": [{"name": "position x, y", "unit": "mm", "rate": f"every {CONTROL_DT_S*1000:.0f} ms"},
                       {"name": "food-cue concentration c of the patch under the fly", "unit": "0–1 (dimensionless)", "rate": f"every {CONTROL_DT_S*1000:.0f} ms"}],
         "neurons": "—",
         "equations": "c = patch.amount if the fly's centre is inside a patch (contact cue), else 0; patch.amount decreases by "
                      f"{CONSUME_PER_S}·e·Δt while the fly feeds",
         "provenance": "application assumption (arena, patches, obstacles, contact-only cue, depletion)"},
        {"name": "Sensory encoder", "from": "environment", "to": "neural model",
         "variables": [{"name": "Poisson rate r_in per stimulated neuron", "unit": "Hz", "rate": f"held constant for each {CONTROL_DT_S*1000:.0f} ms window"}],
         "neurons": inputs,
         "equations": "r_in = r_max · c, r_max set by the user (0–200 Hz); delivered with the upstream PoissonInput mechanism "
                      "(Bernoulli(r_in·dt) per 0.1 ms step, kick w_syn·f_poi = 68.75 mV to v)",
         "provenance": "GRN IDs and Poisson activation mechanism: published (upstream); linear concentration→rate map: application assumption"},
        {"name": "Neural model", "from": "sensory encoder", "to": "output decoder",
         "variables": [{"name": "spikes of all neurons", "unit": "events", "rate": "dt = 0.1 ms integration (unchanged)"}],
         "neurons": "whole network" + (" (synthetic 400-neuron demo)" if synth else " — all 127,400 FlyWire v630 neurons, continuous state across windows"),
         "equations": "upstream LIF model (see Model provenance); optional silencing = upstream silence()",
         "provenance": "SYNTHETIC network" if synth else "published model (Shiu et al. 2024), Numba port validated against Brian2"},
        {"name": "Output decoder", "from": "neural model", "to": "movement",
         "variables": [{"name": "MN9 spike count n in window → rate n/Δt", "unit": "Hz", "rate": f"every {CONTROL_DT_S*1000:.0f} ms"},
                       {"name": "proboscis-extension signal e", "unit": "0–1", "rate": f"every {CONTROL_DT_S*1000:.0f} ms"}],
         "neurons": output if decoder == "mn9" else "none (controller-only control condition: e = 0)",
         "equations": f"s ← s + (n/Δt − s)(1 − exp(−Δt/{DECODER_TAU_S}s)); e = clamp((s − {DECODER_R0_HZ:g})/({DECODER_R1_HZ:g} − {DECODER_R0_HZ:g}), 0, 1)",
         "provenance": "choice of MN9 as feeding-related output: published; smoothing, ramp and thresholds: application assumption"},
        {"name": "Movement", "from": "output decoder", "to": "environment",
         "variables": [{"name": "speed", "unit": "mm/s", "rate": f"every {CONTROL_DT_S*1000:.0f} ms"},
                       {"name": "heading", "unit": "rad", "rate": f"every {CONTROL_DT_S*1000:.0f} ms"}],
         "neurons": "none — no neuron drives walking or steering",
         "equations": f"feeding if e > {FEED_GATE}: speed = 0; else speed = v_walk·(1 − e). Heading: random walk "
                      f"(σ = {TURN_NOISE} rad/√s) + obstacle avoidance (look-ahead {LOOKAHEAD_MM} mm, ≤ {MAX_TURN_RATE} rad/s)",
         "provenance": "HANDCRAFTED CONTROLLER (application assumption). The published model does not supply walking or steering."},
    ]
