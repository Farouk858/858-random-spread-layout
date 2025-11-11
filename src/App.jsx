import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/**
 * 858 Random Spread Layout — Pure React
 * No external canvas libs. Works on desktop and mobile.
 *
 * Features
 * - Adjustable artboard size (default 1320 × 1080), up to 20 boards
 * - Drag and resize images; z-order controls
 * - Randomise positions with spacing; randomise sizes
 * - Pack from top, Pack from bottom, Snap selected to bottom, Scatter across boards
 * - Toggle grid, fit-to-height preview (no vertical scroll)
 * - Overlay PNG with opacity
 * - PNG / JPG export per board and ZIP export (file names start “858 art club”)
 * - Correct object-fit: cover maths on export (no stretching)
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

// map node-local visible rect to source crop for COVER fit
function coverSourceRect(imgW, imgH, nodeW, nodeH, nx, ny, nw, nh) {
  const scale = Math.max(nodeW / imgW, nodeH / imgH); // cover
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
                background: "#fff",
                border: "1px solid #000",
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
  // artboards
  const [boardW, setBoardW] = useState(1320);
  const [boardH, setBoardH] = useState(1080);
  const [boards, setBoards] = useState(6);
  const [showGrid, setShowGrid] = useState(true);

  // layout + preview
  const [spacing, setSpacing] = useState(24);
  const [previewScale, setPreviewScale] = useState(1);

  // items
  const [items, setItems] = useState([]); // {id, src, x,y,w,h, _img}
  const [selectedId, setSelectedId] = useState(null);

  // export
  const [pixelRatio, setPixelRatio] = useState(2);
  const [exportBg, setExportBg] = useState("#fff"); // blank means transparent PNG

  // overlay
  const [overlayUrl, setOverlayUrl] = useState(""); // set via upload
  const [overlayOpacity, setOverlayOpacity] = useState(0.25);

  const SPREAD_W = useMemo(() => boards * boardW, [boards, boardW]);
  const SPREAD_H = boardH;

  // fit height
  const fitHeight = useCallback(() => {
    const avail = Math.max(220, window.innerHeight - 170);
    const scale = Math.min(1, avail / SPREAD_H);
    setPreviewScale(scale);
  }, [SPREAD_H]);

  useEffect(() => {
    fitHeight();
    window.addEventListener("resize", fitHeight);
    return () => window.removeEventListener("resize", fitHeight);
  }, [fitHeight]);

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

  // randomise positions with spacing
  const randomise = useCallback(() => {
    const placed = [];
    const tryPlace = (node) => {
      const minW = boardW * 0.22, maxW = boardW * 0.65;
      const w = clamp(Math.floor(minW + Math.random() * (maxW - minW)), 40, SPREAD_W);
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

  // randomise sizes only
  const randomiseSizes = useCallback(() => {
    setItems((prev) =>
      prev.map((n) => {
        const minW = boardW * 0.22, maxW = boardW * 0.65;
        const w = clamp(Math.floor(minW + Math.random() * (maxW - minW)), 40, SPREAD_W);
        const h = Math.floor(w * (0.6 + Math.random() * 0.35));
        return { ...n, w, h };
      })
    );
  }, [boardW, SPREAD_W]);

  // pack from top
  const packTop = useCallback(() => {
    const sorted = [...items].sort((a, b) => b.w * b.h - a.w * a.h);
    const placed = [];
    const step = Math.max(8, spacing);
    const place = (n) => {
      for (let y = 0; y <= SPREAD_H - n.h; y += step) {
        for (let x = 0; x <= SPREAD_W - n.w; x += step) {
          const cand = { ...n, x, y };
          if (!placed.some((p) => rectsOverlapWithMargin(cand, p, spacing))) { placed.push(cand); return cand; }
        }
      }
      placed.push(n); return n;
    };
    setItems(sorted.map(place));
  }, [items, SPREAD_W, SPREAD_H, spacing]);

  // pack from bottom
  const packBottom = useCallback(() => {
    const sorted = [...items].sort((a, b) => b.w * b.h - a.w * a.h);
    const placed = [];
    const step = Math.max(8, spacing);
    const place = (n) => {
      for (let y = SPREAD_H - n.h; y >= 0; y -= step) {
        for (let x = 0; x <= SPREAD_W - n.w; x += step) {
          const cand = { ...n, x, y };
          if (!placed.some((p) => rectsOverlapWithMargin(cand, p, spacing))) { placed.push(cand); return cand; }
        }
      }
      placed.push(n); return n;
    };
    setItems(sorted.map(place));
  }, [items, SPREAD_W, SPREAD_H, spacing]);

  // snap selected to bottom
  const snapBottom = useCallback(() => {
    setItems((prev) => prev.map((n) => (n.id === selectedId ? { ...n, y: SPREAD_H - n.h - 1 } : n)));
  }, [selectedId, SPREAD_H]);

  // scatter evenly across boards
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

  // export per board, optional ZIP
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

        const boardX = i * boardW;

        for (const n of items) {
          if (!n._img) continue;
          const inter = intersectRect(n.x, n.y, n.w, n.h, boardX, 0, boardW, boardH);
          if (!inter) continue;

          const nx = inter.x - n.x;
          const ny = inter.y - n.y;
          const nw = inter.w;
          const nh = inter.h;

          const { sx, sy, sw, sh } = coverSourceRect(
            n._img.naturalWidth,
            n._img.naturalHeight,
            n.w,
            n.h,
            nx,
            ny,
            nw,
            nh
          );
          if (sw <= 0 || sh <= 0) continue;

          const dx = Math.round((inter.x - boardX) * pixelRatio);
          const dy = Math.round(inter.y * pixelRatio);
          const dw = Math.round(nw * pixelRatio);
          const dh = Math.round(nh * pixelRatio);

          ctx.drawImage(n._img, sx, sy, sw, sh, dx, dy, dw, dh);
        }

        // overlay
        if (overlayImg) {
          ctx.save();
          ctx.globalAlpha = clamp(overlayOpacity, 0, 1);
          ctx.drawImage(
            overlayImg,
            0,
            0,
            overlayImg.naturalWidth,
            overlayImg.naturalHeight,
            0,
            0,
            canvas.width,
            canvas.height
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
    [items, boards, boardW, boardH, pixelRatio, exportBg, overlayUrl, overlayOpacity]
  );

  // ui handlers
  const onOverlayUpload = (file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setOverlayUrl(url);
  };

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropFiles(e.dataTransfer.files);
      }}
    >
      {/* Toolbar */}
      <div className="toolbar" style={{ gap: 6, flexWrap: "wrap" }}>
        <span className="muted">Boards</span>
        <select
          value={boards}
          onChange={(e) => setBoards(clamp(parseInt(e.target.value, 10), 1, MAX_BOARDS))}
        >
          {Array.from({ length: MAX_BOARDS }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>

        <span className="muted">Width</span>
        <input type="number" value={boardW} onChange={(e) => setBoardW(clamp(parseInt(e.target.value || "1", 10), 200, 8000))} style={{ width: 80 }} />

        <span className="muted">Height</span>
        <input type="number" value={boardH} onChange={(e) => setBoardH(clamp(parseInt(e.target.value || "1", 10), 200, 8000))} style={{ width: 80 }} />

        <button onClick={() => setTimeout(fitHeight, 0)}>Apply Size</button>

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

      {/* Overlay controls */}
      <div className="toolbar" style={{ gap: 8 }}>
        <span className="muted">Overlay</span>
        <label>
          Upload
          <input type="file" accept="image/*" style={{ marginLeft: 6 }} onChange={(e) => e.target.files && onOverlayUpload(e.target.files[0])} />
        </label>
        <span className="muted">Opacity</span>
        <input type="range" min={0} max={1} step={0.01} value={overlayOpacity} onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))} style={{ width: 160 }} />
        <span className="muted">{Math.round(overlayOpacity * 100)}%</span>

        {/* z-order for selected */}
        <button onClick={sendToBack}>Send to Back</button>
        <button onClick={sendBackward}>Send Backward</button>
        <button onClick={bringForward}>Bring Forward</button>
        <button onClick={bringToFront}>Bring to Front</button>

        {/* add images */}
        <label>
          Add images
          <input type="file" multiple accept="image/*" style={{ marginLeft: 6 }} onChange={(e) => e.target.files && onDropFiles(e.target.files)} />
        </label>
      </div>

      {/* Spread preview */}
      <div
        className="spreadWrapper"
        style={{ height: SPREAD_H * previewScale }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
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

      <div className="muted">Preview auto-fits height. Exports at full resolution of the current artboard size.</div>
    </div>
  );
}
