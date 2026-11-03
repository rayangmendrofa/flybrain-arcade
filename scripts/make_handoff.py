"""Pack the project's key files into upload-ready zips for other chats (see docs/HANDOFF.md).

Writes handoff/1-content-and-science.zip, 2-website-data-and-assets.zip, 3-visualisation-code.zip
and 4-simulation-backend.zip. Each zip includes docs/HANDOFF.md. The 33 MB video is not zipped;
upload frontend/site/public/media/flybrain-story.mp4 on its own.

Usage: python scripts/make_handoff.py
"""

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "handoff"

BUNDLES: dict[str, list[str]] = {
    "1-content-and-science": [
        "README.md", "NOTICE.md", "docs/*.md",
        "frontend/src/site/Site.tsx", "frontend/src/site/story.ts", "frontend/src/site/site.css",
    ],
    "2-website-data-and-assets": [
        "frontend/site/public/data/**/*", "frontend/public/models/*",
        "frontend/site/public/media/*.jpg", "replays/**/*",
    ],
    "3-visualisation-code": [
        "frontend/src/three/*", "frontend/src/lib/*", "frontend/src/site/*",
        "frontend/src/components/Arena3D.tsx", "frontend/src/components/arena3d.css",
        "frontend/src/components/Fly3D.tsx", "frontend/src/components/FlyStage.tsx",
        "frontend/site/index.html", "frontend/site/main.tsx", "frontend/vite.site.config.ts",
        "frontend/package.json", "frontend/tsconfig.json", "frontend/scripts/*",
        "docs/visualisation.md",
    ],
    "4-simulation-backend": [
        "backend/flybrain/**/*.py", "backend/flybrain/data/*", "backend/requirements.txt",
        "backend/tests/*.py", "scripts/*.py", "pytest.ini",
        "docs/model.md", "docs/assumptions.md", "docs/validation.md", "docs/arena.md",
        "docs/performance.md", "docs/validation/*",
    ],
}


def main() -> None:
    OUT.mkdir(exist_ok=True)
    missing_data = not (ROOT / "frontend/site/public/data/manifest.json").exists()
    for name, patterns in BUNDLES.items():
        files = sorted({p for pat in patterns for p in ROOT.glob(pat) if p.is_file() and "__pycache__" not in p.parts})
        files = list(dict.fromkeys(files + [ROOT / "docs/HANDOFF.md"]))
        dest = OUT / f"{name}.zip"
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files:
                z.write(f, f"flybrain-arcade/{f.relative_to(ROOT).as_posix()}")
        print(f"{dest.relative_to(ROOT)}  {len(files)} files  {dest.stat().st_size / 1e6:.1f} MB")
    video = ROOT / "frontend/site/public/media/flybrain-story.mp4"
    print(f"video (upload separately): {video.relative_to(ROOT)}"
          + (f"  {video.stat().st_size / 1e6:.1f} MB" if video.exists() else "  MISSING: render it in the studio"))
    if missing_data:
        sys.exit("website data missing: run scripts/export_site_data.py first")


if __name__ == "__main__":
    main()
