import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/**
 * 858 Random Spread Layout — Pure React
 * - Preview auto-fits 100% of available viewport height (toolbars measured, canvas scales to fit)
 * - Auto Spread: flows items L→R, top→bottom; auto-adds boards (up to MAX) to avoid overlaps
 * - Pack / Pack Bottom use the same auto-grow placement core
 * - Background rectangles with colour pickers & ranges
 * - Overlay image, ZIP export, editorial 3-up first page, shuffle, z-order, presets
 */

const MAX_BOARDS = 20;
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------- geometry ----------
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

function rectsOverlapWithMargin(a, b, m) {
  return !(
    a.x + a.w + m <= b.x ||
    b.x + b.w + m <= a.x ||
    a.y + a.h + m <= b.y ||
    b.y + b.h + m <= a.y
  );
}

function coverSourceRect(imgW, imgH, nodeW, nodeH, nx, ny, nw, nh) {
  const scale = Math.max(nodeW / imgW, nodeH / imgH);
  const rw = imgW * scale;
  const rh = imgH * scale;
  const offsetX = (rw - nodeW) / 2;
  const offsetY = (rh - nodeH) / 2;

  let sx = (nx - offsetX) / scale;
  let sy = (ny - offsetY) / scale;
  let sw = nw / scale;
  let sh = nh / scale;

  const x2 = Math.min(imgW, Math.max(0, sx + sw));
  const y2 = Math.min(imgH, Math.max(0, sy + sh));
  sx = Math.max(0, Math.min(imgW, sx));
  sy = Math.max(0, Math.min(imgH, sy));
  sw = Math.max(0, x2 - sx);
  sh = Math.max(0, y2 - sy);

  return { sx, sy, sw, sh };
}

// ---------- image loader ----------
function useImage(src) {
  const [img, setImg] = useState(null);
  useEffect(() => {
    if (!src) return;
    const el = new Image();
    el.crossOrigin = "anonymous";
    el.onload = () => setImg(el);
    el.src = src;
    return () => setImg(null);
  }, [src]);
  return img;
}

// ---------- item ----------
function Item({ node, selected, onSelect, onChange }) {
  const ref = useRef(null);
  const imgEl = useImage(node.src);

  useEffect(() => {
    if (imgEl && node._img !== imgEl) onChange({ ...node, _img: imgEl });
    // eslint-disable-next-line
  }, [imgEl]);

  // drag
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0, startY = 0, ox = 0, oy = 0, dragging = false;

    const down = (e) => {
      if (e.target.closest("[data-handle]") || e.button === 2) return;
      dragging = true;
      const p = e.touches?.[0] || e;
      startX = p.clientX; startY = p.clientY; ox = node.x; oy = node.y;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      onSelect(node.id);
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches?.[0] || e;
      onChange({ ...node, x: ox + (p.clientX - startX), y: oy + (p.clientY - startY) });
    };
    const up = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    el.addEventListener("pointerdown", down);
    return () => el.removeEventListener("pointerdown", down);
  }, [node, onChange, onSelect]);

  // resize
  const startResize = (dir, e) => {
    e.stopPropagation();
    const p0 = e.touches?.[0] || e;
    const sx = p0.clientX; const sy = p0.clientY;
    const init = { x: node.x, y: node.y, w: node.w, h: node.h };
    const move = (ev) => {
      const p = ev.touches?.[0] || ev;
      const dx = p.clientX - sx; const dy = p.clientY - sy;
      let { x, y, w, h } = init;
      if (dir.includes("e")) w = clamp(init.w + dx, 20, 10000);
      if (dir.includes("s")) h = clamp(init.h + dy, 20, 10000);
      if (dir.includes("w")) { w = clamp(init.w - dx, 20, 10000); x = init.x + dx; }
      if (dir.includes("n")) { h = clamp(init.h - dy, 20, 10000); y = init.y + dy; }
      onChange({ ...node, x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const style = {
    position: "absolute",
    left: node.x,
    top: node.y,
    width: node.w,
    height: node.h,
    userSelect: "none",
    cursor: "grab",
  };

  return (
    <div ref={ref} style={style} onClick={() => onSelect(node.id)}>
      {imgEl ? (
        <img src={node.src} alt="" draggable={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#eee" }} />
      )}

      {selected && (
        <>
          <div style={{ position: "absolute", inset: 0, border: "1px dashed #4f46e5", pointerEvents: "none" }} />
          {[
            ["nw", 0, 0],
            ["ne", "100%", 0],
            ["sw", 0, "100%"],
            ["se", "100%", "100%"],
          ].map(([dir, l, t]) => (
            <span
              key={dir}
              data-handle
              onPointerDown={(e) => startResize(dir, e)}
              style={{
                position: "absolute",
                left: typeof l === "number" ? l - 6 : l,
                top: typeof t === "number" ? t - 6 : t,
                width: 12, height: 12,
                background: "#fff", border: "1px solid #000",
                borderRadius: 2,
                transform: typeof l === "string" || typeof t === "string" ? "translate(-50%, -50%)" : undefined,
                cursor: `${dir}-resize`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ---------- main app ----------
export default function App() {
  // default 1080w × 1320h portrait
  const [boardW, setBoardW] = useState(1080);
  const [boardH, setBoardH] = useState(1320);
  const [boards, setBoards] = useState(6);
  const [showGrid, setShowGrid] = useState(true);

  // preview scale
  const [previewScale, setPreviewScale] = useState(1);
  const topBarRef = useRef(null);
  const secondBarRef = useRef(null);
  const wrapperRef = useRef(null);

  // layout + items
  const [spacing, setSpacing] = useState(24);
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  // export
  const [pixelRatio, setPixelRatio] = useState(2);
  const [exportBg, setExportBg] = useState("#fff");

  // overlay
  const [overlayUrl, setOverlayUrl] = useState("");
  const [overlayOpacity, setOverlayOpacity] = useState(0.25);

  // rectangles layer
  const [showRects, setShowRects] = useState(false);
  const [rects, setRects] = useState([]);

  const [rectCols, setRectCols] = useState(6);
  const [rectRows, setRectRows] = useState(5);
  const [rectMinWpc, setRectMinWpc] = useState(6);
  const [rectMaxWpc, setRectMaxWpc] = useState(22);
  const [rectMinHpc, setRectMinHpc] = useState(4);
  const [rectMaxHpc, setRectMaxHpc] = useState(18);
  const [rectOpacityMin, setRectOpacityMin] = useState(6);
  const [rectOpacityMax, setRectOpacityMax] = useState(14);
  const [rectColorA, setRectColorA] = useState("#0f172a");
  const [rectColorB, setRectColorB] = useState("#111827");

  const [lastEditorialTight, setLastEditorialTight] = useState(false);

  const SPREAD_W = useMemo(() => boards * boardW, [boards, boardW]);
  const SPREAD_H = boardH;

  // presets
  const PRESETS = [
    { label: "1080 × 1320 (Portrait)", w: 1080, h: 1320 },
    { label: "1320 × 1080 (Landscape)", w: 1320, h: 1080 },
    { label: "1080 × 1080 (Square)", w: 1080, h: 1080 },
    { label: "1920 × 1080 (16:9)", w: 1920, h: 1080 },
    { label: "1350 × 1080 (IG)", w: 1350, h: 1080 },
  ];

  // --- preview: fit 100% of available viewport height (after toolbars), never >1x (no blur)
  const fitPreview = useCallback(() => {
    const wEl = wrapperRef.current;
    if (!wEl) return;
    const topH = topBarRef.current?.getBoundingClientRect().height || 0;
    const secH = secondBarRef.current?.getBoundingClientRect().height || 0;
    const margins = 16; // bottom breathing room
    const availH = Math.max(100, window.innerHeight - topH - secH - margins);
    const availW = wEl.clientWidth - 2;
    const scaleH = availH / SPREAD_H;
    const scaleW = availW / SPREAD_W;
    const scale = Math.min(1, Math.min(scaleH, scaleW));
    setPreviewScale(isFinite(scale) && scale > 0 ? scale : 1);
  }, [SPREAD_W, SPREAD_H]);

  useEffect(() => {
    fitPreview();
    window.addEventListener("resize", fitPreview);
    return () => window.removeEventListener("resize", fitPreview);
  }, [fitPreview]);

  useEffect(() => { fitPreview(); }, [boardW, boardH, boards, fitPreview]);

  // add images
  const onDropFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    const read = (f) =>
      new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
    const newOnes = [];
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      const src = await read(f);
      const id = uid();
      const w = Math.floor(boardW * (0.25 + Math.random() * 0.35));
      const h = Math.floor(w * (0.6 + Math.random() * 0.35));
      newOnes.push({ id, src, x: 20, y: 20, w, h });
    }
    setItems((prev) => [...prev, ...newOnes]);
  }, [boardW]);

  // random sizes
  const randomiseSizes = useCallback(() => {
    setItems((prev) =>
      prev.map((n) => {
        const minW = boardW * 0.22, maxW = boardW * 0.65;
        const w = clamp(Math.floor(minW + Math.random() * (maxW - minW)), 40, Math.max(40, boardW));
        const h = Math.floor(w * (0.6 + Math.random() * 0.35));
        return { ...n, w, h };
      })
    );
  }, [boardW]);

  // ---------- AUTO-GROW PLACEMENT CORE ----------
  /**
   * Flow placement L→R, top→bottom. If a node won't fit in current spread,
   * increments boards (up to MAX) and tries again. Returns placed items and new board count.
   */
  function flowPlaceAutoGrow(sourceItems, tight) {
    const m = tight ? 0 : spacing;
    let b = Math.max(1, boards);
    const res = [];
    let x = 0, y = 0, rowH = 0;

    const tryPlaceAll = () => {
      x = 0; y = 0; rowH = 0;
      res.length = 0;
      const SPW = b * boardW;

      for (let i = 0; i < sourceItems.length; i++) {
        const n = sourceItems[i];
        let w = Math.min(n.w, Math.floor(boardW * 0.9));
        let h = Math.min(n.h, Math.floor(boardH * 0.9));
        if (w <= 0 || h <= 0) { w = 100; h = 80; }

        if (x + w > SPW) { // new row
          x = Math.floor(x / boardW) * boardW; // align to board boundary
          y += rowH + m;
          rowH = 0;
        }
        // push to next board if crossing boundary
        const rightEdge = Math.ceil((x + 1) / boardW) * boardW;
        if (x + w > rightEdge) {
          x = rightEdge + (m ? m : 0);
        }
        if (x + w > SPW) {
          // cannot fit in current boards
          return false;
        }
        if (y + h > boardH) {
          // new column (next board)
          x = (Math.floor(x / boardW) + 1) * boardW;
          y = 0;
          rowH = 0;
          if (x + w > SPW) return false;
        }

        res.push({ ...n, x, y, w, h });
        x += w + m;
        rowH = Math.max(rowH, h);
      }
      return true;
    };

    // first attempt with current boards then grow
    let ok = tryPlaceAll();
    while (!ok && b < MAX_BOARDS) {
      b += 1;
      ok = tryPlaceAll();
    }
    return { placed: ok ? res : sourceItems, usedBoards: b };
  }

  // random positions (non-auto-grow)
  const randomise = useCallback(() => {
    const placed = [];
    const tryPlace = (node) => {
      const minW = boardW * 0.22, maxW = boardW * 0.65;
      const w = clamp(Math.floor(minW + Math.random() * (maxW - minW)), 40, Math.max(40, boardW));
      const h = Math.floor(w * (0.6 + Math.random() * 0.35));
      for (let t = 0; t < 600; t++) {
        const x = Math.floor(Math.random() * Math.max(1, SPREAD_W - w));
        const y = Math.floor(Math.random() * Math.max(1, SPREAD_H - h));
        const cand = { ...node, x, y, w, h };
        const hit = placed.some((p) => rectsOverlapWithMargin(cand, p, spacing));
        if (!hit) { placed.push(cand); return cand; }
      }
      placed.push(node);
      return node;
    };
    setItems((prev) => prev.map(tryPlace));
  }, [SPREAD_W, SPREAD_H, spacing, boardW]);

  // pack using auto-grow scanning
  const packTop = useCallback(() => {
    const sorted = [...items].sort((a, b) => b.w * b.h - a.w * a.h);
    const { placed, usedBoards } = flowPlaceAutoGrow(sorted, false);
    setBoards(usedBoards);
    setItems(placed);
  }, [items]);

  const packBottom = useCallback(() => {
    // invert Y with a transform: place with flow then shift to bottom row-wise
    const sorted = [...items].sort((a, b) => b.w * b.h - a.w * a.h);
    const { placed, usedBoards } = flowPlaceAutoGrow(sorted, false);
    // snap rows toward bottom per board
    const byBoard = new Map();
    placed.forEach(n => {
      const bi = Math.floor(n.x / boardW);
      if (!byBoard.has(bi)) byBoard.set(bi, []);
      byBoard.get(bi).push(n);
    });
    byBoard.forEach((arr, bi) => {
      // compute rows by y
      arr.sort((a, b) => a.y - b.y);
      let cursor = boardH;
      let rowStart = 0;
      while (rowStart < arr.length) {
        let rowEnd = rowStart;
        let rowH = arr[rowStart].h;
        // same row if overlap in y-range approximately
        while (rowEnd + 1 < arr.length && Math.abs(arr[rowEnd + 1].y - arr[rowStart].y) < 12) {
          rowEnd++;
          rowH = Math.max(rowH, arr[rowEnd].h);
        }
        cursor -= rowH + spacing;
        for (let i = rowStart; i <= rowEnd; i++) {
          arr[i].y = Math.max(0, cursor);
        }
        rowStart = rowEnd + 1;
      }
    });
    setBoards(usedBoards);
    setItems(placed);
  }, [items, boardW, boardH, spacing]);

  const snapBottom = useCallback(() => {
    setItems((prev) => prev.map((n) => (n.id === selectedId ? { ...n, y: SPREAD_H - n.h - 1 } : n)));
  }, [selectedId, SPREAD_H]);

  const scatterBoards = useCallback(() => {
    const next = [...items];
    next.forEach((n, i) => {
      const target = i % boards;
      const xInBoard = clamp(n.x % boardW, 0, Math.max(0, boardW - n.w));
      next[i] = { ...n, x: target * boardW + xInBoard };
    });
    setItems(next);
  }, [items, boards, boardW]);

  // z-order
  const bringForward = () => {
    if (!selectedId) return;
    const idx = items.findIndex((n) => n.id === selectedId);
    if (idx < 0 || idx === items.length - 1) return;
    const next = [...items];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    setItems(next);
  };
  const sendBackward = () => {
    if (!selectedId) return;
    const idx = items.findIndex((n) => n.id === selectedId);
    if (idx <= 0) return;
    const next = [...items];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    setItems(next);
  };
  const bringToFront = () => {
    if (!selectedId) return;
    const idx = items.findIndex((n) => n.id === selectedId);
    if (idx < 0) return;
    const next = [...items];
    const [it] = next.splice(idx, 1);
    next.push(it);
    setItems(next);
  };
  const sendToBack = () => {
    if (!selectedId) return;
    const idx = items.findIndex((n) => n.id === selectedId);
    if (idx < 0) return;
    const next = [...items];
    const [it] = next.splice(idx, 1);
    next.unshift(it);
    setItems(next);
  };

  // ---------- EDITORIAL LAYOUTS WITH AUTO-GROW ----------
  function firstPageThreeUp(arr, tight) {
    if (arr.length < 1) return arr;
    const s = [...arr];

    const hero = s[0];
    const b1 = s[1] || null;
    const b2 = s[2] || null;

    const m = tight ? 0 : spacing;
    const heroH = Math.round(boardH * 0.56);
    const bottomH = boardH - heroH - (tight ? 0 : m);
    const leftW = b2 ? Math.floor((boardW - (tight ? 0 : m)) / 2) : boardW;

    s[0] = { ...hero, x: 0, y: 0, w: boardW, h: heroH };
    if (b1) s[1] = { ...b1, x: 0, y: heroH + (tight ? 0 : m), w: leftW, h: bottomH };
    if (b2) {
      const x2 = leftW + (tight ? 0 : m);
      const w2 = boardW - x2;
      s[2] = { ...b2, x: x2, y: heroH + (tight ? 0 : m), w: w2, h: bottomH };
    }
    return s;
  }

  const autoSpread = (tight) => {
    // keep first page rule, then flow the rest with auto-grow
    const m = tight ? 0 : spacing;
    const s = [...items];
    let startIdx = 0;

    if (s.length >= 1) {
      const first = firstPageThreeUp(s.slice(0, 3), tight);
      s.splice(0, first.length, ...first);
      startIdx = 3;
    }

    const head = s.slice(0, startIdx);
    const tail = s.slice(startIdx);
    const { placed, usedBoards } = flowPlaceAutoGrow(tail, tight);

    // shift placed tail to start at board 1 (not page 0), so keep page 0 for first 3-up
    const shifted = placed.map(n => ({ ...n, x: n.x + boardW + (m ? m : 0) }));
    setBoards(usedBoards); // usedBoards already counts from 1, but we added a margin; still fine
    setItems([...head, ...shifted]);
    setLastEditorialTight(tight);
  };

  const editorialSpaced = () => autoSpread(false);
  const editorialTight = () => autoSpread(true);
  const shuffleOrder = () => {
    setItems((prev) => {
      const arr = [...prev];
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    });
    // re-run the last editorial style to keep layout intention
    setTimeout(() => autoSpread(lastEditorialTight), 0);
  };

  // ---------- BACKGROUND RECTS ----------
  const generateRects = useCallback(() => {
    const list = [];
    const cols = Math.max(1, rectCols);
    const rows = Math.max(1, rectRows);
    const minW = Math.floor(boardW * (rectMinWpc / 100));
    const maxW = Math.floor(boardW * (rectMaxWpc / 100));
    const minH = Math.floor(boardH * (rectMinHpc / 100));
    const maxH = Math.floor(boardH * (rectMaxHpc / 100));
    const oMin = clamp(rectOpacityMin / 100, 0, 1);
    const oMax = clamp(rectOpacityMax / 100, 0, 1);

    for (let b = 0; b < boards; b++) {
      for (let i = 0; i < cols * rows; i++) {
        const w = Math.floor(minW + Math.random() * Math.max(1, maxW - minW));
        const h = Math.floor(minH + Math.random() * Math.max(1, maxH - minH));
        const x = b * boardW + Math.floor(Math.random() * Math.max(1, boardW - w));
        const y = Math.floor(Math.random() * Math.max(1, boardH - h));
        const color = Math.random() < 0.5 ? rectColorA : rectColorB;
        const opacity = oMin + Math.random() * Math.max(0, oMax - oMin);
        list.push({ x, y, w, h, color, opacity });
      }
    }
    setRects(list);
  }, [
    boards, boardW, boardH,
    rectCols, rectRows,
    rectMinWpc, rectMaxWpc, rectMinHpc, rectMaxHpc,
    rectOpacityMin, rectOpacityMax, rectColorA, rectColorB
  ]);

  useEffect(() => { if (showRects) generateRects(); }, [showRects, generateRects]);

  // export helpers
  const triggerDownload = (url, filename) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  const loadImageOnce = (url) =>
    new Promise((resolve) => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });

  const exportBoards = useCallback(
    async (type = "image/png", quality = 0.95, zipMode = false) => {
      if (items.some((n) => n.src && !n._img)) {
        alert("Images are still loading. Try export again in a moment.");
        return;
      }

      const zip = new JSZip();
      const overlayImg = await loadImageOnce(overlayUrl);

      for (let i = 0; i < boards; i++) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(boardW * pixelRatio);
        canvas.height = Math.round(boardH * pixelRatio);
        const ctx = canvas.getContext("2d");

        if (exportBg || type === "image/jpeg") {
          ctx.fillStyle = exportBg || "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // rects
        if (showRects && rects.length) {
          const bx = i * boardW;
          rects.forEach((r) => {
            if (r.x + r.w <= bx || r.x >= bx + boardW) return;
            const dx = Math.max(0, r.x - bx);
            ctx.globalAlpha = r.opacity;
            ctx.fillStyle = r.color;
            ctx.fillRect(
              Math.round(dx * pixelRatio),
              Math.round(r.y * pixelRatio),
              Math.round(r.w * pixelRatio),
              Math.round(r.h * pixelRatio)
            );
            ctx.globalAlpha = 1;
          });
        }

        // images
        const boardX = i * boardW;
        for (const n of items) {
          if (!n._img) continue;
          const inter = intersectRect(n.x, n.y, n.w, n.h, boardX, 0, boardW, boardH);
          if (!inter) continue;
          const { sx, sy, sw, sh } = coverSourceRect(
            n._img.naturalWidth, n._img.naturalHeight,
            n.w, n.h,
            inter.x - n.x, inter.y - n.y, inter.w, inter.h
          );
          if (sw <= 0 || sh <= 0) continue;

          ctx.drawImage(
            n._img, sx, sy, sw, sh,
            Math.round((inter.x - boardX) * pixelRatio),
            Math.round(inter.y * pixelRatio),
            Math.round(inter.w * pixelRatio),
            Math.round(inter.h * pixelRatio)
          );
        }

        // overlay
        if (overlayImg) {
          ctx.save();
          ctx.globalAlpha = clamp(overlayOpacity, 0, 1);
          ctx.drawImage(
            overlayImg,
            0, 0, overlayImg.naturalWidth, overlayImg.naturalHeight,
            0, 0, canvas.width, canvas.height
          );
          ctx.restore();
        }

        const dataUrl = canvas.toDataURL(type, quality);
        const ext = type === "image/jpeg" ? "jpg" : "png";
        const name = `858 art club_${i + 1}.${ext}`;

        if (zipMode) {
          zip.file(name, dataUrl.split(",")[1], { base64: true });
        } else {
          triggerDownload(dataUrl, name);
        }
      }

      if (zipMode) {
        const blob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(blob);
        triggerDownload(url, "858 art club.zip");
        URL.revokeObjectURL(url);
      }
    },
    [items, boards, boardW, boardH, pixelRatio, exportBg, overlayUrl, overlayOpacity, showRects, rects]
  );

  const onOverlayUpload = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setOverlayUrl(url);
  };

  const applyPreset = (p) => {
    setBoardW(p.w);
    setBoardH(p.h);
    setTimeout(() => fitPreview(), 0);
  };

  return (
    <div
      className="app"
      style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); onDropFiles(e.dataTransfer.files); }}
    >
      {/* Top toolbar */}
      <div ref={topBarRef} className="toolbar" style={{ gap: 6, flexWrap: "wrap", display: "flex", alignItems: "center" }}>
        <strong>858 Random Spread Layout</strong>

        <span className="muted">Boards</span>
        <select value={boards} onChange={(e) => setBoards(clamp(parseInt(e.target.value, 10), 1, MAX_BOARDS))}>
          {Array.from({ length: MAX_BOARDS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <span className="muted">Preset</span>
        <select onChange={(e) => applyPreset(PRESETS[e.target.selectedIndex])}>
          {PRESETS.map((p) => (<option key={p.label}>{p.label}</option>))}
        </select>

        <span className="muted">W</span>
        <input type="number" value={boardW} onChange={(e) => setBoardW(clamp(parseInt(e.target.value || "1", 10), 200, 8000))} style={{ width: 80 }} />

        <span className="muted">H</span>
        <input type="number" value={boardH} onChange={(e) => setBoardH(clamp(parseInt(e.target.value || "1", 10), 200, 8000))} style={{ width: 80 }} />

        <span className="muted">Spacing</span>
        <input type="number" value={spacing} onChange={(e) => setSpacing(clamp(parseInt(e.target.value || "0", 10), 0, 400))} style={{ width: 70 }} />

        <button onClick={randomiseSizes}>Rand Sizes</button>
        <button onClick={randomise}>Randomise</button>
        <button onClick={packTop}>Pack</button>
        <button onClick={packBottom}>Pack Bottom</button>
        <button onClick={snapBottom}>Snap Bottom</button>
        <button onClick={scatterBoards}>Scatter Boards</button>

        <button onClick={() => setShowGrid((s) => !s)}>Toggle Grid</button>

        <span className="muted">Export Scale</span>
        <input type="number" min={1} max={4} value={pixelRatio} onChange={(e) => setPixelRatio(clamp(parseInt(e.target.value || "1", 10), 1, 4))} style={{ width: 50 }} />

        <select value={exportBg ? "white" : "transparent"} onChange={(e) => setExportBg(e.target.value === "white" ? "#fff" : "")}>
          <option value="white">White BG</option>
          <option value="transparent">Transparent PNG</option>
        </select>

        <button onClick={() => exportBoards("image/png")}>Export PNG</button>
        <button onClick={() => exportBoards("image/jpeg")}>Export JPG</button>
        <button onClick={() => exportBoards("image/png", 0.95, true)}>Export ZIP</button>
      </div>

      {/* Secondary toolbar */}
      <div ref={secondBarRef} className="toolbar" style={{ gap: 6, display: "flex", flexWrap: "wrap", alignItems: "center" }}>
        <strong>Editorial</strong>
        <button onClick={() => autoSpread(false)}>Auto Spread</button>
        <button onClick={() => autoSpread(true)}>Auto Spread (tight)</button>
        <button onClick={shuffleOrder}>Shuffle order</button>

        <strong style={{ marginLeft: 8 }}>Background</strong>
        <button onClick={() => setShowRects((s) => !s)}>{showRects ? "Hide Rects" : "Show Rects"}</button>
        <button onClick={generateRects} disabled={!showRects}>Regenerate</button>

        <span className="muted">Cols</span>
        <input type="number" min={1} max={20} value={rectCols} onChange={(e) => setRectCols(clamp(parseInt(e.target.value||"1",10),1,20))} style={{ width: 60 }} />
        <span className="muted">Rows</span>
        <input type="number" min={1} max={20} value={rectRows} onChange={(e) => setRectRows(clamp(parseInt(e.target.value||"1",10),1,20))} style={{ width: 60 }} />

        <span className="muted">W%</span>
        <input type="number" min={1} max={100} value={rectMinWpc} onChange={(e)=>setRectMinWpc(clamp(parseInt(e.target.value||"1",10),1,100))} style={{ width: 55 }} />
        <span className="muted">→</span>
        <input type="number" min={1} max={100} value={rectMaxWpc} onChange={(e)=>setRectMaxWpc(clamp(parseInt(e.target.value||"1",10),1,100))} style={{ width: 55 }} />

        <span className="muted">H%</span>
        <input type="number" min={1} max={100} value={rectMinHpc} onChange={(e)=>setRectMinHpc(clamp(parseInt(e.target.value||"1",10),1,100))} style={{ width: 55 }} />
        <span className="muted">→</span>
        <input type="number" min={1} max={100} value={rectMaxHpc} onChange={(e)=>setRectMaxHpc(clamp(parseInt(e.target.value||"1",10),1,100))} style={{ width: 55 }} />

        <span className="muted">Opacity</span>
        <input type="number" min={0} max={100} value={rectOpacityMin} onChange={(e)=>setRectOpacityMin(clamp(parseInt(e.target.value||"0",10),0,100))} style={{ width: 55 }} />
        <span className="muted">→</span>
        <input type="number" min={0} max={100} value={rectOpacityMax} onChange={(e)=>setRectOpacityMax(clamp(parseInt(e.target.value||"0",10),0,100))} style={{ width: 55 }} />

        <span className="muted">Colour A</span>
        <input type="color" value={rectColorA} onChange={(e)=>setRectColorA(e.target.value)} />
        <span className="muted">Colour B</span>
        <input type="color" value={rectColorB} onChange={(e)=>setRectColorB(e.target.value)} />

        <strong style={{ marginLeft: 8 }}>Overlay</strong>
        <label>
          Upload
          <input type="file" accept="image/*" style={{ marginLeft: 6 }} onChange={(e) => e.target.files && onOverlayUpload(e.target.files[0])} />
        </label>
        <span className="muted">Opacity</span>
        <input type="range" min={0} max={1} step={0.01} value={overlayOpacity} onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))} style={{ width: 140 }} />
        <span className="muted">{Math.round(overlayOpacity * 100)}%</span>

        <strong style={{ marginLeft: 8 }}>Stack</strong>
        <button onClick={sendToBack}>Send to Back</button>
        <button onClick={sendBackward}>Send Backward</button>
        <button onClick={bringForward}>Bring Forward</button>
        <button onClick={bringToFront}>Bring to Front</button>

        <label style={{ marginLeft: 8 }}>
          Add images
          <input type="file" multiple accept="image/*" style={{ marginLeft: 6 }} onChange={(e) => e.target.files && onDropFiles(e.target.files)} />
        </label>
      </div>

      {/* Spread preview (fills available viewport height at 100% scale-or-under) */}
      <div
        ref={wrapperRef}
        className="spreadWrapper"
        style={{ border: "1px solid #e5e7eb", overflowX: "auto", overflowY: "hidden", width: "100%" }}
        onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}
      >
        <div
          style={{
            position: "relative",
            width: SPREAD_W,
            height: SPREAD_H,
            transform: `scale(${previewScale})`,
            transformOrigin: "top left",
            background: "#fff",
          }}
        >
          {/* grid */}
          {showGrid &&
            Array.from({ length: boards }, (_, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: i * boardW,
                  top: 0,
                  width: boardW,
                  height: boardH,
                  border: "1px solid #e5e7eb",
                  pointerEvents: "none",
                }}
              />
            ))}

          {/* background rectangles */}
          {showRects &&
            rects.map((r, idx) => (
              <div
                key={idx}
                style={{
                  position: "absolute",
                  left: r.x,
                  top: r.y,
                  width: r.w,
                  height: r.h,
                  background: r.color,
                  opacity: r.opacity,
                  pointerEvents: "none",
                }}
              />
            ))}

          {/* items */}
          {items.map((n) => (
            <Item
              key={n.id}
              node={n}
              selected={n.id === selectedId}
              onSelect={setSelectedId}
              onChange={(next) => setItems((prev) => prev.map((x) => (x.id === n.id ? next : x)))}
            />
          ))}

          {/* overlay preview */}
          {overlayUrl && (
            <img
              src={overlayUrl}
              alt="overlay"
              draggable={false}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                opacity: clamp(overlayOpacity, 0, 1),
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </div>

      <div className="muted" style={{ opacity: 0.7 }}>
        Preview fits remaining viewport height at 100% scale or under. Auto Spread, Pack, and Pack Bottom will add boards if needed to avoid overlaps.
      </div>
    </div>
  );
}
