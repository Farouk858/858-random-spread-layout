import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/**
 * 858 Random Spread Layout — full app
 * - non-overlapping layout with spacing controls
 * - editorial layouts (spaced / seamless)
 * - random sizes / shuffle / pack / snap bottom / scatter boards
 * - background colour picker with favourites (shared)
 * - overlay system: multiple shapes + custom image/SVG as shapes
 * - save/load full presets (file + localStorage) + internal overlay saves
 * - exports PNG/JPG/ZIP with distortion-free cover maths
 * - manual preview zoom (not responsive)
 */

// ====== App Config ======
const MAX_BOARDS = 20;
const DEFAULT_W = 1080;   // width
const DEFAULT_H = 1320;   // height
const DEFAULT_BOARDS = 6;

// ====== Utilities ======
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rng = (min, max) => min + Math.random() * (max - min);

function intersectRect(ax, ay, aw, ah, bx, by, bw, bh) {
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  return { x: x1, y: y1, w, h };
}

const rectsOverlapWithMargin = (a, b, margin) => {
  return !(
    a.x + a.w + margin <= b.x ||
    b.x + b.w + margin <= a.x ||
    a.y + a.h + margin <= b.y ||
    b.y + b.h + margin <= a.y
  );
};

// Image loader
function useImageElement(src) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!src) return;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.src = src;
  }, [src]);
  return img;
}

// ====== Shared Colour Favourites ======
const FAV_KEY = "a58_color_favs";
function loadFavs() {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (!raw) return ["#000000", "#ffffff", "#00ff00", "#ff00ff", "#00ffff"];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? arr.slice(0, 12) : ["#000000", "#ffffff"];
  } catch {
    return ["#000000", "#ffffff"];
  }
}
function saveFavs(arr) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(arr.slice(0, 12))); } catch {}
}

function ColorPicker({ label, value, onChange }) {
  const [favs, setFavs] = useState(loadFavs());
  const addFav = () => {
    if (!value) return;
    const next = Array.from(new Set([value, ...favs])).slice(0, 12);
    setFavs(next);
    saveFavs(next);
  };
  const removeFav = (c) => {
    const next = favs.filter(x => x !== c);
    setFavs(next);
    saveFavs(next);
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      {label && <label style={{ fontSize: 12, opacity: .8 }}>{label}</label>}
      <input type="color" value={value || "#000000"} onChange={e => onChange(e.target.value)} style={{ width: 40, height: 28, padding: 0, border: "1px solid #333", background: "transparent" }} />
      <button className="btn" onClick={addFav} title="Add to favourites">★</button>
      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
        {favs.map(c => (
          <span key={c} title="Click to use, alt-click to remove"
            onClick={(e) => e.altKey ? removeFav(c) : onChange(c)}
            style={{
              width: 18, height: 18, borderRadius: 3,
              border: "1px solid #444", background: c, cursor: "pointer"
            }} />
        ))}
      </div>
    </div>
  );
}

// ====== Overlay Shapes ======
// types: 'rect', 'roundRect', 'circle', 'triangle', 'line', 'plus', 'cross', 'bar', 'image'
function drawShape(ctx, s) {
  ctx.save();
  ctx.globalAlpha = clamp(s.opacity ?? 1, 0, 1);
  if (s.type !== "image") ctx.fillStyle = s.fill || "#00ff00";
  ctx.translate(s.x, s.y);
  ctx.rotate(((s.rot || 0) * Math.PI) / 180);

  if (s.type === "rect") {
    ctx.fillRect(0, 0, s.w, s.h);
  } else if (s.type === "roundRect") {
    const r = clamp(s.r || 12, 0, Math.min(s.w, s.h) / 2);
    const p = new Path2D();
    p.moveTo(r, 0);
    p.arcTo(s.w, 0, s.w, s.h, r);
    p.arcTo(s.w, s.h, 0, s.h, r);
    p.arcTo(0, s.h, 0, 0, r);
    p.arcTo(0, 0, s.w, 0, r);
    p.closePath();
    ctx.fill(p);
  } else if (s.type === "circle") {
    ctx.beginPath();
    ctx.arc(s.w / 2, s.h / 2, Math.min(s.w, s.h) / 2, 0, Math.PI * 2);
    ctx.fill();
  } else if (s.type === "triangle") {
    ctx.beginPath();
    ctx.moveTo(s.w / 2, 0);
    ctx.lineTo(s.w, s.h);
    ctx.lineTo(0, s.h);
    ctx.closePath();
    ctx.fill();
  } else if (s.type === "line") {
    ctx.strokeStyle = s.fill || "#00ff00";
    ctx.lineWidth = s.h || 4;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s.w, 0);
    ctx.stroke();
  } else if (s.type === "plus" || s.type === "cross") {
    const thick = Math.max(2, s.thick || 8);
    const horiz = { x: 0, y: (s.h - thick) / 2, w: s.w, h: thick };
    const vert = { x: (s.w - thick) / 2, y: 0, w: thick, h: s.h };
    if (s.type === "plus") {
      ctx.fillRect(horiz.x, horiz.y, horiz.w, horiz.h);
      ctx.fillRect(vert.x, vert.y, vert.w, vert.h);
    } else {
      // cross is a plus rotated 45deg
      ctx.translate(s.w/2, s.h/2);
      ctx.rotate(Math.PI/4);
      ctx.translate(-s.w/2, -s.h/2);
      ctx.fillRect(horiz.x, horiz.y, horiz.w, horiz.h);
      ctx.fillRect(vert.x, vert.y, vert.w, vert.h);
    }
  } else if (s.type === "bar") {
    const bars = Math.max(1, s.count || 12);
    const gap = Math.max(2, s.gap || 24);
    for (let i = 0; i < bars; i++) {
      const bx = (i * gap) % s.w;
      ctx.fillRect(bx, 0, Math.max(2, s.barWidth || 8), s.h);
    }
  } else if (s.type === "image" && s._img) {
    ctx.drawImage(s._img, 0, 0, s.w, s.h);
  }
  ctx.restore();
}

// ====== Export: cover-math draw ops per board ======
function cropOpsForBoard(images, boardIndex, BOARD_W, BOARD_H) {
  const boardX = boardIndex * BOARD_W;
  const ops = [];
  for (const n of images) {
    const img = n._imageEl;
    if (!img || !img.naturalWidth || !img.naturalHeight) continue;

    // COVER fit for the preview box (n.x,y,w,h)
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const scale = Math.max(n.w / iw, n.h / ih); // cover
    const renderW = iw * scale;
    const renderH = ih * scale;
    const ox = n.x + (n.w - renderW) / 2; // image origin in spread space
    const oy = n.y + (n.h - renderH) / 2;

    const inter = intersectRect(ox, oy, renderW, renderH, boardX, 0, BOARD_W, BOARD_H);
    if (!inter) continue;

    // Map visible region back to natural image pixels
    const sx = Math.max(0, Math.min(iw, (inter.x - ox) / scale));
    const sy = Math.max(0, Math.min(ih, (inter.y - oy) / scale));
    const sw = Math.max(0, Math.min(iw - sx, inter.w / scale));
    const sh = Math.max(0, Math.min(ih - sy, inter.h / scale));

    // Destination on the board canvas
    const dx = inter.x - boardX;
    const dy = inter.y;
    const dw = inter.w;
    const dh = inter.h;

    ops.push({ img, sx, sy, sw, sh, dx, dy, dw, dh });
  }
  return ops;
}

// ====== Draggable/Resizable Image Node ======
function ImageNode({ node, selected, onSelect, onChange }) {
  const ref = useRef(null);
  const imgEl = useImageElement(node.src);

  useEffect(() => {
    if (imgEl && node._imageEl !== imgEl) onChange({ ...node, _imageEl: imgEl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl]);

  // drag
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;
    const onDown = (e) => {
      if (e.target.closest("[data-handle]") || e.button === 2) return;
      dragging = true;
      const p = e.touches?.[0] || e;
      startX = p.clientX; startY = p.clientY;
      originX = node.x; originY = node.y;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      onSelect();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const p = e.touches?.[0] || e;
      const dx = p.clientX - startX; const dy = p.clientY - startY;
      onChange({ ...node, x: originX + dx, y: originY + dy });
    };
    const onUp = () => {
      dragging = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointerdown", onDown);
    return () => el.removeEventListener("pointerdown", onDown);
  }, [node, onChange, onSelect]);

  // resize
  const startResize = (dir, e) => {
    e.stopPropagation();
    const p0 = e.touches?.[0] || e;
    const sx = p0.clientX; const sy = p0.clientY;
    const init = { x: node.x, y: node.y, w: node.w, h: node.h };
    const onMove = (ev) => {
      const p = ev.touches?.[0] || ev;
      const dx = p.clientX - sx; const dy = p.clientY - sy;
      let { x, y, w, h } = init;
      if (dir.includes("e")) w = clamp(init.w + dx, 20, 99999);
      if (dir.includes("s")) h = clamp(init.h + dy, 20, 99999);
      if (dir.includes("w")) { w = clamp(init.w - dx, 20, 99999); x = init.x + dx; }
      if (dir.includes("n")) { h = clamp(init.h - dy, 20, 99999); y = init.y + dy; }
      onChange({ ...node, x, y, w, h });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const style = {
    position: "absolute",
    left: node.x,
    top: node.y,
    width: node.w,
    height: node.h,
    transform: `rotate(${node.rotation || 0}deg)`,
    transformOrigin: "top left",
    cursor: "grab",
    userSelect: "none",
    boxShadow: selected ? "0 0 0 1px #00ff88 inset" : "none"
  };

  return (
    <div ref={ref} style={style} onClick={onSelect}>
      {imgEl ? (
        <img src={node.src} alt="" draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#222" }} />
      )}
      {selected && (
        <>
          {[
            ["nw", 0, 0],
            ["ne", "100%", 0],
            ["sw", 0, "100%"],
            ["se", "100%", "100%"],
          ].map(([dir, l, t]) => (
            <span key={dir} data-handle onPointerDown={(e) => startResize(dir, e)}
              style={{
                position: "absolute",
                left: typeof l === "number" ? l - 6 : l,
                top: typeof t === "number" ? t - 6 : t,
                width: 12, height: 12, background: "white", border: "1px solid #000", borderRadius: 2,
                transform: typeof l === "string" || typeof t === "string" ? "translate(-50%, -50%)" : undefined,
                cursor: `${dir}-resize`,
              }} />
          ))}
        </>
      )}
    </div>
  );
}

// ====== App ======
export default function App() {
  // board / spread
  const [BOARD_W, setBoardW] = useState(DEFAULT_W);
  const [BOARD_H, setBoardH] = useState(DEFAULT_H);
  const [boards, setBoards] = useState(DEFAULT_BOARDS);
  const SPREAD_W = useMemo(() => boards * BOARD_W, [boards, BOARD_W]);
  const SPREAD_H = BOARD_H;

  // preview zoom (manual)
  const [previewScale, setPreviewScale] = useState(0.6);

  // layout / export
  const [spacing, setSpacing] = useState(24);
  const [pixelRatio, setPixelRatio] = useState(2);
  const [bgColor, setBgColor] = useState("#000000"); // preview + export
  const [exportBgMode, setExportBgMode] = useState("color"); // "color" or "transparent"

  // nodes
  const [images, setImages] = useState([]); // {id, src, x,y,w,h, rotation, _imageEl}
  const [selectedId, setSelectedId] = useState(null);

  // overlay
  const [showOverlay, setShowOverlay] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(0.25);
  const [overlayFillA, setOverlayFillA] = useState("#39ff14");
  const [overlayFillB, setOverlayFillB] = useState("#39ff14");
  const [shapes, setShapes] = useState([]); // overlay objects

  // refs
  const spreadRef = useRef(null);
  const contentRef = useRef(null);

  // ===== drag & drop images =====
  const onDropFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    const readAsDataURL = (file) => new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

    const newNodes = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const src = await readAsDataURL(f);
      const id = uid();
      // start smaller then random-size later
      const w = Math.floor(BOARD_W * 0.28);
      const h = Math.floor(w * rng(0.65, 1.2));
      newNodes.push({ id, src, x: 40, y: 40, w, h, rotation: 0 });
    }
    setImages((prev) => [...prev, ...newNodes]);
  }, [BOARD_W]);

  // ====== layouts ======
  const randomSizes = useCallback(() => {
    setImages(prev => prev.map(n => {
      const w = Math.floor(rng(BOARD_W * 0.22, BOARD_W * 0.6));
      const h = Math.floor(w * rng(0.6, 1.1));
      return { ...n, w, h };
    }));
  }, [BOARD_W]);

  const randomiseLayout = useCallback(() => {
    const placed = [];
    const attemptPlace = (node) => {
      const maxTries = 400;
      // keep existing size
      const w = node.w; const h = node.h;
      for (let t = 0; t < maxTries; t++) {
        const x = Math.floor(Math.random() * Math.max(1, SPREAD_W - w));
        const y = Math.floor(Math.random() * Math.max(1, SPREAD_H - h));
        const candidate = { ...node, x, y, w, h };
        const overlap = placed.some((p) => rectsOverlapWithMargin(candidate, p, spacing));
        if (!overlap) { placed.push(candidate); return candidate; }
      }
      // fallback scan
      for (let y = 0; y <= SPREAD_H - h; y += Math.max(8, spacing)) {
        let found = false;
        for (let x = 0; x <= SPREAD_W - w; x += Math.max(8, spacing)) {
          const c = { ...node, x, y };
          if (!placed.some((p) => rectsOverlapWithMargin(c, p, spacing))) { placed.push(c); found = true; break; }
        }
        if (found) break;
      }
      return placed[placed.length - 1] || node;
    };
    setImages((prev) => prev.map((n) => attemptPlace(n)));
  }, [SPREAD_W, SPREAD_H, spacing]);

  const shuffleOrder = useCallback(() => {
    setImages(prev => {
      const a = [...prev];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    });
  }, []);

  const packLayout = useCallback(() => {
    const sorted = [...images].sort((a, b) => b.w * b.h - a.w * a.h);
    const placed = [];
    const scan = (node) => {
      for (let y = 0; y <= SPREAD_H - node.h; y += Math.max(8, spacing)) {
        for (let x = 0; x <= SPREAD_W - node.w; x += Math.max(8, spacing)) {
          const c = { ...node, x, y };
          if (!placed.some((p) => rectsOverlapWithMargin(c, p, spacing))) { placed.push(c); return c; }
        }
      }
      placed.push(node); return node;
    };
    const result = sorted.map(scan);
    setImages(result);
  }, [images, SPREAD_W, SPREAD_H, spacing]);

  // “Snap Bottom”: push every node down to rest on something below (or the board bottom)
  const snapBottom = useCallback(() => {
    setImages(prev => prev.map(n => {
      let maxY = SPREAD_H - n.h;
      prev.forEach(o => {
        if (o === n) return;
        const verticalAligned = (n.x + n.w > o.x) && (o.x + o.w > n.x); // overlapping in x
        if (verticalAligned && o.y > n.y) {
          maxY = Math.min(maxY, o.y - n.h - spacing);
        }
      });
      return { ...n, y: clamp(maxY, 0, SPREAD_H - n.h) };
    }));
  }, [SPREAD_H, spacing]);

  // “Pack Bottom”: columnar layout to bottom
  const packBottom = useCallback(() => {
    const cols = Math.max(2, Math.floor(SPREAD_W / Math.max(220, BOARD_W * 0.28)));
    const colW = SPREAD_W / cols;
    const colHeights = Array(cols).fill(0);
    setImages(prev => {
      const sorted = [...prev]; // keep order
      return sorted.map(n => {
        const c = colHeights.indexOf(Math.min(...colHeights));
        const x = Math.floor(c * colW + (colW - n.w) / 2);
        const y = Math.floor(colHeights[c]);
        colHeights[c] += n.h + spacing;
        return { ...n, x: clamp(x, 0, SPREAD_W - n.w), y: clamp(y, 0, SPREAD_H - n.h) };
      });
    });
  }, [SPREAD_W, SPREAD_H, BOARD_W, spacing]);

  // Editorial side-by-side (spaced)
  const editorialSpaced = useCallback(() => {
    const gutter = spacing;
    const columns = Math.max(2, Math.floor(SPREAD_W / (BOARD_W * 0.9)));
    const colW = (SPREAD_W - (columns - 1) * gutter) / columns;
    const yTrack = Array(columns).fill(0);
    setImages(prev => {
      const a = [...prev];
      return a.map(n => {
        const w = colW; const h = Math.max(120, w * rng(0.6, 0.75));
        const c = yTrack.indexOf(Math.min(...yTrack));
        const x = Math.floor(c * (colW + gutter));
        const y = Math.floor(yTrack[c]);
        yTrack[c] += h + gutter;
        return { ...n, x, y, w, h };
      });
    });
  }, [SPREAD_W, spacing, BOARD_W]);

  // Editorial seamless (edge-to-edge columns)
  const editorialSeamless = useCallback(() => {
    const columns = Math.max(2, Math.floor(SPREAD_W / (BOARD_W * 0.9)));
    const colW = SPREAD_W / columns;
    const yTrack = Array(columns).fill(0);
    const gutter = 0;
    setImages(prev => {
      const a = [...prev];
      return a.map(n => {
        const w = colW; const h = Math.max(120, w * rng(0.6, 0.75));
        const c = yTrack.indexOf(Math.min(...yTrack));
        const x = Math.floor(c * (colW + gutter));
        const y = Math.floor(yTrack[c]);
        yTrack[c] += h + gutter;
        return { ...n, x, y, w, h };
      });
    });
  }, [SPREAD_W, BOARD_W]);

  // First-page hero: 3 images — wide on top, two smaller bottom (edge to edge)
  const firstPageHero = useCallback(() => {
    setImages(prev => {
      if (prev.length < 3) return prev;
      const top = prev[0], left = prev[1], right = prev[2];
      const topH = Math.floor(BOARD_H * 0.45);
      const botH = BOARD_H - topH;
      const botW = Math.floor(BOARD_W / 2);
      const updated = [...prev];
      updated[0] = { ...top, x: 0, y: 0, w: BOARD_W, h: topH };
      updated[1] = { ...left, x: 0, y: topH, w: botW, h: botH };
      updated[2] = { ...right, x: botW, y: topH, w: BOARD_W - botW, h: botH };
      return updated;
    });
  }, [BOARD_W, BOARD_H]);

  // ====== overlay shapes ======
  const regenShapes = useCallback((kind = "bar") => {
    if (!showOverlay) setShowOverlay(true);
    const out = [];
    const total = Math.max(18, Math.floor((SPREAD_W * SPREAD_H) / 180000));
    for (let i = 0; i < total; i++) {
      const t = kind === "random"
        ? ["rect","roundRect","circle","triangle","line","plus","cross","bar"][Math.floor(Math.random()*8)]
        : kind;
      const w = Math.floor(rng(8, BOARD_W * 0.12));
      const h = Math.floor(rng(48, BOARD_H * 0.32));
      out.push({
        id: uid(),
        type: t,
        x: Math.floor(rng(0, SPREAD_W - w)),
        y: Math.floor(rng(0, SPREAD_H - h)),
        w, h,
        fill: (i % 2 === 0) ? overlayFillA : overlayFillB,
        opacity: overlayOpacity,
        rot: (t === "line" || t === "bar") ? 0 : Math.floor(rng(0, 360)),
        r: 12,
        thick: 8,
        count: 14, gap: 48, barWidth: 10
      });
    }
    setShapes(out);
  }, [SPREAD_W, SPREAD_H, BOARD_W, BOARD_H, overlayFillA, overlayFillB, overlayOpacity, showOverlay]);

  const toggleOverlay = () => setShowOverlay(s => !s);

  // upload custom shape image/SVG
  const onUploadShape = async (file) => {
    if (!file) return;
    const url = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.onload = () => {
      const w = Math.min(img.naturalWidth, BOARD_W * 0.4);
      const h = Math.min(img.naturalHeight, BOARD_H * 0.4);
      setShapes(prev => [...prev, {
        id: uid(), type: "image", x: 20, y: 20, w, h, _img: img, opacity: overlayOpacity
      }]);
      if (!showOverlay) setShowOverlay(true);
    };
    img.src = url;
  };

  // ====== save / load (presets + overlay sets) ======
  const presetDownload = () => {
    const minimalShapes = shapes.map(s => {
      const copy = { ...s };
      delete copy._img; // not serialising raw Image
      return copy;
    });
    const data = {
      version: 3,
      boards, BOARD_W, BOARD_H, spacing, pixelRatio,
      bgColor, exportBgMode,
      images, // src + geometry
      overlay: { showOverlay, overlayOpacity, overlayFillA, overlayFillB, shapes: minimalShapes }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "spread_preset.json";
    a.click();
  };

  const presetLoad = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (typeof data.BOARD_W === "number") setBoardW(clamp(data.BOARD_W, 200, 6000));
        if (typeof data.BOARD_H === "number") setBoardH(clamp(data.BOARD_H, 200, 6000));
        if (typeof data.boards === "number") setBoards(clamp(data.boards, 1, MAX_BOARDS));
        if (typeof data.spacing === "number") setSpacing(clamp(data.spacing, 0, 300));
        if (typeof data.pixelRatio === "number") setPixelRatio(clamp(data.pixelRatio, 1, 4));
        if (typeof data.bgColor === "string") setBgColor(data.bgColor);
        if (data.exportBgMode) setExportBgMode(data.exportBgMode);
        if (Array.isArray(data.images)) setImages(data.images);
        if (data.overlay) {
          setShowOverlay(!!data.overlay.showOverlay);
          if (typeof data.overlay.overlayOpacity === "number") setOverlayOpacity(data.overlay.overlayOpacity);
          if (data.overlay.overlayFillA) setOverlayFillA(data.overlay.overlayFillA);
          if (data.overlay.overlayFillB) setOverlayFillB(data.overlay.overlayFillB);
          if (Array.isArray(data.overlay.shapes)) setShapes(data.overlay.shapes);
        }
      } catch { alert("Invalid preset JSON"); }
    };
    r.readAsText(file);
  };

  // LocalStorage quick slots
  const LS_PRESETS = "a58_presets";
  const savePresetSlot = () => {
    const name = prompt("Preset name:");
    if (!name) return;
    const raw = localStorage.getItem(LS_PRESETS);
    const list = raw ? JSON.parse(raw) : {};
    const minimalShapes = shapes.map(s => { const c = { ...s }; delete c._img; return c; });
    list[name] = {
      boards, BOARD_W, BOARD_H, spacing, pixelRatio, bgColor, exportBgMode,
      images, overlay: { showOverlay, overlayOpacity, overlayFillA, overlayFillB, shapes: minimalShapes }
    };
    localStorage.setItem(LS_PRESETS, JSON.stringify(list));
  };
  const loadPresetSlot = () => {
    const raw = localStorage.getItem(LS_PRESETS);
    const list = raw ? JSON.parse(raw) : {};
    const names = Object.keys(list);
    if (!names.length) return alert("No local presets yet.");
    const pick = prompt("Load which preset?\n" + names.join(", "));
    if (!pick || !list[pick]) return;
    const p = list[pick];
    setBoardW(p.BOARD_W); setBoardH(p.BOARD_H); setBoards(p.boards);
    setSpacing(p.spacing); setPixelRatio(p.pixelRatio);
    setBgColor(p.bgColor); setExportBgMode(p.exportBgMode);
    setImages(p.images || []);
    if (p.overlay) {
      setShowOverlay(!!p.overlay.showOverlay);
      setOverlayOpacity(p.overlay.overlayOpacity ?? 0.25);
      setOverlayFillA(p.overlay.overlayFillA || "#39ff14");
      setOverlayFillB(p.overlay.overlayFillB || "#39ff14");
      setShapes(p.overlay.shapes || []);
    }
  };

  // Overlay internal saves
  const LS_OVERLAYS = "a58_overlay_sets";
  const saveOverlaySet = () => {
    const name = prompt("Overlay set name:");
    if (!name) return;
    const raw = localStorage.getItem(LS_OVERLAYS);
    const list = raw ? JSON.parse(raw) : {};
    const minimal = shapes.map(s => { const c = { ...s }; delete c._img; return c; });
    list[name] = { shapes: minimal, overlayOpacity, overlayFillA, overlayFillB };
    localStorage.setItem(LS_OVERLAYS, JSON.stringify(list));
  };
  const loadOverlaySet = () => {
    const raw = localStorage.getItem(LS_OVERLAYS);
    const list = raw ? JSON.parse(raw) : {};
    const names = Object.keys(list);
    if (!names.length) return alert("No overlay sets yet.");
    const pick = prompt("Load overlay set:\n" + names.join(", "));
    if (!pick || !list[pick]) return;
    const s = list[pick];
    setOverlayOpacity(s.overlayOpacity ?? 0.25);
    setOverlayFillA(s.overlayFillA || "#39ff14");
    setOverlayFillB(s.overlayFillB || "#39ff14");
    setShapes(s.shapes || []);
    setShowOverlay(true);
  };

  // ====== Export ======
  const exportBoards = useCallback(async (type = "image/png", quality = 0.95, asZip = false) => {
    // wait images
    if (images.some(n => n.src && !n._imageEl)) {
      alert("Images are still loading. Try export again in a moment.");
      return;
    }
    const zip = new JSZip();

    for (let i = 0; i < boards; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = BOARD_W * pixelRatio;
      canvas.height = BOARD_H * pixelRatio;
      const ctx = canvas.getContext("2d");

      // background
      if (type === "image/jpeg" || exportBgMode === "color") {
        ctx.fillStyle = bgColor || "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        // PNG transparent: do nothing
      }

      // draw shapes first (background overlay)
      if (showOverlay && shapes.length) {
        ctx.save();
        ctx.scale(pixelRatio, pixelRatio);
        shapes.forEach(s => {
          const ds = { ...s, opacity: (s.opacity ?? overlayOpacity) };
          if (s.type === "image" && !s._img && s.src) {
            const im = new Image(); im.src = s.src; ds._img = im;
          }
          drawShape(ctx, ds);
        });
        ctx.restore();
      }

      // draw images for this board using cover-crop ops
      const ops = cropOpsForBoard(images, i, BOARD_W, BOARD_H);
      for (const op of ops) {
        ctx.drawImage(
          op.img,
          op.sx, op.sy, op.sw, op.sh,
          Math.round(op.dx * pixelRatio),
          Math.round(op.dy * pixelRatio),
          Math.round(op.dw * pixelRatio),
          Math.round(op.dh * pixelRatio)
        );
      }

      const dataURL = canvas.toDataURL(type, quality);
      const ext = type === "image/jpeg" ? "jpg" : "png";
      const filename = `858 art club_${i + 1}.${ext}`;
      if (asZip) {
        zip.file(filename, dataURL.split(",")[1], { base64: true });
      } else {
        const a = document.createElement("a");
        a.href = dataURL; a.download = filename; a.click();
      }
    }

    if (asZip) {
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "858 art club.zip";
      a.click();
    }
  }, [boards, images, pixelRatio, BOARD_W, BOARD_H, showOverlay, shapes, overlayOpacity, exportBgMode, bgColor]);

  // ====== UI helpers ======
  const sendBackward = () => {
    const id = selectedId; if (!id) return;
    setImages(prev => {
      const idx = prev.findIndex(x => x.id === id);
      if (idx > 0) {
        const a = [...prev];
        [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]];
        return a;
      }
      return prev;
    });
  };
  const bringForward = () => {
    const id = selectedId; if (!id) return;
    setImages(prev => {
      const idx = prev.findIndex(x => x.id === id);
      if (idx >= 0 && idx < prev.length - 1) {
        const a = [...prev];
        [a[idx + 1], a[idx]] = [a[idx], a[idx + 1]];
        return a;
      }
      return prev;
    });
  };
  const bringToFront = () => {
    const id = selectedId; if (!id) return;
    setImages(prev => {
      const idx = prev.findIndex(x => x.id === id);
      if (idx >= 0) {
        const a = [...prev];
        const [it] = a.splice(idx, 1);
        a.push(it);
        return a;
      }
      return prev;
    });
  };
  const sendToBack = () => {
    const id = selectedId; if (!id) return;
    setImages(prev => {
      const idx = prev.findIndex(x => x.id === id);
      if (idx >= 0) {
        const a = [...prev];
        const [it] = a.splice(idx, 1);
        a.unshift(it);
        return a;
      }
      return prev;
    });
  };

  // Keyboard
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "r") randomiseLayout();
      if (e.key.toLowerCase() === "p") packLayout();
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        setImages(prev => prev.filter(n => n.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, randomiseLayout, packLayout]);

  // ====== Render ======
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#eaeaea", fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" }}>
      {/* Top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#0a0a0a", borderBottom: "1px solid #1e1e1e" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 12px" }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>858 Random Spread Layout</div>

          <label>Boards</label>
          <input className="inp" type="number" min={1} max={MAX_BOARDS} value={boards} onChange={e => setBoards(clamp(parseInt(e.target.value || "1", 10), 1, MAX_BOARDS))} />

          <label>Preset</label>
          <select className="inp" onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            const [w,h] = v.split("x").map(n => parseInt(n, 10));
            setBoardW(w); setBoardH(h);
          }}>
            <option value="">— choose —</option>
            <option value="1080x1320">1080 × 1320 (Portrait)</option>
            <option value="1320x1080">1320 × 1080 (Landscape)</option>
            <option value="2048x1536">2048 × 1536</option>
            <option value="2480x3508">A4 300dpi (2480 × 3508)</option>
          </select>

          <label>W</label>
          <input className="inp" type="number" value={BOARD_W} onChange={e => setBoardW(clamp(parseInt(e.target.value || "1",10), 200, 8000))} style={{ width: 80 }} />
          <label>H</label>
          <input className="inp" type="number" value={BOARD_H} onChange={e => setBoardH(clamp(parseInt(e.target.value || "1",10), 200, 8000))} style={{ width: 80 }} />

          <label>Spacing</label>
          <input className="inp" type="number" min={0} max={300} value={spacing} onChange={e => setSpacing(clamp(parseInt(e.target.value || "0",10), 0, 300))} style={{ width: 70 }} />

          <button className="btn" onClick={randomSizes}>Rand Sizes</button>
          <button className="btn" onClick={randomiseLayout}>Randomise</button>
          <button className="btn" onClick={packLayout}>Pack</button>
          <button className="btn" onClick={packBottom}>Pack Bottom</button>
          <button className="btn" onClick={snapBottom}>Snap Bottom</button>

          <button className="btn" onClick={editorialSpaced}>Editorial (spaced)</button>
          <button className="btn" onClick={editorialSeamless}>Editorial (seamless)</button>
          <button className="btn" onClick={shuffleOrder}>Shuffle order</button>
          <button className="btn" onClick={firstPageHero}>Hero page 1 (3-up)</button>

          <div style={{ flex: 1 }} />

          <label>Export Scale</label>
          <input className="inp" type="number" min={1} max={4} value={pixelRatio} onChange={e => setPixelRatio(clamp(parseInt(e.target.value||"1",10),1,4))} style={{ width: 60 }} />

          <select className="inp" value={exportBgMode} onChange={e => setExportBgMode(e.target.value)}>
            <option value="color">Colour BG</option>
            <option value="transparent">Transparent (PNG)</option>
          </select>
          <ColorPicker label="BG" value={bgColor || "#000000"} onChange={setBgColor} />

          <button className="btn" onClick={() => exportBoards("image/png", 0.95, false)}>Export PNG</button>
          <button className="btn" onClick={() => exportBoards("image/jpeg", 0.95, false)}>Export JPG</button>
          <button className="btn" onClick={() => exportBoards("image/png", 0.95, true)}>Export ZIP</button>
        </div>

        {/* Overlay bar */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "0 12px 12px" }}>
          <button className="btn" onClick={toggleOverlay}>{showOverlay ? "Hide Overlay" : "Show Overlay"}</button>
          <button className="btn" onClick={() => regenShapes("random")}>Regenerate Random</button>
          <button className="btn" onClick={() => regenShapes("bar")}>Bars</button>
          <button className="btn" onClick={() => regenShapes("rect")}>Rects</button>
          <button className="btn" onClick={() => regenShapes("circle")}>Circles</button>
          <button className="btn" onClick={() => regenShapes("plus")}>Plus</button>
          <button className="btn" onClick={() => regenShapes("cross")}>Cross</button>

          <span style={{ marginLeft: 8, fontSize: 12, opacity: .8 }}>Opacity</span>
          <input className="inp" type="range" min={0} max={1} step={0.01} value={overlayOpacity}
                 onChange={e => setOverlayOpacity(parseFloat(e.target.value))} style={{ width: 110 }} />

          <ColorPicker label="Colour A" value={overlayFillA} onChange={setOverlayFillA} />
          <ColorPicker label="Colour B" value={overlayFillB} onChange={setOverlayFillB} />

          <label className="btn" style={{ cursor: "pointer" }}>
            Upload overlay image/SVG
            <input type="file" accept="image/*,.svg" className="hidden"
                   onChange={(e) => e.target.files && onUploadShape(e.target.files[0])} />
          </label>

          <button className="btn" onClick={saveOverlaySet}>Save overlay set</button>
          <button className="btn" onClick={loadOverlaySet}>Load overlay set</button>

          <div style={{ flex: 1 }} />

          <button className="btn" onClick={savePresetSlot}>Save to slots</button>
          <button className="btn" onClick={loadPresetSlot}>Load from slots</button>
          <button className="btn" onClick={presetDownload}>Download preset</button>
          <label className="btn" style={{ cursor: "pointer" }}>
            Load preset file
            <input type="file" accept="application/json" className="hidden"
                   onChange={(e) => e.target.files && presetLoad(e.target.files[0])} />
          </label>

          <span style={{ marginLeft: 8, fontSize: 12, opacity: .8 }}>Preview Zoom</span>
          <input className="inp" type="range" min={0.2} max={1.5} step={0.01} value={previewScale}
                 onChange={e => setPreviewScale(parseFloat(e.target.value))} style={{ width: 160 }} />
        </div>
      </div>

      {/* Stage */}
      <div
        ref={spreadRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onDropFiles(e.dataTransfer.files); }}
        onClick={(e) => { if (e.target === spreadRef.current) setSelectedId(null); }}
        style={{
          position: "relative",
          height: BOARD_H * previewScale,
          overflowX: "auto",
          overflowY: "hidden",
          background: bgColor || "transparent",
          borderTop: "1px solid #1e1e1e",
          borderBottom: "1px solid #1e1e1e"
        }}
      >
        <div
          ref={contentRef}
          style={{
            position: "relative",
            width: SPREAD_W,
            height: SPREAD_H,
            transformOrigin: "top left",
            transform: `scale(${previewScale})`,
          }}
        >
          {/* board grid */}
          {[...Array(boards)].map((_, i) => (
            <div key={i}
                 style={{
                   position: "absolute",
                   left: i * BOARD_W,
                   top: 0,
                   width: BOARD_W,
                   height: BOARD_H,
                   borderRight: "1px solid rgba(255,255,255,0.06)"
                 }} />
          ))}

          {/* overlay shapes (behind images) */}
          {showOverlay && shapes.map(s => (
            <canvas key={s.id}
              width={s.w} height={s.h}
              style={{
                position: "absolute",
                left: s.x, top: s.y,
                transform: `rotate(${s.rot || 0}deg)`,
                opacity: s.opacity ?? overlayOpacity,
                pointerEvents: "none"
              }}
              ref={el => {
                if (!el) return;
                const ctx = el.getContext("2d");
                ctx.clearRect(0,0,el.width, el.height);
                const ds = { ...s };
                if (s.type === "image" && s._img) {
                  // draw image scaled to box
                  ctx.drawImage(s._img, 0, 0, el.width, el.height);
                } else {
                  drawShape(ctx, { ...ds, x:0, y:0 });
                }
              }}
            />
          ))}

          {/* images */}
          {images.map((n) => (
            <ImageNode
              key={n.id}
              node={n}
              selected={n.id === selectedId}
              onSelect={() => setSelectedId(n.id)}
              onChange={(next) => setImages((prev) => prev.map((x) => (x.id === n.id ? next : x)))}
            />
          ))}

          {/* empty state */}
          {images.length === 0 && (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center", opacity: .6, pointerEvents: "none"
            }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>Drag & drop photos here</div>
                <div>Spread: {SPREAD_W} × {SPREAD_H}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer controls */}
      <div style={{ padding: 10, display: "flex", alignItems: "center", gap: 10 }}>
        <label className="btn" style={{ cursor: "pointer" }}>
          Add images
          <input type="file" className="hidden" multiple accept="image/*"
                 onChange={(e) => e.target.files && onDropFiles(e.target.files)} />
        </label>
        <button className="btn" onClick={sendToBack}>Send to Back</button>
        <button className="btn" onClick={sendBackward}>Send Backward</button>
        <button className="btn" onClick={bringForward}>Bring Forward</button>
        <button className="btn" onClick={bringToFront}>Bring to Front</button>

        <div style={{ marginLeft: "auto", fontSize: 12, opacity: .65 }}>
          Tip: R randomise, P pack, Delete removes selected. Files export as “858 art club_x”.
        </div>
      </div>

      {/* minimal styles */}
      <style>{`
        .btn {
          background: #101010;
          color: #f3f3f3;
          border: 1px solid #2a2a2a;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 12px;
          cursor: pointer;
        }
        .btn:hover { border-color: #3a3a3a; background:#141414; }
        .inp {
          background: #0f0f0f;
          color: #f3f3f3;
          border: 1px solid #2a2a2a;
          border-radius: 6px;
          padding: 4px 6px;
        }
        .hidden { display:none; }
      `}</style>
    </div>
  );
}
