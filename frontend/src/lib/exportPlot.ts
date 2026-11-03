// FlyBrain Arcade by rayan (gelastinta.com). MIT licence, see LICENSE.
// Built on the Drosophila whole-brain model of Shiu et al. (2024):
// https://github.com/philshiu/Drosophila_brain_model (MIT, (c) 2023 Philip Shiu and Nico Spiller).
/** Export an on-screen SVG chart as a standalone SVG or PNG file. */

const EXPORT_STYLE = `
  text { font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif; fill: #e7e9f3; }
  .axis line, .axis path { stroke: #8b91ad; }
  .grid line { stroke: #2b3150; }
`;

function serialize(svg: SVGSVGElement, title: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const { width, height } = svg.getBoundingClientRect();
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(width)));
  clone.setAttribute("height", String(Math.round(height)));
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = EXPORT_STYLE;
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#12152a");
  const t = document.createElementNS("http://www.w3.org/2000/svg", "title");
  t.textContent = title;
  clone.insertBefore(bg, clone.firstChild);
  clone.insertBefore(style, clone.firstChild);
  clone.insertBefore(t, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportSvg(svg: SVGSVGElement | null, filename: string, title: string) {
  if (!svg) return;
  downloadBlob(new Blob([serialize(svg, title)], { type: "image/svg+xml" }), filename + ".svg");
}

export function exportPng(svg: SVGSVGElement | null, filename: string, title: string, scale = 2) {
  if (!svg) return;
  const text = serialize(svg, title);
  const { width, height } = svg.getBoundingClientRect();
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = Math.round(width * scale);
    c.height = Math.round(height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    c.toBlob((b) => b && downloadBlob(b, filename + ".png"), "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
}
