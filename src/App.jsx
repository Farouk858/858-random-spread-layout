import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/**
 * 858 Random Spread Layout — Pro (restored)
 * - Board presets, full toolset, overlays with favourites, presets, export
 * - No external render libs. Canvas export only; DOM for preview.
 */

// ---------- constants ----------
const MAX_BOARDS = 20;
const PRESETS = [
  { label: "1080 x 1320 (Portrait)", w: 1080, h: 1320 },
  { label: "1320 x 1080 (Landscape)", w: 1320, h: 1080 },
  { label: "1920 x 1080 (16:9)", w: 1920, h: 1080 },
  { label: "1080 x 1080 (Square)", w: 1080, h: 1080 },
  { label: "2480 x 3508 (A4 Portrait)", w: 2480, h: 3508 },
  { label: "3508 x 2480 (A4 Landscape)", w: 3508, h: 2480 },
];

const DEFAULT_W = 1080;
const DEFAULT_H = 1320;
const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// ---------- geometry helpers ----------
const overlapWith = (a, b, m) =>
  !(
    a.x + a.w + m <= b.x ||
    b.x + b.w + m <= a.x ||
    a.y + a.h + m <= b.y ||
    b.y + b.h + m <= a.y
  );

function intersect(ax, ay, aw, ah, bx, by, bw, bh) {
  const x1 = Math.max(ax, bx);
  const y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw);
  const y2 = Math.min(ay + ah, by + bh);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  return { x: x1, y: y1, w, h };
}

// ---------- image hook ----------
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

// ---------- overlay drawing (preview+export) ----------
function drawOverlayOnCanvas(ctx, ov, scale = 1) {
  const x = ov.x * scale;
  const y = ov.y * scale;
  const w = ov.w * scale;
  const h = ov.h * scale;
  ctx.globalAlpha = ov.opacity ?? 1;
  ctx.fillStyle = ov.fill || "#00FF6A";
  ctx.strokeStyle = ov.fill || "#00FF6A";
  ctx.lineWidth = Math.max(1, 2 * scale);

  switch (ov.kind) {
    case "bar":
    case "rect":
      ctx.fillRect(x, y, w, h);
      break;
    case "circle": {
      const r = Math.min(w, h) / 2;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "plus": {
      const t = Math.min(w, h) * 0.2;
      // vertical
      ctx.fillRect(x + (w - t) / 2, y, t, h);
      // horizontal
      ctx.fillRect(x, y + (h - t) / 2, w, t);
      break;
    }
    case "cross": {
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2);
      ctx.rotate(Math.PI / 4);
      const t2 = Math.min(w, h) * 0.18;
      ctx.fillRect(-t2 / 2, -h / 2, t2, h);
      ctx.fillRect(-w / 2, -t2 / 2, w, t2);
      ctx.restore();
      break;
    }
    case "image": {
      if (ov._img) {
        ctx.drawImage(ov._img, x, y, w, h);
      }
      break;
    }
    default:
      break;
  }
  ctx.globalAlpha = 1;
}

// ---------- Item (draggable/resizable) ----------
function Item({ node, selected, onSelect, onChange }) {
  const ref = useRef(null);
  const imgEl = useImageElement(node.src);

  useEffect(() => {
    if (imgEl && node._imageEl !== imgEl) {
      onChange({ ...node, _imageEl: imgEl });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl]);

  // drag
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let sx = 0,
      sy = 0,
      ox = 0,
      oy = 0,
      dragging = false;

    const down = (e) => {
      if (e.target.dataset.handle) return;
      dragging = true;
      const p = e.touches?.[0] || e;
      sx = p.clientX;
      sy = p.clientY;
      ox = node.x;
      oy = node.y;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      onSelect();
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches?.[0] || e;
      const dx = p.clientX - sx;
      const dy = p.clientY - sy;
      onChange({ ...node, x: ox + dx, y: oy + dy });
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
    const sx = p0.clientX;
    const sy = p0.clientY;
    const init = { x: node.x, y: node.y, w: node.w, h: node.h };
    const move = (ev) => {
      const p = ev.touches?.[0] || ev;
      const dx = p.clientX - sx;
      const dy = p.clientY - sy;
      let { x, y, w, h } = init;
      if (dir.includes("e")) w = clamp(init.w + dx, 10, 99999);
      if (dir.includes("s")) h = clamp(init.h + dy, 10, 99999);
      if (dir.includes("w")) {
        w = clamp(init.w - dx, 10, 99999);
        x = init.x + dx;
      }
      if (dir.includes("n")) {
        h = clamp(init.h - dy, 10, 99999);
        y = init.y + dy;
      }
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
    overflow: "hidden",
    cursor: "grab",
    userSelect: "none",
  };

  return (
    <div ref={ref} style={style} onClick={onSelect}>
      {imgEl ? (
        <img
          src={node.src}
          alt=""
          draggable={false}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#222" }} />
      )}
      {selected && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              border: "1px dashed #5eead4",
              pointerEvents: "none",
            }}
          />
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
                width: 12,
                height: 12,
                background: "white",
                border: "1px solid #000",
                borderRadius: 2,
                transform:
                  typeof l === "string" || typeof t === "string"
                    ? "translate(-50%, -50%)"
                    : undefined,
                cursor: `${dir}-resize`,
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}

// ---------- main ----------
export default function App() {
  // boards + geometry
  const [boards, setBoards] = useState(6);
  const [boardW, setBoardW] = useState(DEFAULT_W);
  const [boardH, setBoardH] = useState(DEFAULT_H);
  const [presetIndex, setPresetIndex] = useState(0);
  const [spacing, setSpacing] = useState(24);
  const [exportScale, setExportScale] = useState(2);

  // images
  const [images, setImages] = useState([]);
  const [selectedId, setSelectedId] = useState(null);

  // overlays
  const [overlays, setOverlays] = useState([]); // {id, kind, x,y,w,h,fill,opacity,_img?}
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [overlayColourA, setOverlayColourA] = useState("#00ff6a");
  const [overlayColourB, setOverlayColourB] = useState("#00ff6a");
  const [colourSlots, setColourSlots] = useState(["#00ff6a", "#ffffff", "#000000", "#ff00ff", "#00ffff", "#ffff00"]);

  // preview + guides
  const [previewZoom, setPreviewZoom] = useState(0.75);
  const [showGrid, setShowGrid] = useState(true);
  const [gridColour, setGridColour] = useState("#00ff6a");
  const [gridOpacity, setGridOpacity] = useState(0.5);

  // export BG
  const [exportBg, setExportBg] = useState("#000000");

  // computed
  const spreadW = useMemo(() => boards * boardW, [boards, boardW]);
  const spreadH = useMemo(() => boardH, [boardH]);
  const imgCount = images.length;

  // default preset 1080x1320
  useEffect(() => {
    const def = PRESETS.findIndex((p) => p.w === DEFAULT_W && p.h === DEFAULT_H);
    setPresetIndex(Math.max(0, def));
  }, []);

  // map natural size for export scaling
  useEffect(() => {
    setImages((prev) =>
      prev.map((n) => {
        if (n._imageEl) {
          n._imageEl._placedW = n.w;
          n._imageEl._placedH = n.h;
        }
        return n;
      })
    );
  }, [images]);

  // file helpers
  const readAsDataURL = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  const addFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      const newItems = [];
      for (const f of files) {
        if (!f.type?.startsWith("image/")) continue;
        const src = await readAsDataURL(f);
        const id = uid();
        const w = Math.floor(boardW * (0.32 + Math.random() * 0.28));
        const h = Math.floor(w * (0.65 + Math.random() * 0.35));
        newItems.push({ id, src, x: 20, y: 20, w, h });
      }
      setImages((prev) => [...prev, ...newItems]);
    },
    [boardW]
  );

  const onAddImages = (e) => e.target.files && addFiles(e.target.files);

  // shuffle helper
  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };
  const copyList = (list) => list.map((n) => ({ ...n }));

  // ensure inside bounds
  const clampToBoards = (n) => {
    const w = clamp(n.w, 4, boardW);
    const h = clamp(n.h, 4, boardH);
    let x = clamp(n.x, 0, spreadW - w);
    const b = Math.floor(x / boardW);
    const bx = b * boardW;
    x = clamp(x, bx, bx + boardW - w);
    const y = clamp(n.y, 0, boardH - h);
    return { ...n, x, y, w, h };
  };

  const fixBounds = () => setImages((prev) => prev.map(clampToBoards));

  // ---------- layouts ----------
  const randomise = useCallback(
    (opts = { spreadVertical: true, acrossBoards: true }) => {
      const placed = [];
      const src = copyList(images);
      shuffleInPlace(src);
      let nextBoard = 0;

      const place = (node) => {
        const maxTries = 400;
        const minW = boardW * 0.25;
        const maxW = boardW * 0.65;
        const w = Math.floor(minW + Math.random() * (maxW - minW));
        const h = Math.floor(w * (0.6 + Math.random() * 0.4));
        for (let t = 0; t < maxTries; t++) {
          const bi = opts.acrossBoards ? ((nextBoard + t) % boards) : Math.floor(Math.random() * boards);
          const bx = bi * boardW;
          const x = Math.floor(bx + Math.random() * (boardW - w));
          const y = opts.spreadVertical
            ? Math.floor(Math.random() * Math.max(1, boardH - h))
            : Math.floor((boardH - h) * Math.random() * 0.6);
          const c = { ...node, x, y, w, h };
          const hit = placed.some((p) => overlapWith(c, p, spacing));
          if (!hit) {
            placed.push(c);
            nextBoard = (bi + 1) % boards;
            return c;
          }
        }
        // fallback
        const bi = nextBoard;
        nextBoard = (nextBoard + 1) % boards;
        const bx = bi * boardW;
        const c = { ...node, x: bx + 2, y: 2, w: Math.min(maxW, boardW - spacing * 2), h: Math.min(Math.floor(maxW * 0.75), boardH - spacing * 2) };
        placed.push(c);
        return c;
      };

      setImages(src.map(place));
    },
    [images, boards, boardW, boardH, spacing]
  );

  const randomSizesOnly = () => {
    setImages((prev) =>
      prev.map((n) => {
        const w = Math.floor(boardW * (0.28 + Math.random() * 0.5));
        const h = Math.floor(w * (0.6 + Math.random() * 0.4));
        return clampToBoards({ ...n, w, h });
      })
    );
  };

  const editorial = useCallback(
    (gap = spacing) => {
      const src = copyList(images);
      shuffleInPlace(src);
      const colsPerBoard = 2 + Math.floor(Math.random() * 3);
      const placed = [];
      let idx = 0;
      for (let b = 0; b < boards; b++) {
        const bx = b * boardW;
        const colW = Math.floor((boardW - gap * (colsPerBoard + 1)) / colsPerBoard);
        let colX = bx + gap;
        for (let c = 0; c < colsPerBoard; c++) {
          let y = gap;
          while (idx < src.length && y < boardH - gap) {
            const n = src[idx++];
            const h = Math.min(Math.floor(colW * (0.75 + Math.random() * 0.6)), boardH - y - gap);
            const node = { ...n, x: colX, y, w: colW, h };
            if (!placed.some((p) => overlapWith(node, p, gap * 0.5))) {
              placed.push(node);
              y += h + gap;
            } else {
              y += Math.max(8, gap);
              idx--;
            }
          }
          colX += colW + gap;
        }
      }
      setImages(placed);
    },
    [images, boards, boardW, boardH, spacing]
  );

  const editorialSeamless = () => editorial(0);

  // Hero first page: one wide top, two bottom edge-to-edge
  const heroFirstPage = () => {
    if (images.length < 3) return;
    const rest = copyList(images);
    const first3 = rest.splice(0, 3);
    const a = first3[0], b = first3[1], c = first3[2];

    const topH = Math.floor(boardH * 0.55);
    const botH = boardH - topH;

    const placed = [];
    placed.push({ ...a, x: 0, y: 0, w: boardW, h: topH });
    placed.push({ ...b, x: 0, y: topH, w: Math.floor(boardW / 2), h: botH });
    placed.push({ ...c, x: Math.floor(boardW / 2), y: topH, w: boardW - Math.floor(boardW / 2), h: botH });

    // keep others random in next boards
    let xOff = boardW;
    let bi = 1;
    for (const n of rest) {
      const w = Math.floor(boardW * (0.35 + Math.random() * 0.35));
      const h = Math.floor(w * (0.6 + Math.random() * 0.4));
      const x = xOff + Math.floor(Math.random() * (boardW - w));
      const y = Math.floor(Math.random() * Math.max(1, boardH - h));
      placed.push({ ...n, x, y, w, h });
      bi++;
      if (bi >= boards) bi = 1;
    }
    setImages(placed.map(clampToBoards));
  };

  const distributeAcrossBoards = () => {
    const src = copyList(images);
    shuffleInPlace(src);
    const perBoard = Math.ceil(src.length / Math.max(1, boards));
    const out = [];
    let idx = 0;
    for (let b = 0; b < boards; b++) {
      const bx = b * boardW;
      const end = Math.min(src.length, idx + perBoard);
      for (let i = idx; i < end; i++) {
        const n = src[i];
        const w = Math.min(n.w, Math.floor(boardW * 0.6));
        const h = Math.min(n.h, Math.floor(boardH * 0.6));
        const x = bx + Math.floor(Math.random() * Math.max(1, boardW - w));
        const y = Math.floor(Math.random() * Math.max(1, boardH - h));
        out.push({ ...n, x, y, w, h });
      }
      idx = end;
    }
    setImages(out);
  };

  // pack (greedy)
  const pack = useCallback(() => {
    const src = [...images].sort((a, b) => b.w * b.h - a.w * a.h);
    const placed = [];
    for (const n of src) {
      let placedOne = false;
      for (let y = 0; y <= boardH - n.h && !placedOne; y += Math.max(8, spacing)) {
        for (let bx = 0; bx < boards; bx++) {
          for (let x = bx * boardW; x <= (bx + 1) * boardW - n.w; x += Math.max(8, spacing)) {
            const c = { ...n, x, y };
            if (!placed.some((p) => overlapWith(c, p, spacing))) {
              placed.push(c);
              placedOne = true;
              break;
            }
          }
          if (placedOne) break;
        }
      }
      if (!placedOne) placed.push(clampToBoards(n));
    }
    setImages(placed);
  }, [images, boards, boardW, boardH, spacing]);

  // z-order helpers
  const sendToBack = () =>
    selectedId &&
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selectedId);
      if (idx <= 0) return prev;
      const arr = [...prev];
      const [item] = arr.splice(idx, 1);
      arr.unshift(item);
      return arr;
    });
  const sendBackward = () =>
    selectedId &&
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selectedId);
      if (idx <= 0) return prev;
      const arr = [...prev];
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      return arr;
    });
  const bringForward = () =>
    selectedId &&
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selectedId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const arr = [...prev];
      [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
      return arr;
    });
  const bringToFront = () =>
    selectedId &&
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selectedId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const arr = [...prev];
      const [item] = arr.splice(idx, 1);
      arr.push(item);
      return arr;
    });

  // ---------- overlays ----------
  const genOverlays = (kind, countPerBoard = 18) => {
    const out = [];
    for (let b = 0; b < boards; b++) {
      for (let i = 0; i < countPerBoard; i++) {
        const w = Math.max(6, Math.floor(boardW * (0.01 + Math.random() * 0.06)));
        const h = Math.max(16, Math.floor(boardH * (0.05 + Math.random() * 0.25)));
        const x = b * boardW + Math.floor(Math.random() * (boardW - w));
        const y = Math.floor(Math.random() * (boardH - h));
        out.push({
          id: uid(),
          kind,
          x,
          y,
          w,
          h,
          fill: i % 2 ? overlayColourA : overlayColourB,
          opacity: overlayOpacity,
        });
      }
    }
    setOverlays(out);
  };

  const addOverlayImage = async (file) => {
    if (!file) return;
    const src = await readAsDataURL(file);
    const img = new Image();
    img.onload = () => {
      const w = Math.floor(boardW * 0.3);
      const h = Math.floor((img.naturalHeight / img.naturalWidth) * w);
      setOverlays((prev) => [
        ...prev,
        {
          id: uid(),
          kind: "image",
          x: Math.floor((boardW - w) / 2),
          y: Math.floor((boardH - h) / 2),
          w,
          h,
          fill: "#ffffff",
          opacity: overlayOpacity,
          _img: img,
          _src: src,
        },
      ]);
    };
    img.src = src;
  };

  const handleOverlayUpload = (e) => {
    const f = e.target.files?.[0];
    if (f) addOverlayImage(f);
  };

  const toggleOverlay = () => setOverlayVisible((v) => !v);

  // save / load overlay set
  const saveOverlaySet = () => {
    const blob = new Blob([JSON.stringify({ overlays, overlayOpacity }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "overlay_set.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const loadOverlaySet = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        const restored = (data.overlays || []).map((o) => {
          if (o.kind === "image" && o._src) {
            const im = new Image();
            im.src = o._src;
            o._img = im;
          }
          return o;
        });
        setOverlays(restored);
        if (typeof data.overlayOpacity === "number") setOverlayOpacity(data.overlayOpacity);
      } catch {
        alert("Invalid overlay set");
      }
    };
    r.readAsText(file);
  };

  // favourites
  const saveColourToSlot = (hex) => {
    setColourSlots((prev) => {
      const next = [...prev];
      // put into first slot (rotate)
      next.pop();
      next.unshift(hex);
      return next;
    });
  };

  // ---------- export ----------
  function cropOpsForBoard(boardIndex) {
    const boardX = boardIndex * boardW;
    const ops = [];
    for (const n of images) {
      if (!n._imageEl) continue;
      const hit = intersect(n.x, n.y, n.w, n.h, boardX, 0, boardW, boardH);
      if (!hit) continue;
      ops.push({
        img: n._imageEl,
        sx: (hit.x - n.x) * (n._imageEl.naturalWidth / (n._imageEl._placedW || 1)),
        sy: (hit.y - n.y) * (n._imageEl.naturalHeight / (n._imageEl._placedH || 1)),
        sw: hit.w * (n._imageEl.naturalWidth / (n._imageEl._placedW || 1)),
        sh: hit.h * (n._imageEl.naturalHeight / (n._imageEl._placedH || 1)),
        dx: hit.x - boardX,
        dy: hit.y,
        dw: hit.w,
        dh: hit.h,
      });
    }
    return ops;
  }

  const exportBoard = async (i, type = "image/png") => {
    const canvas = document.createElement("canvas");
    canvas.width = boardW * exportScale;
    canvas.height = boardH * exportScale;
    const ctx = canvas.getContext("2d");
    // bg
    ctx.fillStyle = exportBg || "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // overlays behind images? We’ll draw overlays first
    if (overlayVisible) {
      for (const ov of overlays) {
        const bi = Math.floor(ov.x / boardW);
        if (bi !== i) continue;
        const local = { ...ov, x: ov.x - i * boardW };
        drawOverlayOnCanvas(ctx, local, exportScale);
      }
    }

    // images
    const ops = cropOpsForBoard(i);
    for (const op of ops) {
      ctx.drawImage(
        op.img,
        Math.max(0, op.sx),
        Math.max(0, op.sy),
        Math.max(1, op.sw),
        Math.max(1, op.sh),
        Math.round(op.dx * exportScale),
        Math.round(op.dy * exportScale),
        Math.round(op.dw * exportScale),
        Math.round(op.dh * exportScale)
      );
    }

    return await new Promise((res) => canvas.toBlob(res, type, type === "image/jpeg" ? 0.95 : undefined));
  };

  const ensureReady = () => {
    if (images.some((n) => n.src && !n._imageEl)) {
      alert("Images are still loading. Try export again in a moment.");
      return false;
    }
    return true;
  };

  const exportPNG = async () => {
    if (!ensureReady()) return;
    for (let i = 0; i < boards; i++) {
      const blob = await exportBoard(i, "image/png");
      downloadBlob(blob, `858 art club_${i + 1}.png`);
    }
  };
  const exportJPG = async () => {
    if (!ensureReady()) return;
    for (let i = 0; i < boards; i++) {
      const blob = await exportBoard(i, "image/jpeg");
      downloadBlob(blob, `858 art club_${i + 1}.jpg`);
    }
  };
  const exportZIP = async () => {
    if (!ensureReady()) return;
    const zip = new JSZip();
    for (let i = 0; i < boards; i++) {
      const blob = await exportBoard(i, "image/png");
      zip.file(`858 art club_${i + 1}.png`, blob);
    }
    const z = await zip.generateAsync({ type: "blob" });
    downloadBlob(z, "858 art club.zip");
  };
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // ---------- presets (whole app) ----------
  const savePreset = () => {
    const serialOverlays = overlays.map((o) => {
      if (o.kind === "image" && o._src) return o;
      if (o.kind === "image" && !o._src && o._img) return { ...o, _src: o._img.src };
      return o;
    });
    const data = {
      boards,
      boardW,
      boardH,
      spacing,
      exportScale,
      previewZoom,
      showGrid,
      gridColour,
      gridOpacity,
      exportBg,
      overlays: serialOverlays,
      overlayVisible,
      overlayOpacity,
      overlayColourA,
      overlayColourB,
      colourSlots,
      images, // note: image dataURIs increase size; fine for your use-case
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    downloadBlob(blob, "858_preset.json");
  };

  const loadPresetFile = (file) => {
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        setBoards(clamp(d.boards ?? boards, 1, MAX_BOARDS));
        setBoardW(d.boardW ?? boardW);
        setBoardH(d.boardH ?? boardH);
        setSpacing(d.spacing ?? spacing);
        setExportScale(d.exportScale ?? exportScale);
        setPreviewZoom(d.previewZoom ?? previewZoom);
        setShowGrid(!!d.showGrid);
        setGridColour(d.gridColour ?? gridColour);
        setGridOpacity(d.gridOpacity ?? gridOpacity);
        setExportBg(d.exportBg ?? exportBg);
        setOverlayVisible(!!d.overlayVisible);
        setOverlayOpacity(d.overlayOpacity ?? overlayOpacity);
        setOverlayColourA(d.overlayColourA ?? overlayColourA);
        setOverlayColourB(d.overlayColourB ?? overlayColourB);
        setColourSlots(d.colourSlots ?? colourSlots);

        const restoredOverlays = (d.overlays || []).map((o) => {
          if (o.kind === "image" && o._src) {
            const im = new Image();
            im.src = o._src;
            o._img = im;
          }
          return o;
        });
        setOverlays(restoredOverlays);

        setImages(d.images || []);
      } catch {
        alert("Invalid preset file");
      }
    };
    r.readAsText(file);
  };

  // keyboard quickies
  useEffect(() => {
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k === "r") randomise();
      if (k === "p") pack();
      if ((k === "delete" || k === "backspace") && selectedId) {
        setImages((prev) => prev.filter((n) => n.id !== selectedId));
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [randomise, pack, selectedId]);

  // ---------- UI ----------
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#eaeaea",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      }}
    >
      {/* PREVIEW */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setSelectedId(null);
        }}
        style={{
          position: "relative",
          margin: "12px auto",
          width: spreadW * previewZoom,
          height: spreadH * previewZoom,
          transformOrigin: "top left",
          background: "#000",
          border: "1px solid #222",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: spreadW,
            height: spreadH,
            transform: `scale(${previewZoom})`,
            transformOrigin: "top left",
          }}
        >
          {/* slide indicator + guides (not exported) */}
          {showGrid &&
            [...Array(boards)].map((_, i) => (
              <React.Fragment key={`g${i}`}>
                <div
                  style={{
                    position: "absolute",
                    left: i * boardW,
                    top: 0,
                    width: boardW,
                    height: 16,
                    fontSize: 10,
                    color: "#a3a3a3",
                    paddingLeft: 4,
                    letterSpacing: 0.3,
                    pointerEvents: "none",
                  }}
                >
                  slide {i + 1}
                </div>
                <div
                  style={{
                    position: "absolute",
                    left: i * boardW,
                    top: 0,
                    width: boardW,
                    height: boardH,
                    outline: `1px solid ${gridColour}`,
                    opacity: gridOpacity,
                    pointerEvents: "none",
                  }}
                />
              </React.Fragment>
            ))}

          {/* overlays */}
          {overlayVisible &&
            overlays.map((ov) => (
              <div
                key={ov.id}
                style={{
                  position: "absolute",
                  left: ov.x,
                  top: ov.y,
                  width: ov.w,
                  height: ov.h,
                  opacity: ov.opacity ?? overlayOpacity,
                  pointerEvents: "none",
                  background:
                    ov.kind === "bar" || ov.kind === "rect" ? ov.fill || overlayColourA : "transparent",
                  borderRadius: ov.kind === "circle" ? "50%" : 0,
                }}
              >
                {ov.kind === "plus" || ov.kind === "cross" ? (
                  <svg width="100%" height="100%" viewBox="0 0 100 100">
                    {ov.kind === "plus" ? (
                      <>
                        <rect x="45" y="0" width="10" height="100" fill={ov.fill || overlayColourA} />
                        <rect x="0" y="45" width="100" height="10" fill={ov.fill || overlayColourA} />
                      </>
                    ) : (
                      <g transform="rotate(45 50 50)">
                        <rect x="45" y="0" width="10" height="100" fill={ov.fill || overlayColourA} />
                        <rect x="0" y="45" width="100" height="10" fill={ov.fill || overlayColourA} />
                      </g>
                    )}
                  </svg>
                ) : ov.kind === "circle" ? (
                  <div
                    style={{
                      width: "100%",
                      height: "100%",
                      background: ov.fill || overlayColourA,
                      borderRadius: "50%",
                    }}
                  />
                ) : ov.kind === "image" && ov._img ? (
                  <img
                    src={ov._img.src}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : null}
              </div>
            ))}

          {/* images */}
          {images.map((n) => (
            <Item
              key={n.id}
              node={n}
              selected={n.id === selectedId}
              onSelect={() => setSelectedId(n.id)}
              onChange={(next) => setImages((prev) => prev.map((x) => (x.id === n.id ? clampToBoards(next) : x)))}
            />
          ))}
        </div>
      </div>

      {/* CONTROLS (bottom) */}
      <div
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          background: "#0f0f0f",
          borderTop: "1px solid #222",
          padding: "10px 12px",
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        {/* Core geometry */}
        <div>
          <label className="lbl">Boards (max 20)</label>
          <div className="row">
            <input
              className="in"
              type="number"
              min={1}
              max={MAX_BOARDS}
              value={boards}
              onChange={(e) => setBoards(clamp(parseInt(e.target.value || "1", 10), 1, MAX_BOARDS))}
            />
            <select
              className="in"
              value={presetIndex}
              onChange={(e) => {
                const idx = parseInt(e.target.value, 10);
                setPresetIndex(idx);
                setBoardW(PRESETS[idx].w);
                setBoardH(PRESETS[idx].h);
              }}
              style={{ marginLeft: 6 }}
            >
              {PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="lbl mini">W</span>
            <input
              className="in"
              type="number"
              min={320}
              value={boardW}
              onChange={(e) => setBoardW(clamp(parseInt(e.target.value || "1", 10), 100, 8000))}
            />
            <span className="lbl mini" style={{ marginLeft: 6 }}>
              H
            </span>
            <input
              className="in"
              type="number"
              min={320}
              value={boardH}
              onChange={(e) => setBoardH(clamp(parseInt(e.target.value || "1", 10), 100, 8000))}
            />
            <span className="lbl mini" style={{ marginLeft: 6 }}>
              Spacing
            </span>
            <input
              className="in"
              type="number"
              min={0}
              max={200}
              value={spacing}
              onChange={(e) => setSpacing(clamp(parseInt(e.target.value || "0", 10), 0, 200))}
            />
          </div>
        </div>

        {/* Layout actions */}
        <div>
          <label className="lbl">Layouts</label>
          <div className="row wrap">
            <button className="btn" onClick={() => randomise({ spreadVertical: true, acrossBoards: true })}>
              Randomise
            </button>
            <button className="btn" onClick={randomSizesOnly}>Rand Sizes</button>
            <button className="btn" onClick={pack}>Pack</button>
            <button className="btn" onClick={editorial}>Editorial (spaced)</button>
            <button className="btn" onClick={editorialSeamless}>Editorial (seamless)</button>
            <button className="btn" onClick={distributeAcrossBoards}>Distribute boards</button>
            <button className="btn" onClick={heroFirstPage}>Hero page (3-up)</button>
            <button className="btn" onClick={() => setImages((prev) => prev.sort(() => Math.random() - 0.5))}>
              Shuffle order
            </button>
            <button className="btn" onClick={fixBounds}>Fix bounds</button>
            <button className="btn" onClick={() => setImages([])}>Reset layout</button>
          </div>
        </div>

        {/* Overlays */}
        <div>
          <label className="lbl">Overlay</label>
          <div className="row wrap">
            <button className="btn" onClick={() => setOverlayVisible((v) => !v)}>
              {overlayVisible ? "Hide Overlay" : "Show Overlay"}
            </button>
            <button className="btn" onClick={() => genOverlays("bar", 18)}>Bars</button>
            <button className="btn" onClick={() => genOverlays("rect", 18)}>Rects</button>
            <button className="btn" onClick={() => genOverlays("circle", 18)}>Circles</button>
            <button className="btn" onClick={() => genOverlays("plus", 18)}>Plus</button>
            <button className="btn" onClick={() => genOverlays("cross", 18)}>Cross</button>
            <span className="lbl mini" style={{ marginLeft: 8 }}>
              Opacity
            </span>
            <input
              className="in"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={overlayOpacity}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setOverlayOpacity(v);
                setOverlays((prev) => prev.map((o) => ({ ...o, opacity: v })));
              }}
            />
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="lbl mini">Colour A</span>
            <input className="in" type="color" value={overlayColourA} onChange={(e) => setOverlayColourA(e.target.value)} />
            <span className="lbl mini" style={{ marginLeft: 8 }}>
              Colour B
            </span>
            <input className="in" type="color" value={overlayColourB} onChange={(e) => setOverlayColourB(e.target.value)} />
            <button className="btn" style={{ marginLeft: 8 }} onClick={() => saveColourToSlot(overlayColourA)}>
              ★ save A
            </button>
            <button className="btn" onClick={() => saveColourToSlot(overlayColourB)}>
              ★ save B
            </button>
            <span className="lbl mini" style={{ marginLeft: 8 }}>
              Slots
            </span>
            {colourSlots.map((c, i) => (
              <button
                key={i}
                className="swatch"
                style={{ background: c }}
                onClick={() => {
                  setOverlayColourA(c);
                  setOverlayColourB(c);
                }}
                title={c}
              />
            ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="file btn">
              Upload overlay image/SVG
              <input className="file-input" type="file" accept="image/*,.svg" onChange={handleOverlayUpload} />
            </label>
            <button className="btn" onClick={saveOverlaySet}>Save overlay set</button>
            <label className="file btn">
              Load overlay set
              <input className="file-input" type="file" accept="application/json" onChange={(e) => e.target.files && loadOverlaySet(e.target.files[0])} />
            </label>
          </div>
        </div>

        {/* Export + Preview */}
        <div>
          <label className="lbl">Export / Preview</label>
          <div className="row wrap">
            <span className="lbl mini">Export scale</span>
            <input
              className="in"
              type="number"
              min={1}
              max={4}
              value={exportScale}
              onChange={(e) => setExportScale(clamp(parseInt(e.target.value || "1", 10), 1, 4))}
            />
            <span className="lbl mini" style={{ marginLeft: 8 }}>
              Background
            </span>
            <input className="in" type="color" value={exportBg} onChange={(e) => setExportBg(e.target.value)} />
            <button className="btn" onClick={exportPNG}>Export PNG</button>
            <button className="btn" onClick={exportJPG}>Export JPG</button>
            <button className="btn" onClick={exportZIP}>Export ZIP</button>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="lbl mini">Preview zoom</span>
            <input
              className="in"
              type="range"
              min={0.25}
              max={1.5}
              step={0.05}
              value={previewZoom}
              onChange={(e) => setPreviewZoom(parseFloat(e.target.value))}
              style={{ width: 180 }}
            />
            <span className="lbl mini" style={{ marginLeft: 12 }}>
              Guides colour
            </span>
            <input className="in" type="color" value={gridColour} onChange={(e) => setGridColour(e.target.value)} />
            <span className="lbl mini" style={{ marginLeft: 8 }}>
              Guides opacity
            </span>
            <input
              className="in"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={gridOpacity}
              onChange={(e) => setGridOpacity(parseFloat(e.target.value))}
              style={{ width: 140 }}
            />
            <label className="row" style={{ marginLeft: 8 }}>
              <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
              <span className="lbl mini" style={{ marginLeft: 6 }}>
                Show guides
              </span>
            </label>
          </div>
        </div>

        {/* Presets + Files + Info */}
        <div>
          <label className="lbl">Files / Presets / Z-order</label>
          <div className="row wrap">
            <label className="file btn">
              Add images
              <input className="file-input" type="file" multiple accept="image/*" onChange={onAddImages} />
            </label>
            <button className="btn" onClick={savePreset}>Save preset</button>
            <label className="file btn">
              Load preset file
              <input className="file-input" type="file" accept="application/json" onChange={(e) => e.target.files && loadPresetFile(e.target.files[0])} />
            </label>
            <button className="btn" onClick={sendToBack}>Send to Back</button>
            <button className="btn" onClick={sendBackward}>Send Backward</button>
            <button className="btn" onClick={bringForward}>Bring Forward</button>
            <button className="btn" onClick={bringToFront}>Bring to Front</button>
            <span className="lbl mini" style={{ marginLeft: 8 }}>
              Count: {imgCount}
            </span>
          </div>
        </div>
      </div>

      <style>{`
        .row { display:flex; align-items:center; gap:6px; }
        .wrap { flex-wrap: wrap; }
        .btn {
          background:#161616; color:#eaeaea; border:1px solid #2a2a2a;
          border-radius:8px; padding:8px 10px; font-size:12px;
        }
        .btn:hover { background:#1d1d1d; }
        .in {
          background:#121212; color:#f2f2f2; border:1px solid #2a2a2a;
          border-radius:6px; padding:6px 8px; font-size:12px;
        }
        .lbl { display:block; font-size:12px; color:#a7abb3; margin-bottom:4px; }
        .lbl.mini { display:inline; margin:0; }
        .file { position:relative; overflow:hidden; }
        .file-input { display:none; }
        .swatch {
          width:20px; height:20px; border-radius:4px; border:1px solid #2a2a2a;
        }
      `}</style>
    </div>
  );
}
