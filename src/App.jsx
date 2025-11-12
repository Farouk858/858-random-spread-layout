import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/**
 * 858 Random Spread Layout — single-file app
 * - Default board size: 1080 × 1320 (portrait)
 * - Max 20 boards
 * - Randomise / Editorial (spaced & seamless) / Pack
 * - Spacing-aware, non-overlapping with safe fallback
 * - Guides with colour & opacity + slide labels (not exported)
 * - Manual preview zoom (no auto-responsiveness)
 * - Z-order controls, fix-bounds, reset layout, image count
 * - Overlays: bars / rects / circles / plus / cross (+ upload image/SVG)
 *   with opacity, colour favourites (save to slots, load from slots)
 * - Save / load full preset (JSON)
 * - Export PNG / JPG / ZIP with filenames "858 art club_x"
 */

// ====== Config ======
const MAX_BOARDS = 20;
const DEFAULT_W = 1080; // portrait default
const DEFAULT_H = 1320;
const DEFAULT_SPACING = 24;
const UID = () => Math.random().toString(36).slice(2, 10);

// ====== Presets ======
const BOARD_PRESETS = [
  { key: "1080x1320 (Portrait)", w: 1080, h: 1320 },
  { key: "1320x1080 (Landscape)", w: 1320, h: 1080 },
  { key: "1080x1080 (Square)", w: 1080, h: 1080 },
  { key: "1920x1080 (16:9)", w: 1920, h: 1080 },
  { key: "1080x1920 (9:16)", w: 1080, h: 1920 },
];

// ====== Styles (global) ======
const globalStyle = `
  html, body, #root { height: 100%; background:#000; color:#e5e5e5; }
  body { margin:0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial; }
  /* reserve space for the bottom control dock */
  body { padding-bottom: 220px; }
  @media (max-width: 1200px) { body { padding-bottom: 260px; } }

  .btn { background:#111; border:1px solid #2a2a2a; color:#e5e5e5; padding:6px 10px; border-radius:8px; cursor:pointer; }
  .btn:hover { background:#171717; }
  .btn:active { transform: translateY(1px); }
  .btn-danger { background:#301010; border-color:#4a1a1a; color:#ffb4b4; }
  .btn-green { background:#0f1f0f; border-color:#1f3f1f; color:#b6ffb6; }
  .btn-blue { background:#0f1628; border-color:#203050; color:#b6d8ff; }

  .field { background:#0b0b0b; border:1px solid #2a2a2a; color:#e5e5e5; padding:6px 8px; border-radius:8px; }
  .field::placeholder { color:#888; }

  .dock { position:fixed; left:0; right:0; bottom:0; z-index:10; background:rgba(8,8,8,0.98); border-top:1px solid #1f1f1f; }
  .dock-inner { display:flex; flex-wrap:wrap; gap:10px 14px; padding:12px 14px; align-items:center; }
  .dock-group { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }

  .chip { padding:4px 8px; border-radius:999px; font-size:12px; border:1px solid #2a2a2a; background:#0b0b0b; }
  .mini { font-size:12px; opacity:0.75; }
  .label { font-size:12px; color:#a3a3a3; }

  .preview-wrap { margin:12px auto; border:1px solid #1d1d1d; background:#000; overflow:hidden; }
  .guide { position:absolute; top:0; bottom:0; width:1px; pointer-events:none; }
  .slide-tag { position:absolute; top:4px; left:6px; font-size:10px; opacity:0.6; pointer-events:none; }
`;

// ====== Helpers ======
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const copyList = (a) => a.map((x) => ({ ...x }));
const shuffleInPlace = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } };
const overlapWith = (a, b, margin) =>
  !(
    a.x + a.w + margin <= b.x ||
    b.x + b.w + margin <= a.x ||
    a.y + a.h + margin <= b.y ||
    b.y + b.h + margin <= a.y
  );

function clampToBoards(n, boardW, boardH, boards, spacing) {
  const bx = Math.floor(n.x / boardW); // which board index
  const left = bx * boardW + spacing;
  const right = (bx + 1) * boardW - spacing - n.w;
  return {
    ...n,
    x: clamp(n.x, left, right),
    y: clamp(n.y, spacing, boardH - spacing - n.h),
  };
}

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

// ====== Safe placer used by all layouts ======
function placeSafely(node, { boards, boardW, boardH, spacing }, startBoard = 0) {
  const MAX_TRIES = 800;
  const triesPerBoard = Math.max(60, Math.floor(MAX_TRIES / Math.max(1, boards)));
  const out = { ...node };
  out.w = clamp(out.w || Math.floor(boardW * 0.4), 8, boardW - spacing * 2);
  out.h = clamp(out.h || Math.floor(out.w * 0.75), 8, boardH - spacing * 2);

  for (let biShift = 0; biShift < boards; biShift++) {
    const bi = (startBoard + biShift) % boards;
    const bx = bi * boardW;
    for (let t = 0; t < triesPerBoard; t++) {
      const x = bx + Math.floor(Math.random() * Math.max(1, boardW - out.w - spacing * 2)) + spacing;
      const y = Math.floor(Math.random() * Math.max(1, boardH - out.h - spacing * 2)) + spacing;
      const candidate = { ...out, x, y };
      let hit = false;
      for (const p of placeSafely._placed || []) {
        if (overlapWith(candidate, p, spacing)) { hit = true; break; }
      }
      if (!hit) return candidate;
    }
  }
  const bx = (startBoard % boards) * boardW;
  out.x = clamp(bx + spacing, bx, bx + boardW - out.w - spacing);
  out.y = clamp(spacing, 0, boardH - out.h - spacing);
  return out;
}

// ====== Crop ops for exporting by board ======
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
function cropOpsForBoard(images, boardIndex, boardW, boardH) {
  const boardX = boardIndex * boardW;
  const ops = [];
  for (const n of images) {
    const inter = intersectRect(n.x, n.y, n.w, n.h, boardX, 0, boardW, boardH);
    if (!inter) continue;
    const sx = inter.x - n.x;
    const sy = inter.y - n.y;
    const sw = inter.w;
    const sh = inter.h;
    const dx = inter.x - boardX;
    const dy = inter.y;
    ops.push({ img: n._imageEl, sx, sy, sw, sh, dx, dy, dw: sw, dh: sh, placedW: n.w, placedH: n.h });
  }
  return ops;
}

// ====== Draggable / Resizable Image Item ======
function Item({ node, selected, onSelect, onChange }) {
  const ref = useRef(null);
  const imgEl = useImageElement(node.src);

  // patch image element mapping for export (no stretching)
  useEffect(() => {
    if (imgEl && node._imageEl !== imgEl) onChange({ ...node, _imageEl: imgEl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl]);

  // Keep the natural-to-placed mapping
  useEffect(() => {
    if (node._imageEl) {
      node._imageEl._placedW = node.w;
      node._imageEl._placedH = node.h;
    }
  }, [node]);

  // drag
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0, startY = 0, oX = 0, oY = 0, dragging = false;
    const down = (e) => {
      if (e.target.closest("[data-handle]") || e.button === 2) return;
      dragging = true; onSelect();
      const p = e.touches?.[0] || e;
      startX = p.clientX; startY = p.clientY; oX = node.x; oY = node.y;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches?.[0] || e;
      onChange({ ...node, x: oX + (p.clientX - startX), y: oY + (p.clientY - startY) });
    };
    const up = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointerdown", down);
    return () => el.removeEventListener("pointerdown", down);
  }, [node, onSelect, onChange]);

  // resize
  const startResize = (dir, e) => {
    e.stopPropagation();
    const p0 = e.touches?.[0] || e;
    const sx = p0.clientX, sy = p0.clientY;
    const init = { x: node.x, y: node.y, w: node.w, h: node.h };
    const onMove = (ev) => {
      const p = ev.touches?.[0] || ev;
      let dx = p.clientX - sx, dy = p.clientY - sy;
      let { x, y, w, h } = init;
      if (dir.includes("e")) w = clamp(init.w + dx, 10, 99999);
      if (dir.includes("s")) h = clamp(init.h + dy, 10, 99999);
      if (dir.includes("w")) { w = clamp(init.w - dx, 10, 99999); x = init.x + dx; }
      if (dir.includes("n")) { h = clamp(init.h - dy, 10, 99999); y = init.y + dy; }
      onChange({ ...node, x, y, w, h });
    };
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
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
  };

  return (
    <div ref={ref} style={style} onClick={onSelect}>
      {imgEl ? (
        <img src={node.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#0f0f0f" }} />
      )}
      {selected && (
        <>
          <div style={{ position: "absolute", inset: 0, border: "1px dashed #4f46e5", pointerEvents: "none" }} />
          {[
            ["nw", 0, 0], ["ne", "100%", 0], ["sw", 0, "100%"], ["se", "100%", "100%"],
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

// ====== Main App ======
export default function App() {
  // board
  const [boards, setBoards] = useState(6);
  const [boardW, setBoardW] = useState(DEFAULT_W);
  const [boardH, setBoardH] = useState(DEFAULT_H);
  const [presetKey, setPresetKey] = useState(BOARD_PRESETS[0].key);
  const [spacing, setSpacing] = useState(DEFAULT_SPACING);
  const [exportScale, setExportScale] = useState(2);
  const [bgColor, setBgColor] = useState("#000000");

  // preview
  const [previewZoom, setPreviewZoom] = useState(0.35);
  const [showGuides, setShowGuides] = useState(true);
  const [guideColor, setGuideColor] = useState("#0eea2b");
  const [guideOpacity, setGuideOpacity] = useState(0.35);

  // images
  const [images, setImages] = useState([]); // {id, src, x,y,w,h,rotation,_imageEl}
  const [selectedId, setSelectedId] = useState(null);

  // overlays
  const [overlayOpacity, setOverlayOpacity] = useState(0.9);
  const [overlayA, setOverlayA] = useState("#12ff41");
  const [overlayB, setOverlayB] = useState("#101010");
  const [overlayShapes, setOverlayShapes] = useState([]); // {id, type, x,y,w,h, r? , color}
  const overlayImageRef = useRef(null);
  const [slotsA, setSlotsA] = useState(() => JSON.parse(localStorage.getItem("slotsA") || "[]"));
  const [slotsB, setSlotsB] = useState(() => JSON.parse(localStorage.getItem("slotsB") || "[]"));

  const spreadW = useMemo(() => boards * boardW, [boards, boardW]);
  const spreadH = boardH;

  // ====== Preset change ======
  useEffect(() => {
    const found = BOARD_PRESETS.find(p => p.key === presetKey);
    if (found) {
      setBoardW(found.w);
      setBoardH(found.h);
    }
  }, [presetKey]);

  // ====== Drag/Drop image loader ======
  const readAsDataURL = (file) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  const onAddImages = async (fileList) => {
    const files = Array.from(fileList || []);
    const newNodes = [];
    for (const f of files) {
      if (!f.type?.startsWith("image/")) continue;
      const src = await readAsDataURL(f);
      const id = UID();
      const w = Math.floor(boardW * (0.25 + Math.random() * 0.35));
      const h = Math.floor(w * (0.65 + Math.random() * 0.4));
      newNodes.push({ id, src, x: spacing, y: spacing, w, h, rotation: 0 });
    }
    setImages(prev => [...prev, ...newNodes]);
  };

  // ====== Layouts ======
  const randomise = useCallback(
    (opts = { acrossBoards: true }) => {
      const src = copyList(images);
      if (!src.length) return;
      shuffleInPlace(src);
      const placed = [];
      placeSafely._placed = placed;
      let nextBoard = 0;
      for (const n of src) {
        const w = Math.floor(boardW * (0.28 + Math.random() * 0.5));
        const h = Math.floor(w * (0.6 + Math.random() * 0.4));
        const seeded = { ...n, w, h };
        const placedOne = placeSafely(
          seeded,
          { boards, boardW, boardH, spacing },
          opts.acrossBoards ? nextBoard : Math.floor(Math.random() * boards)
        );
        placed.push(placedOne);
        nextBoard = (nextBoard + 1) % boards;
      }
      placeSafely._placed = null;
      setImages(placed.map(n => clampToBoards(n, boardW, boardH, boards, spacing)));
      setSelectedId(null);
    },
    [images, boards, boardW, boardH, spacing]
  );

  const editorial = useCallback((gap = spacing) => {
    const src = copyList(images);
    if (!src.length) return;
    shuffleInPlace(src);

    const placed = [];
    placeSafely._placed = placed;

    const colsPerBoard = 3;
    let idx = 0;

    for (let b = 0; b < boards && idx < src.length; b++) {
      const bx = b * boardW;
      const colW = Math.floor((boardW - gap * (colsPerBoard + 1)) / colsPerBoard);
      for (let c = 0; c < colsPerBoard && idx < src.length; c++) {
        let y = gap;
        while (idx < src.length && y < boardH - gap) {
          const n = src[idx++];
          const h = clamp(Math.floor(colW * (0.75 + Math.random() * 0.5)), 40, boardH - y - gap);
          const seeded = { ...n, x: bx + gap + c * (colW + gap), y, w: colW, h };
          const ok = !placed.some((p) => overlapWith(seeded, p, gap * 0.5));
          placed.push(ok ? seeded : placeSafely(seeded, { boards, boardW, boardH, spacing: gap }, b));
          y += h + gap;
        }
      }
    }
    while (idx < src.length) {
      const n = src[idx++];
      placed.push(placeSafely({ ...n }, { boards, boardW, boardH, spacing }));
    }

    placeSafely._placed = null;
    setImages(placed.map(n => clampToBoards(n, boardW, boardH, boards, spacing)));
    setSelectedId(null);
  }, [images, boards, boardW, boardH, spacing]);

  const editorialSeamless = () => editorial(0);

  const pack = useCallback(() => {
    const src = [...images];
    if (!src.length) return;
    src.forEach(n => {
      n.w = clamp(n.w || Math.floor(boardW * 0.4), 8, boardW - spacing * 2);
      n.h = clamp(n.h || Math.floor(n.w * 0.75), 8, boardH - spacing * 2);
    });
    src.sort((a, b) => b.w * b.h - a.w * a.h);

    const placed = [];
    placeSafely._placed = placed;

    for (const n of src) {
      let done = false;
      for (let y = spacing; y <= boardH - n.h - spacing && !done; y += Math.max(spacing, 12)) {
        for (let bi = 0; bi < boards && !done; bi++) {
          for (let x = bi * boardW + spacing; x <= (bi + 1) * boardW - n.w - spacing; x += Math.max(spacing, 12)) {
            const c = { ...n, x, y };
            if (!placed.some((p) => overlapWith(c, p, spacing))) { placed.push(c); done = true; }
          }
        }
      }
      if (!done) placed.push(placeSafely(n, { boards, boardW, boardH, spacing }));
    }
    placeSafely._placed = null;
    setImages(placed.map(n => clampToBoards(n, boardW, boardH, boards, spacing)));
    setSelectedId(null);
  }, [images, boards, boardW, boardH, spacing]);

  const fixBounds = () => {
    setImages(prev => prev.map(n => clampToBoards(n, boardW, boardH, boards, spacing)));
  };

  const resetLayout = () => {
    setImages(prev => prev.map(n => ({ ...n, x: spacing, y: spacing, w: Math.floor(boardW * 0.35), h: Math.floor(boardW * 0.26) })));
    setSelectedId(null);
  };

  // ====== Overlays ======
  const regenBars = () => {
    const items = [];
    const count = Math.floor(boards * 8);
    for (let i = 0; i < count; i++) {
      const bi = Math.floor(Math.random() * boards);
      const x = bi * boardW + Math.floor(Math.random() * boardW);
      const w = 6 + Math.floor(Math.random() * 16);
      const y = Math.floor(Math.random() * boardH);
      const h = 80 + Math.floor(Math.random() * 380);
      items.push({ id: UID(), type: "bar", x, y, w, h, color: overlayA });
    }
    setOverlayShapes(items);
  };
  const regenRects = () => {
    const items = [];
    const count = Math.floor(boards * 6);
    for (let i = 0; i < count; i++) {
      const bi = Math.floor(Math.random() * boards);
      const x = bi * boardW + spacing + Math.floor(Math.random() * (boardW - spacing * 2));
      const y = spacing + Math.floor(Math.random() * (boardH - spacing * 2));
      const w = 80 + Math.floor(Math.random() * (boardW * 0.4));
      const h = 50 + Math.floor(Math.random() * (boardH * 0.25));
      items.push({ id: UID(), type: "rect", x, y, w, h, color: overlayB });
    }
    setOverlayShapes(items);
  };
  const regenCircles = () => {
    const items = [];
    const count = Math.floor(boards * 4);
    for (let i = 0; i < count; i++) {
      const bi = Math.floor(Math.random() * boards);
      const r = 20 + Math.floor(Math.random() * 80);
      const x = bi * boardW + spacing + Math.floor(Math.random() * (boardW - spacing * 2 - r * 2));
      const y = spacing + Math.floor(Math.random() * (boardH - spacing * 2 - r * 2));
      items.push({ id: UID(), type: "circle", x, y, w: r * 2, h: r * 2, color: overlayA });
    }
    setOverlayShapes(items);
  };
  const regenPlus = () => {
    const items = [];
    const count = Math.floor(boards * 6);
    for (let i = 0; i < count; i++) {
      const bi = Math.floor(Math.random() * boards);
      const s = 14 + Math.floor(Math.random() * 22);
      const x = bi * boardW + spacing + Math.floor(Math.random() * (boardW - spacing * 2 - s));
      const y = spacing + Math.floor(Math.random() * (boardH - spacing * 2 - s));
      items.push({ id: UID(), type: "plus", x, y, w: s, h: s, color: overlayA });
    }
    setOverlayShapes(items);
  };
  const regenCross = () => {
    const items = [];
    const count = Math.floor(boards * 6);
    for (let i = 0; i < count; i++) {
      const bi = Math.floor(Math.random() * boards);
      const s = 14 + Math.floor(Math.random() * 22);
      const x = bi * boardW + spacing + Math.floor(Math.random() * (boardW - spacing * 2 - s));
      const y = spacing + Math.floor(Math.random() * (boardH - spacing * 2 - s));
      items.push({ id: UID(), type: "cross", x, y, w: s, h: s, color: overlayB });
    }
    setOverlayShapes(items);
  };
  const hideOverlay = () => setOverlayShapes([]);

  // upload overlay image/SVG
  const onUploadOverlay = async (file) => {
    if (!file) return;
    const src = await readAsDataURL(file);
    // put as a board-wide image overlay
    const items = [];
    for (let b = 0; b < boards; b++) {
      items.push({ id: UID(), type: "image", x: b * boardW, y: 0, w: boardW, h: boardH, src, color: "#ffffff" });
    }
    setOverlayShapes(items);
  };

  // favourites slots
  const saveSlotA = () => {
    const next = [...slotsA, overlayA].slice(-6);
    setSlotsA(next);
    localStorage.setItem("slotsA", JSON.stringify(next));
  };
  const saveSlotB = () => {
    const next = [...slotsB, overlayB].slice(-6);
    setSlotsB(next);
    localStorage.setItem("slotsB", JSON.stringify(next));
  };

  // ====== Save / Load preset (whole app) ======
  const savePreset = () => {
    const data = {
      boards, boardW, boardH, spacing, exportScale, bgColor,
      images, overlayOpacity, overlayA, overlayB, overlayShapes,
      guideColor, guideOpacity, showGuides, presetKey
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "858-layout-preset.json"; a.click();
  };
  const loadPreset = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (d.boards) setBoards(clamp(d.boards, 1, MAX_BOARDS));
        if (d.boardW) setBoardW(d.boardW);
        if (d.boardH) setBoardH(d.boardH);
        if (typeof d.spacing === "number") setSpacing(clamp(d.spacing, 0, 400));
        if (typeof d.exportScale === "number") setExportScale(clamp(d.exportScale, 1, 4));
        if (d.bgColor) setBgColor(d.bgColor);
        if (Array.isArray(d.images)) setImages(d.images);
        if (typeof d.overlayOpacity === "number") setOverlayOpacity(clamp(d.overlayOpacity, 0, 1));
        if (d.overlayA) setOverlayA(d.overlayA);
        if (d.overlayB) setOverlayB(d.overlayB);
        if (Array.isArray(d.overlayShapes)) setOverlayShapes(d.overlayShapes);
        if (d.guideColor) setGuideColor(d.guideColor);
        if (typeof d.guideOpacity === "number") setGuideOpacity(clamp(d.guideOpacity, 0, 1));
        if (typeof d.showGuides === "boolean") setShowGuides(d.showGuides);
        if (d.presetKey) setPresetKey(d.presetKey);
      } catch {
        alert("Invalid preset JSON");
      }
    };
    r.readAsText(file);
  };

  // ====== Exporting ======
  const drawOverlays = (ctx, boardIndex) => {
    if (!overlayShapes.length) return;
    ctx.globalAlpha = overlayOpacity;
    for (const s of overlayShapes) {
      const bi = Math.floor(s.x / boardW);
      if (bi !== boardIndex) continue;
      const lx = s.x - bi * boardW;
      ctx.save();
      ctx.fillStyle = s.color || "#fff";
      ctx.strokeStyle = s.color || "#fff";
      if (s.type === "bar" || s.type === "rect") ctx.fillRect(lx, s.y, s.w, s.h);
      else if (s.type === "circle") {
        ctx.beginPath();
        ctx.arc(lx + s.w / 2, s.y + s.h / 2, Math.min(s.w, s.h) / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.type === "plus" || s.type === "cross") {
        const thick = Math.max(2, Math.floor(s.w * 0.3));
        const cx = lx + s.w / 2, cy = s.y + s.h / 2, len = Math.max(s.w, s.h);
        ctx.fillRect(cx - thick / 2, cy - len / 2, thick, len);
        ctx.fillRect(cx - len / 2, cy - thick / 2, len, thick);
        if (s.type === "cross") { // rotate 45deg for cross
          ctx.translate(cx, cy);
          ctx.rotate(Math.PI / 4);
          ctx.translate(-cx, -cy);
          ctx.fillRect(cx - thick / 2, cy - len / 2, thick, len);
          ctx.fillRect(cx - len / 2, cy - thick / 2, len, thick);
        }
      } else if (s.type === "image" && s.src) {
        const im = new Image();
        im.src = s.src;
        ctx.drawImage(im, lx, s.y, s.w, s.h);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  const exportBoards = async (mime = "image/png", quality = 0.95) => {
    if (images.some(n => n.src && !n._imageEl)) {
      alert("Images are still loading. Try export again in a moment.");
      return;
    }
    for (let i = 0; i < boards; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = boardW * exportScale;
      canvas.height = boardH * exportScale;
      const ctx = canvas.getContext("2d");
      // background
      ctx.fillStyle = bgColor || "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // overlays first
      ctx.save();
      ctx.scale(exportScale, exportScale);
      drawOverlays(ctx, i);
      ctx.restore();

      // images
      const ops = cropOpsForBoard(images, i, boardW, boardH);
      for (const op of ops) {
        if (!op.img) continue;
        const scaleX = op.img.naturalWidth / (op.placedW || 1);
        const scaleY = op.img.naturalHeight / (op.placedH || 1);
        const sdx = op.sx * scaleX;
        const sdy = op.sy * scaleY;
        const sdw = op.sw * scaleX;
        const sdh = op.sh * scaleY;

        ctx.drawImage(
          op.img,
          sdx, sdy, sdw, sdh,
          Math.round(op.dx * exportScale),
          Math.round(op.dy * exportScale),
          Math.round(op.dw * exportScale),
          Math.round(op.dh * exportScale)
        );
      }

      const dataURL = canvas.toDataURL(mime, quality);
      const a = document.createElement("a");
      a.href = dataURL;
      a.download = `858 art club_${i + 1}.${mime === "image/jpeg" ? "jpg" : "png"}`;
      a.click();
    }
  };

  const exportZip = async () => {
    if (images.some(n => n.src && !n._imageEl)) {
      alert("Images are still loading. Try export again in a moment.");
      return;
    }
    const zip = new JSZip();
    for (let i = 0; i < boards; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = boardW * exportScale;
      canvas.height = boardH * exportScale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = bgColor || "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(exportScale, exportScale);
      drawOverlays(ctx, i);
      ctx.restore();

      const ops = cropOpsForBoard(images, i, boardW, boardH);
      for (const op of ops) {
        if (!op.img) continue;
        const scaleX = op.img.naturalWidth / (op.placedW || 1);
        const scaleY = op.img.naturalHeight / (op.placedH || 1);
        const sdx = op.sx * scaleX;
        const sdy = op.sy * scaleY;
        const sdw = op.sw * scaleX;
        const sdh = op.sh * scaleY;

        ctx.drawImage(
          op.img,
          sdx, sdy, sdw, sdh,
          Math.round(op.dx * exportScale),
          Math.round(op.dy * exportScale),
          Math.round(op.dw * exportScale),
          Math.round(op.dh * exportScale)
        );
      }
      const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
      zip.file(`858 art club_${i + 1}.png`, blob);
    }
    const zipped = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipped);
    const a = document.createElement("a");
    a.href = url; a.download = "858 art club_export.zip"; a.click();
  };

  // ====== Keyboard ======
  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "r") randomise();
      if (e.key.toLowerCase() === "p") pack();
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) setImages(prev => prev.filter(n => n.id !== selectedId));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [randomise, pack, selectedId]);

  // ====== Image count ======
  const imageCount = images.length;

  // ====== UI ======
  return (
    <>
      <style>{globalStyle}</style>

      {/* PREVIEW */}
      <div
        className="preview-wrap"
        style={{
          width: Math.floor(spreadW * previewZoom),
          height: Math.floor(spreadH * previewZoom),
          position: "relative",
          zIndex: 1,
          marginTop: 14,
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0, top: 0,
            width: spreadW, height: spreadH,
            transform: `scale(${previewZoom})`,
            transformOrigin: "top left",
            background: bgColor,
          }}
        >
          {/* guides & slide labels */}
          {showGuides && Array.from({ length: boards }).map((_, i) => (
            <React.Fragment key={`g${i}`}>
              <div
                className="guide"
                style={{
                  left: i * boardW,
                  background: guideColor, opacity: guideOpacity,
                }}
              />
              <div className="slide-tag" style={{ left: i * boardW + 6, color: guideColor, opacity: Math.min(1, guideOpacity + 0.25) }}>
                slide {i + 1}
              </div>
            </React.Fragment>
          ))}

          {/* overlays (preview) */}
          {overlayShapes.map(s => (
            <div key={s.id} style={{
              position: "absolute", left: s.x, top: s.y, width: s.w, height: s.h,
              background: (s.type === "bar" || s.type === "rect" || s.type === "circle" || s.type === "image") ? s.color : "transparent",
              opacity: overlayOpacity, pointerEvents: "none",
              borderRadius: s.type === "circle" ? "9999px" : 0,
            }}>
              {(s.type === "plus" || s.type === "cross") && (
                <div style={{ position: "absolute", inset: 0 }}>
                  <div style={{
                    position: "absolute", left: "50%", top: "50%",
                    width: Math.max(s.w, s.h), height: Math.max(2, Math.floor(s.w * 0.25)),
                    background: s.color, transform: "translate(-50%, -50%)"
                  }} />
                  <div style={{
                    position: "absolute", left: "50%", top: "50%",
                    width: Math.max(2, Math.floor(s.w * 0.25)), height: Math.max(s.w, s.h),
                    background: s.color, transform: "translate(-50%, -50%)"
                  }} />
                  {s.type === "cross" && (
                    <div style={{
                      position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%) rotate(45deg)"
                    }}>
                      <div style={{ width: Math.max(s.w, s.h), height: Math.max(2, Math.floor(s.w * 0.25)), background: s.color }} />
                      <div style={{ position: "absolute", left: "50%", top: "50%", width: Math.max(2, Math.floor(s.w * 0.25)), height: Math.max(s.w, s.h), background: s.color, transform: "translate(-50%, -50%)" }} />
                    </div>
                  )}
                </div>
              )}
              {s.type === "image" && s.src && (
                <img src={s.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: overlayOpacity }} />
              )}
            </div>
          ))}

          {/* IMAGES */}
          {images.map(n => (
            <Item
              key={n.id}
              node={n}
              selected={n.id === selectedId}
              onSelect={() => setSelectedId(n.id)}
              onChange={(next) => setImages(prev => prev.map(x => x.id === n.id ? next : x))}
            />
          ))}

          {/* Empty tip */}
          {images.length === 0 && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.6, fontSize: 14, pointerEvents: "none" }}>
              Drop images or use “Add images”
            </div>
          )}
        </div>
      </div>

      {/* DOCK / CONTROLS */}
      <div className="dock">
        <div className="dock-inner" style={{ alignItems: "flex-start" }}>
          {/* Layouts */}
          <div className="dock-group">
            <span className="label">Layouts</span>
            <button className="btn" onClick={() => randomise()}>Randomise</button>
            <button className="btn" onClick={() => editorial(spacing)}>Editorial (spaced)</button>
            <button className="btn" onClick={() => editorialSeamless()}>Editorial (seamless)</button>
            <button className="btn" onClick={() => pack()}>Pack</button>
            <button className="btn" onClick={fixBounds}>Fix bounds</button>
            <button className="btn" onClick={resetLayout}>Reset layout</button>
          </div>

          {/* Boards / size / spacing */}
          <div className="dock-group">
            <span className="label">Boards (max 20)</span>
            <input className="field" type="number" min={1} max={MAX_BOARDS}
              value={boards} onChange={e => setBoards(clamp(parseInt(e.target.value || "1", 10), 1, MAX_BOARDS))} style={{ width: 64 }} />
            <select className="field" value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
              {BOARD_PRESETS.map(p => <option key={p.key} value={p.key}>{p.key}</option>)}
            </select>
            <span className="label">W</span>
            <input className="field" type="number" value={boardW} onChange={e => setBoardW(clamp(parseInt(e.target.value || "1", 10), 100, 20000))} style={{ width: 80 }} />
            <span className="label">H</span>
            <input className="field" type="number" value={boardH} onChange={e => setBoardH(clamp(parseInt(e.target.value || "1", 10), 100, 20000))} style={{ width: 80 }} />
            <span className="label">Spacing</span>
            <input className="field" type="number" value={spacing} onChange={e => setSpacing(clamp(parseInt(e.target.value || "0", 10), 0, 400))} style={{ width: 64 }} />
          </div>

          {/* Preview & guides */}
          <div className="dock-group">
            <span className="label">Preview zoom</span>
            <input type="range" min="0.1" max="1.0" step="0.01" value={previewZoom} onChange={e => setPreviewZoom(parseFloat(e.target.value))} />
            <span className="label">Guides colour</span>
            <input className="field" type="color" value={guideColor} onChange={e => setGuideColor(e.target.value)} />
            <span className="label">opacity</span>
            <input type="range" min="0" max="1" step="0.01" value={guideOpacity} onChange={e => setGuideOpacity(parseFloat(e.target.value))} />
            <label className="label"><input type="checkbox" checked={showGuides} onChange={e => setShowGuides(e.target.checked)} /> Show guides</label>
            <span className="chip">Count: {imageCount}</span>
          </div>

          {/* Background & Export */}
          <div className="dock-group">
            <span className="label">Background</span>
            <input className="field" type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} />
            <span className="label">Export scale</span>
            <input className="field" type="number" min={1} max={4} value={exportScale} onChange={e => setExportScale(clamp(parseInt(e.target.value || "1", 10), 1, 4))} style={{ width: 56 }} />
            <button className="btn" onClick={() => exportBoards("image/png")}>Export PNG</button>
            <button className="btn" onClick={() => exportBoards("image/jpeg")}>Export JPG</button>
            <button className="btn" onClick={exportZip}>Export ZIP</button>
          </div>

          {/* Overlays */}
          <div className="dock-group">
            <span className="label">Overlay</span>
            <button className="btn" onClick={regenBars}>Bars</button>
            <button className="btn" onClick={regenRects}>Rects</button>
            <button className="btn" onClick={regenCircles}>Circles</button>
            <button className="btn" onClick={regenPlus}>Plus</button>
            <button className="btn" onClick={regenCross}>Cross</button>
            <button className="btn" onClick={hideOverlay}>Hide Overlay</button>
            <span className="label">Opacity</span>
            <input type="range" min="0" max="1" step="0.01" value={overlayOpacity} onChange={e => setOverlayOpacity(parseFloat(e.target.value))} />
            <span className="label">Colour A</span>
            <input className="field" type="color" value={overlayA} onChange={e => setOverlayA(e.target.value)} />
            <button className="btn" onClick={saveSlotA}>★ save A</button>
            <span className="label">Colour B</span>
            <input className="field" type="color" value={overlayB} onChange={e => setOverlayB(e.target.value)} />
            <button className="btn" onClick={saveSlotB}>★ save B</button>
            {/* favourite slots */}
            {slotsA.map((c, i) => <button key={`sa${i}`} className="btn" style={{ background:c, borderColor:"#333" }} onClick={() => setOverlayA(c)} title={`slot A ${i+1}`} />)}
            {slotsB.map((c, i) => <button key={`sb${i}`} className="btn" style={{ background:c, borderColor:"#333" }} onClick={() => setOverlayB(c)} title={`slot B ${i+1}`} />)}
            {/* upload overlay */}
            <input ref={overlayImageRef} type="file" accept="image/*,.svg" style={{ display:"none" }} onChange={(e) => e.target.files && onUploadOverlay(e.target.files[0])} />
            <button className="btn" onClick={() => overlayImageRef.current?.click()}>Upload overlay image/SVG</button>
          </div>

          {/* Presets + Z order + Files */}
          <div className="dock-group">
            <button className="btn" onClick={savePreset}>Save preset</button>
            <label className="btn">
              Load preset file
              <input type="file" accept="application/json" style={{ display:"none" }} onChange={(e) => e.target.files && loadPreset(e.target.files[0])} />
            </label>
            <button className="btn" onClick={() => setImages(prev => {
              if (!selectedId) return prev;
              const idx = prev.findIndex(n => n.id === selectedId);
              if (idx < 0) return prev;
              const arr = [...prev];
              if (idx > 0) [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
              return arr;
            })}>Send Backward</button>
            <button className="btn" onClick={() => setImages(prev => {
              if (!selectedId) return prev;
              const idx = prev.findIndex(n => n.id === selectedId);
              if (idx < 0) return prev;
              const arr = [...prev];
              if (idx < arr.length - 1) [arr[idx+1], arr[idx]] = [arr[idx], arr[idx+1]];
              return arr;
            })}>Bring Forward</button>
            <button className="btn" onClick={() => setImages(prev => {
              if (!selectedId) return prev;
              const idx = prev.findIndex(n => n.id === selectedId);
              if (idx < 0) return prev;
              const arr = [...prev];
              const [it] = arr.splice(idx, 1);
              arr.unshift(it);
              return arr;
            })}>Send to Back</button>
            <button className="btn" onClick={() => setImages(prev => {
              if (!selectedId) return prev;
              const idx = prev.findIndex(n => n.id === selectedId);
              if (idx < 0) return prev;
              const arr = [...prev];
              const [it] = arr.splice(idx, 1);
              arr.push(it);
              return arr;
            })}>Bring to Front</button>

            {/* Add images */}
            <label className="btn">
              Add images
              <input type="file" accept="image/*" multiple style={{ display:"none" }} onChange={(e) => e.target.files && onAddImages(e.target.files)} />
            </label>
            <span className="chip mini">Tip: R randomise, P pack, Delete removes selected. Files export as “858 art club_x”.</span>
          </div>
        </div>
      </div>
    </>
  );
}
