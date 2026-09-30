// Демо-фото букетов для съёмки (иллюстрации, не фото реальных заказов): SVG → PNG через sharp.
import fs from "node:fs"
import path from "node:path"
import sharp from "sharp"

const PALETTES = {
  tender: { bg: "#fbeff1", flowers: ["#f7c6d0", "#fbe3e8", "#f29fb5", "#ffffff", "#f5b3c4"], paper: "#e9d9c6", ribbon: "#d98ca3" },
  sunny: { bg: "#fdf5e4", flowers: ["#ffd166", "#ffb347", "#ffe08a", "#ff9f5a", "#fff3c4"], paper: "#e6d3b3", ribbon: "#e07b39" },
  classic: { bg: "#f6ecec", flowers: ["#c9283e", "#a61b2f", "#e04a5f", "#b3203a", "#8f1428"], paper: "#2f2f2f", ribbon: "#c9283e" },
}

function rose(cx, cy, r, color) {
  const petals = [1, 0.74, 0.5, 0.28]
    .map((k, i) => `<circle cx="${cx + (i % 2 ? 1 : -1) * r * 0.04}" cy="${cy - r * 0.03 * i}" r="${r * k}" fill="${color}" stroke="rgba(0,0,0,0.08)" stroke-width="${r * 0.05}"/>`)
    .join("")
  const swirl = `<path d="M ${cx - r * 0.35} ${cy} q ${r * 0.35} ${-r * 0.5} ${r * 0.6} ${-r * 0.05} q ${-r * 0.1} ${r * 0.35} ${-r * 0.45} ${r * 0.25}" fill="none" stroke="rgba(0,0,0,0.12)" stroke-width="${r * 0.06}" stroke-linecap="round"/>`
  return petals + swirl
}

function leaf(x, y, angle, len, color = "#7fa38a") {
  return `<ellipse cx="${x}" cy="${y}" rx="${len * 0.22}" ry="${len * 0.5}" fill="${color}" transform="rotate(${angle} ${x} ${y})"/>`
}

export function bouquetSvg(paletteName, size = 900) {
  const p = PALETTES[paletteName]
  const c = size / 2
  const flowers = []
  const spots = [
    [0, -0.1, 0.13], [-0.19, -0.02, 0.11], [0.19, -0.04, 0.115], [-0.1, -0.24, 0.1], [0.11, -0.25, 0.105],
    [-0.28, -0.18, 0.085], [0.29, -0.2, 0.09], [0, -0.33, 0.085], [-0.05, 0.08, 0.1], [0.14, 0.1, 0.09], [-0.2, 0.12, 0.085],
  ]
  spots.forEach(([dx, dy, k], i) => flowers.push(rose(c + dx * size, c + dy * size, k * size, p.flowers[i % p.flowers.length])))
  const leaves = [
    leaf(c - 0.34 * size, c - 0.02 * size, -55, 0.2 * size), leaf(c + 0.35 * size, c - 0.05 * size, 50, 0.2 * size),
    leaf(c - 0.3 * size, c - 0.3 * size, -30, 0.16 * size, "#94b59c"), leaf(c + 0.3 * size, c - 0.33 * size, 28, 0.16 * size, "#94b59c"),
    leaf(c, c - 0.43 * size, 0, 0.14 * size, "#6d937a"),
  ].join("")
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="100%" height="100%" fill="${p.bg}"/>
  <g transform="translate(${c} ${c}) scale(0.86) translate(${-c} ${-c + 0.05 * size})">
  <circle cx="${c}" cy="${c - 0.08 * size}" r="${0.42 * size}" fill="rgba(255,255,255,0.45)"/>
  ${leaves}
  <path d="M ${c - 0.36 * size} ${c + 0.02 * size} L ${c} ${c + 0.47 * size} L ${c + 0.36 * size} ${c + 0.02 * size} Z" fill="${p.paper}"/>
  ${flowers.join("")}
  <path d="M ${c - 0.3 * size} ${c + 0.08 * size} L ${c} ${c + 0.47 * size} L ${c + 0.3 * size} ${c + 0.08 * size} L ${c + 0.16 * size} ${c + 0.2 * size} L ${c - 0.16 * size} ${c + 0.2 * size} Z" fill="${p.paper}" opacity="0.92"/>
  <path d="M ${c - 0.07 * size} ${c + 0.28 * size} q ${0.07 * size} ${0.05 * size} ${0.14 * size} 0" stroke="${p.ribbon}" stroke-width="${0.025 * size}" fill="none" stroke-linecap="round"/>
  <circle cx="${c}" cy="${c + 0.3 * size}" r="${0.022 * size}" fill="${p.ribbon}"/>
  </g>
</svg>`
}

export async function writeBouquetPng(paletteName, file, size = 900) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await sharp(Buffer.from(bouquetSvg(paletteName, size))).png().toFile(file)
  return file
}

export const PALETTE_NAMES = Object.keys(PALETTES)
