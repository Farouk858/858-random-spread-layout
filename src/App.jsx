import React, { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/** ============ Constants ============ */
const MAX_BOARDS = 20;
const DEFAULT_W = 1080;
const DEFAULT_H = 1320; // portrait first page as requested
const DEFAULT_SPACING = 24;
const BOARD_LABEL_STYLE = {
  position: "absolute",
  top: 6,
  left: 6,
  fontSize: 14, // bigger label
  fontWeight: 700,
  letterSpacing: 0.5,
  color: "rgba(127,255,127,0.8)",
  userSelect: "none",
  pointerEvents: "none",
};
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Helper: rect intersection */
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

/** “object-fit: cover” source crop maths (no distortion) */
function coverCrop(naturalW, naturalH, frameW, frameH, sx = 0, sy = 0, sw = frameW, sh = frameH) {
  const frameAR = frameW / frameH;
  const natAR = naturalW / naturalH;

  let coverW, coverH;
  if (natAR > frameAR) {
    // wider source -> scale by height
    coverH = naturalH;
    coverW = frameAR * coverH;
  } else {
    // taller source -> scale by width
    coverW = naturalW;
    coverH = coverW / frameAR;
  }
  // centre crop
  const srcX = (naturalW - coverW) / 2 + (sx / frameW) * coverW;
  const srcY = (naturalH - coverH) / 2 + (sy / frameH) * coverH;
  const srcW = (sw / frameW) * coverW;
  const srcH = (sh / frameH) * coverH;

  return { sx: srcX, sy: srcY, sw: srcW, sh: srcH };
}

/** Load to HTMLImageElement */
function useImg(src) {
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

/** ============ Item (draggable/resizable) ============ */
function Item({ node, selected, onSelect, onChange }) {
  const ref = useRef(null);
  const img = useImg(node.src);

  // persist natural size on the node for export mapping
  useEffect(() => {
    if (!img) return;
    if (node._natW !== img.naturalWidth || node._natH !== img.naturalHeight) {
      onChange({ ...node, _natW: img.naturalWidth, _natH: img.naturalHeight });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  // drag
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let drag = false, sx = 0, sy = 0, ox = 0, oy = 0;

    const d = (e) => {
      if (e.button === 2 || e.target.dataset.handle) return;
      drag = true;
      const p = e.touches?.[0] || e;
      sx = p.clientX; sy = p.clientY; ox = node.x; oy = node.y;
      window.addEventListener("pointermove", m);
      window.addEventListener("pointerup", u);
      onSelect(node.id);
    };
    const m = (e) => {
      if (!drag) return;
      const p = e.touches?.[0] || e;
      onChange({ ...node, x: ox + (p.clientX - sx), y: oy + (p.clientY - sy) });
    };
    const u = () => {
      drag = false;
      window.removeEventListener("pointermove", m);
      window.removeEventListener("pointerup", u);
    };
    el.addEventListener("pointerdown", d);
    return () => el.removeEventListener("pointerdown", d);
  }, [node, onChange, onSelect]);

  // resize
  const startResize = (dir, e) => {
    e.stopPropagation();
    const p0 = e.touches?.[0] || e;
    const sx = p0.clientX, sy = p0.clientY;
    const init = { x: node.x, y: node.y, w: node.w, h: node.h };
    const mm = (ev) => {
      const p = ev.touches?.[0] || ev;
      let dx = p.clientX - sx, dy = p.clientY - sy;
      let { x, y, w, h } = init;
      if (dir.includes("e")) w = Math.max(16, init.w + dx);
      if (dir.includes("s")) h = Math.max(16, init.h + dy);
      if (dir.includes("w")) { w = Math.max(16, init.w - dx); x = init.x + dx; }
      if (dir.includes("n")) { h = Math.max(16, init.h - dy); y = init.y + dy; }
      onChange({ ...node, x, y, w, h });
    };
    const uu = () => {
      window.removeEventListener("pointermove", mm);
      window.removeEventListener("pointerup", uu);
    };
    window.addEventListener("pointermove", mm);
    window.addEventListener("pointerup", uu);
  };

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: node.x, top: node.y, width: node.w, height: node.h,
        border: selected ? "1px dashed rgba(180,255,180,0.7)" : "none",
        cursor: "grab", userSelect: "none",
      }}
      onClick={() => onSelect(node.id)}
    >
      {img ? (
        <img
          src={node.src}
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          draggable={false}
          alt=""
        />
      ) : (
        <div style={{ width: "100%", height: "100%", background: "#222" }} />
      )}

      {selected && (
        ["nw","ne","sw","se"].map((dir) => {
          const pos = {
            position: "absolute",
            width: 12, height: 12, background: "#111",
            border: "1px solid #8bff8b", borderRadius: 2,
            transform: "translate(-50%,-50%)"
          };
          const p = {
            nw: { left: 0, top: 0 }, ne: { left: "100%", top: 0 },
            sw: { left: 0, top: "100%" }, se: { left: "100%", top: "100%" },
          }[dir];
          return (
            <span
              key={dir}
              data-handle
              onPointerDown={(e) => startResize(dir, e)}
              style={{ ...pos, ...p, cursor: `${dir}-resize` }}
            />
          );
        })
      )}
    </div>
  );
}

/** ============ Main App ============ */
export default function App() {
  // geometry
  const [boards, setBoards] = useState(6);
  const [BW, setBW] = useState(DEFAULT_W);
  const [BH, setBH] = useState(DEFAULT_H);
  const [spacing, setSpacing] = useState(DEFAULT_SPACING);

  // preview
  const [zoom, setZoom] = useState(0.6); // manual
  const [showGuides, setShowGuides] = useState(true);
  const [guideColour, setGuideColour] = useState("#00ff5c");
  const [guideAlpha, setGuideAlpha] = useState(0.35);

  // content
  const [images, setImages] = useState([]); // {id, src, x,y,w,h, _natW,_natH}
  const [selected, setSelected] = useState(null);

  // background
  const [bgColour, setBgColour] = useState("#000000");

  // colour favourites (persist)
  const [colours, setColours] = useState(() => {
    const raw = localStorage.getItem("favColours858");
    return raw ? JSON.parse(raw) : ["#00ff5c", "#ffffff", "#1a1a1a", "#ff00ff", "#00c0ff"];
  });
  useEffect(() => {
    localStorage.setItem("favColours858", JSON.stringify(colours));
  }, [colours]);

  // export settings
  const [exportScale, setExportScale] = useState(2);

  // computed
  const SPREAD_W = boards * BW;
  const SPREAD_H = BH;

  /** Drop / choose files */
  const addFiles = async (fileList) => {
    const read = (f) =>
      new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(f);
      });

    const out = [];
    for (const f of fileList) {
      if (!f.type?.startsWith("image/")) continue;
      const src = await read(f);
      out.push({
        id: uid(),
        src,
        // start temp size ~ quarter board width
        w: Math.floor(BW * (0.28 + Math.random() * 0.18)),
        h: Math.floor(BH * (0.28 + Math.random() * 0.18)),
        x: Math.floor(Math.random() * (SPREAD_W - BW)),
        y: Math.floor(Math.random() * (SPREAD_H - BH)),
      });
    }
    setImages((p) => [...p, ...out]);
  };

  /** Keep everything within bounds */
  const fixBounds = () => {
    setImages((prev) =>
      prev.map((n) => ({
        ...n,
        x: clamp(n.x, 0, SPREAD_W - n.w),
        y: clamp(n.y, 0, SPREAD_H - n.h),
        w: Math.min(n.w, SPREAD_W),
        h: Math.min(n.h, SPREAD_H),
      }))
    );
  };

  /** Simple non-overlap pack with spacing */
  const pack = () => {
    const placed = [];
    const res = [...images].sort((a, b) => b.w * b.h - a.w * a.h).map((n) => {
      let ok = false, x=0,y=0;
      const step = Math.max(8, spacing);
      for (y = 0; y <= SPREAD_H - n.h && !ok; y += step) {
        for (x = 0; x <= SPREAD_W - n.w && !ok; x += step) {
          const cand = { ...n, x, y };
          if (
            !placed.some((p) =>
              !(
                cand.x + cand.w + spacing <= p.x ||
                p.x + p.w + spacing <= cand.x ||
                cand.y + cand.h + spacing <= p.y ||
                p.y + p.h + spacing <= cand.y
              )
            )
          ) {
            ok = true;
            placed.push(cand);
            return cand;
          }
        }
      }
      const keep = { ...n, x: clamp(n.x, 0, SPREAD_W - n.w), y: clamp(n.y, 0, SPREAD_H - n.h) };
      placed.push(keep);
      return keep;
    });
    setImages(res);
  };

  /** Randomise grid across all boards */
  const randomise = () => {
    const res = images.map((n, idx) => {
      const col = idx % boards;
      const x = Math.floor(col * BW + spacing + Math.random() * (BW - n.w - spacing * 2));
      const y = Math.floor(spacing + Math.random() * (BH - n.h - spacing * 2));
      return { ...n, x, y };
    });
    setImages(res);
  };

  /** Editorial: columnar masonry that spreads across all boards (no overlap) */
  const editorial = (seamless = false) => {
    const colsPerBoard = 3;
    const totalCols = colsPerBoard * boards;
    const colW = (BW - spacing * (colsPerBoard + 1)) / colsPerBoard;
    const gutters = spacing;

    const heights = new Array(totalCols).fill(gutters);
    const res = images.map((n, i) => {
      const colIdx = i % totalCols;
      const boardIdx = Math.floor(colIdx / colsPerBoard);
      const withinBoardCol = colIdx % colsPerBoard;

      const x = boardIdx * BW + gutters + withinBoardCol * (colW + gutters);
      const targetW = colW;
      // keep aspect ratio by adjusting height (no distortion)
      const aspect = n._natW && n._natH ? n._natW / n._natH : 1.5;
      const targetH = Math.max(60, Math.round(targetW / aspect)); // “cover” feel will be done at draw

      const y = heights[colIdx];
      heights[colIdx] += targetH + gutters * (seamless ? 0 : 1);

      return { ...n, x, y, w: targetW, h: targetH };
    });
    setImages(res);
  };

  /** Snap to bottom of each board (keeps x) */
  const snapBottom = () => {
    setImages((prev) =>
      prev.map((n) => {
        const boardIdx = Math.floor(n.x / BW);
        const xWithin = n.x - boardIdx * BW;
        return { ...n, x: boardIdx * BW + xWithin, y: BH - n.h - spacing };
      })
    );
  };

  /** Distribute boards – ensure all boards get roughly equal count */
  const distributeBoards = () => {
    if (!images.length) return;
    const per = Math.ceil(images.length / boards);
    const sorted = [...images];
    const res = [];
    for (let b = 0; b < boards; b++) {
      const start = b * per;
      const slice = sorted.slice(start, start + per);
      const left = b * BW + spacing;
      let y = spacing;
      for (const n of slice) {
        const w = Math.min(Math.max(BW * 0.28, n.w || BW * 0.32), BW - spacing * 2);
        const h = Math.min(Math.max(BH * 0.2, n.h || BH * 0.24), BH - spacing * 2);
        if (y + h + spacing > BH) y = spacing;
        res.push({
          ...n,
          x: left + Math.random() * (BW - w - spacing * 2),
          y,
          w,
          h,
        });
        y += h + spacing;
      }
    }
    setImages(res);
  };

  /** Shuffle Z order helpers */
  const sendToBack = () => {
    if (!selected) return;
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selected);
      if (idx < 0) return prev;
      const copy = [...prev];
      const [it] = copy.splice(idx, 1);
      copy.unshift(it);
      return copy;
    });
  };
  const bringToFront = () => {
    if (!selected) return;
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selected);
      if (idx < 0) return prev;
      const copy = [...prev];
      const [it] = copy.splice(idx, 1);
      copy.push(it);
      return copy;
    });
  };
  const bringForward = () => {
    if (!selected) return;
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selected);
      if (idx < 0 || idx === prev.length - 1) return prev;
      const copy = [...prev];
      [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
      return copy;
    });
  };
  const sendBackward = () => {
    if (!selected) return;
    setImages((prev) => {
      const idx = prev.findIndex((n) => n.id === selected);
      if (idx <= 0) return prev;
      const copy = [...prev];
      [copy[idx], copy[idx - 1]] = [copy[idx - 1], copy[idx]];
      return copy;
    });
  };

  /** Reset layout positions but keep images */
  const resetLayout = () => {
    setImages((prev) =>
      prev.map((n, i) => ({
        ...n,
        x: (i % boards) * BW + spacing,
        y: spacing,
        w: Math.min(Math.max(BW * 0.32, n.w || BW * 0.32), BW - spacing * 2),
        h: Math.min(Math.max(BH * 0.24, n.h || BH * 0.24), BH - spacing * 2),
      }))
    );
  };

  /** Keyboard shortcuts */
  useEffect(() => {
    const h = (e) => {
      if (e.key.toLowerCase() === "r") randomise();
      if (e.key.toLowerCase() === "p") pack();
      if ((e.key === "Backspace" || e.key === "Delete") && selected) {
        setImages((prev) => prev.filter((n) => n.id !== selected));
        setSelected(null);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, images, boards, BW, BH, spacing]);

  /** Crop operations per board for export (with coverCrop) */
  function buildOps(boardIndex) {
    const boardX = boardIndex * BW;
    const ops = [];
    for (const n of images) {
      const hit = intersect(n.x, n.y, n.w, n.h, boardX, 0, BW, BH);
      if (!hit) continue;
      if (!n._natW || !n._natH) continue;

      // where this hit falls inside the frame of n
      const fx = hit.x - n.x;
      const fy = hit.y - n.y;

      // compute source crop using coverCrop
      const cover = coverCrop(n._natW, n._natH, n.w, n.h, fx, fy, hit.w, hit.h);

      ops.push({
        img: n,
        src: cover,
        dst: {
          dx: hit.x - boardX,
          dy: hit.y,
          dw: hit.w,
          dh: hit.h,
        },
      });
    }
    return ops;
  }

  /** Export one board to canvas -> dataURL */
  async function renderBoard(boardIndex, type = "image/png", quality = 0.95, scale = exportScale) {
    const canvas = document.createElement("canvas");
    canvas.width = BW * scale;
    canvas.height = BH * scale;
    const ctx = canvas.getContext("2d");

    // background
    ctx.fillStyle = bgColour || "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // draw ops
    const ops = buildOps(boardIndex);
    for (const op of ops) {
      const el = new Image();
      el.crossOrigin = "anonymous";
      await new Promise((res) => { el.onload = res; el.src = op.img.src; });

      ctx.drawImage(
        el,
        op.src.sx, op.src.sy, op.src.sw, op.src.sh,
        Math.round(op.dst.dx * scale),
        Math.round(op.dst.dy * scale),
        Math.round(op.dst.dw * scale),
        Math.round(op.dst.dh * scale)
      );
    }
    const ext = type === "image/jpeg" ? "jpg" : "png";
    const name = `858 art club_${boardIndex + 1}.${ext}`;
    const dataUrl = canvas.toDataURL(type, quality);
    return { name, dataUrl };
  }

  /** Export buttons */
  const downloadURL = (dataUrl, filename) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const exportPNG = async () => {
    for (let i = 0; i < boards; i++) {
      const { name, dataUrl } = await renderBoard(i, "image/png", 0.95);
      downloadURL(dataUrl, name);
    }
  };
  const exportJPG = async () => {
    for (let i = 0; i < boards; i++) {
      const { name, dataUrl } = await renderBoard(i, "image/jpeg", 0.92);
      downloadURL(dataUrl, name);
    }
  };
  const exportZIP = async () => {
    const zip = new JSZip();
    for (let i = 0; i < boards; i++) {
      const png = await renderBoard(i, "image/png", 0.95);
      const data = png.dataUrl.split(",")[1];
      zip.file(png.name, data, { base64: true });
    }
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    downloadURL(url, "858 art club.zip");
    URL.revokeObjectURL(url);
  };

  /** Preset sizes */
  const PRESETS = [
    { name: "1080 x 1320 (Portrait)", w: 1080, h: 1320 },
    { name: "1320 x 1080 (Landscape)", w: 1320, h: 1080 },
    { name: "1080 x 1080 (Square)", w: 1080, h: 1080 },
    { name: "1440 x 1080 (Widescreen)", w: 1440, h: 1080 },
  ];

  /** UI */
  const spreadStyle = {
    position: "relative",
    width: SPREAD_W * zoom,
    height: SPREAD_H * zoom,
    transform: `scale(${zoom})`,
    transformOrigin: "top left",
  };

  return (
    <div
      className="app"
      style={{
        background: "#000",
        color: "#d6ffe0",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
    >
      {/* Spread */}
      <div
        style={{
          flex: "1 1 auto",
          overflow: "auto",
          padding: 12,
          borderBottom: "1px solid #0f3",
        }}
        onClick={(e) => { if (e.currentTarget === e.target) setSelected(null); }}
      >
        <div style={spreadStyle}>
          {/* Board guides */}
          {showGuides &&
            [...Array(boards)].map((_, i) => (
              <div key={i}
                style={{
                  position: "absolute",
                  left: i * BW, top: 0, width: BW, height: BH,
                  outline: `1px solid ${guideColour}`,
                  opacity: guideAlpha,
                }}
              >
                <span style={BOARD_LABEL_STYLE}>slide {i + 1}</span>
              </div>
            ))}

          {/* Items */}
          {images.map((n) => (
            <Item
              key={n.id}
              node={n}
              selected={selected === n.id}
              onSelect={(id) => setSelected(id)}
              onChange={(next) => setImages((prev) => prev.map((x) => (x.id === n.id ? next : x)))}
            />
          ))}
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          background: "#0b0b0b",
          borderTop: "1px solid #0f3",
          padding: "10px 12px",
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(12, minmax(0,1fr))",
          alignItems: "center",
          fontSize: 13,
        }}
      >
        {/* Layout group */}
        <div style={{ gridColumn: "span 4", display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button onClick={randomise}>Randomise</button>
          <button onClick={pack}>Pack</button>
          <button onClick={() => editorial(false)}>Editorial (spaced)</button>
          <button onClick={() => editorial(true)}>Editorial (seamless)</button>
          <button onClick={snapBottom}>Snap bottom</button>
          <button onClick={distributeBoards}>Distribute boards</button>
          <button onClick={resetLayout}>Reset layout</button>
          <button onClick={fixBounds}>Fix bounds</button>
        </div>

        {/* Geometry */}
        <div style={{ gridColumn: "span 4", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label>Boards (max {MAX_BOARDS})</label>
          <input type="number" min={1} max={MAX_BOARDS} value={boards}
                 onChange={(e) => setBoards(clamp(parseInt(e.target.value||"1",10),1,MAX_BOARDS))} style={{ width: 64 }} />

          <select
            value={`${BW}x${BH}`}
            onChange={(e) => {
              const [w, h] = e.target.value.split("x").map((n) => parseInt(n, 10));
              setBW(w); setBH(h);
              fixBounds();
            }}
          >
            {PRESETS.map((p) => (
              <option key={p.name} value={`${p.w}x${p.h}`}>{p.name}</option>
            ))}
          </select>

          <label>W</label>
          <input type="number" value={BW} onChange={(e)=>setBW(clamp(parseInt(e.target.value||"1",10),200,4000))} style={{ width: 84 }} />
          <label>H</label>
          <input type="number" value={BH} onChange={(e)=>setBH(clamp(parseInt(e.target.value||"1",10),200,4000))} style={{ width: 84 }} />
          <label>Spacing</label>
          <input type="number" value={spacing} onChange={(e)=>setSpacing(clamp(parseInt(e.target.value||"0",10),0,400))} style={{ width: 64 }} />
        </div>

        {/* Export */}
        <div style={{ gridColumn: "span 4", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label>Export scale</label>
          <input type="number" min={1} max={4} value={exportScale}
                 onChange={(e)=>setExportScale(clamp(parseInt(e.target.value||"1",10),1,4))}
                 style={{ width: 64 }} />
          <label>Background</label>
          <input type="color" value={bgColour} onChange={(e)=>setBgColour(e.target.value)} />
          {/* colour favourites */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {colours.map((c, i) => (
              <button
                key={i}
                title="Click to apply; Alt+Click to remove"
                onClick={(e) => {
                  if (e.altKey) {
                    const copy = [...colours];
                    copy.splice(i, 1);
                    setColours(copy);
                  } else {
                    setBgColour(c);
                  }
                }}
                style={{
                  width: 18, height: 18, borderRadius: 4, border: "1px solid #0f3", background: c
                }}
              />
            ))}
            <button
              onClick={() => setColours((p) => Array.from(new Set([...p, bgColour])).slice(0, 12))}
              title="★ Save current as favourite"
            >★ Save</button>
          </div>

          <button onClick={exportPNG}>Export PNG</button>
          <button onClick={exportJPG}>Export JPG</button>
          <button onClick={exportZIP}>Export ZIP</button>
        </div>

        {/* Z / Files row 2 */}
        <div style={{ gridColumn: "span 12", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label>Preview zoom</label>
          <input type="range" min={0.2} max={2.0} step={0.05} value={zoom}
                 onChange={(e)=>setZoom(parseFloat(e.target.value))} />
          <label style={{ marginLeft: 12 }}>Guides colour</label>
          <input type="color" value={guideColour} onChange={(e)=>setGuideColour(e.target.value)} />
          <label>Guides opacity</label>
          <input type="range" min={0} max={1} step={0.05} value={guideAlpha}
                 onChange={(e)=>setGuideAlpha(parseFloat(e.target.value))} />
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={showGuides} onChange={(e)=>setShowGuides(e.target.checked)} />
            Show guides
          </label>

          <span style={{ marginLeft: "auto", opacity: 0.8 }}>
            Count: <strong>{images.length}</strong>
          </span>

          <button onClick={sendToBack}>Send to Back</button>
          <button onClick={sendBackward}>Send Backward</button>
          <button onClick={bringForward}>Bring Forward</button>
          <button onClick={bringToFront}>Bring to Front</button>

          <label className="file-btn" style={{ marginLeft: 12 }}>
            Add images
            <input type="file" multiple accept="image/*"
                   onChange={(e)=> e.target.files && addFiles(e.target.files)}
                   style={{ display: "none" }} />
          </label>
        </div>
      </div>

      {/* tiny style reset for buttons/inputs in dark UI */}
      <style>{`
        .app button {
          background:#0e0e0e;border:1px solid #1aff7a;color:#d6ffe0;
          padding:6px 10px;border-radius:8px;cursor:pointer
        }
        .app button:hover{background:#122;box-shadow:0 0 0 1px #1aff7a inset}
        .app input, .app select {
          background:#060606;border:1px solid #1aff7a;color:#d6ffe0;border-radius:6px;
          padding:6px 8px; outline:none
        }
        .file-btn{position:relative; overflow:hidden}
        .file-btn input{position:absolute; inset:0; opacity:0; cursor:pointer}
      `}</style>
    </div>
  );
}
