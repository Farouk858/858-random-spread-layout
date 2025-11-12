import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

/**
 * 858 Random Spread Layout — board-safe placement, vertical spread, guide controls,
 * slide indicators (not exported), image count, and smoother export.
 * No third-party canvas libs.
 */

// ---------- constants ----------
const MAX_BOARDS = 20;
const DEFAULT_W = 1080; // you asked to flip orientation control yourself; these are defaults
const DEFAULT_H = 1320;

const uid = () => Math.random().toString(36).slice(2, 9);
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

// simple rectangle test with margin
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

function cropOpsForBoard(images, i, boardW, boardH) {
  const boardX = i * boardW;
  const ops = [];
  for (const n of images) {
    const hit = intersect(n.x, n.y, n.w, n.h, boardX, 0, boardW, boardH);
    if (!hit || !n._imageEl) continue;
    ops.push({
      img: n._imageEl,
      sx: hit.x - n.x,
      sy: hit.y - n.y,
      sw: hit.w,
      sh: hit.h,
      dx: hit.x - boardX,
      dy: hit.y,
      dw: hit.w,
      dh: hit.h,
      placedW: n.w,
      placedH: n.h,
    });
  }
  return ops;
}

// ---------- hooks ----------
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

// ---------- item ----------
function Item({ node, selected, onSelect, onChange }) {
  const wrapRef = useRef(null);
  const imgEl = useImageElement(node.src);

  // attach natural element back for export mapping
  useEffect(() => {
    if (imgEl && node._imageEl !== imgEl) {
      onChange({ ...node, _imageEl: imgEl });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgEl]);

  // drag
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;

    let startX = 0,
      startY = 0,
      oX = 0,
      oY = 0,
      dragging = false;

    const down = (e) => {
      if (e.target.dataset.handle) return;
      dragging = true;
      const p = e.touches?.[0] || e;
      startX = p.clientX;
      startY = p.clientY;
      oX = node.x;
      oY = node.y;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      onSelect();
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches?.[0] || e;
      const dx = p.clientX - startX;
      const dy = p.clientY - startY;
      onChange({ ...node, x: oX + dx, y: oY + dy });
    };
    const up = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    el.addEventListener("pointerdown", down);
    return () => el.removeEventListener("pointerdown", down);
  }, [node, onChange, onSelect]);

  // simple corner resize
  const startResize = (dir, e) => {
    e.stopPropagation();
    const p0 = e.touches?.[0] || e;
    const sX = p0.clientX;
    const sY = p0.clientY;
    const init = { x: node.x, y: node.y, w: node.w, h: node.h };
    const move = (ev) => {
      const p = ev.touches?.[0] || ev;
      const dx = p.clientX - sX;
      const dy = p.clientY - sY;
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
    cursor: "grab",
    userSelect: "none",
    overflow: "hidden",
  };

  return (
    <div ref={wrapRef} style={style} onClick={onSelect}>
      {imgEl ? (
        <img
          src={node.src}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: "center",
            display: "block",
          }}
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
  // boards and geometry
  const [boards, setBoards] = useState(6);
  const [boardW, setBoardW] = useState(DEFAULT_W);
  const [boardH, setBoardH] = useState(DEFAULT_H);
  const [spacing, setSpacing] = useState(24);
  const [exportScale, setExportScale] = useState(2);

  // images
  const [images, setImages] = useState([]); // {id, src, x,y,w,h,_imageEl}
  const [selectedId, setSelectedId] = useState(null);

  // guides + preview
  const [showGrid, setShowGrid] = useState(true);
  const [gridColour, setGridColour] = useState("#00ff6a");
  const [gridOpacity, setGridOpacity] = useState(0.6);
  const [previewZoom, setPreviewZoom] = useState(0.75);

  // export
  const [exportBg, setExportBg] = useState("#000000");

  const spreadW = useMemo(() => boards * boardW, [boards, boardW]);
  const spreadH = useMemo(() => boardH, [boardH]);

  // track placed size for export scaling
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

  // drag & drop
  const readAsDataURL = (file) =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    const newItems = [];
    for (const f of files) {
      if (!f.type?.startsWith("image/")) continue;
      const src = await readAsDataURL(f);
      const id = uid();
      // start with sensible size
      const w = Math.floor(boardW * (0.32 + Math.random() * 0.28));
      const h = Math.floor(w * (0.65 + Math.random() * 0.35));
      newItems.push({ id, src, x: 20, y: 20, w, h });
    }
    setImages((prev) => [...prev, ...newItems]);
  }, [boardW]);

  const onFileInput = (e) => e.target.files && addFiles(e.target.files);

  // helpers
  const shuffleInPlace = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  };

  const noDuplicateCopy = (list) => {
    // return deep copies without changing length, prevent accidental doubling
    return list.map((n) => ({ ...n }));
  };

  // layout: random but board-safe and vertical spread
  const randomise = useCallback(
    (opts = { spreadVertical: true, acrossBoards: true }) => {
      const placed = [];
      const src = noDuplicateCopy(images);
      shuffleInPlace(src);

      let nextBoard = 0;
      const tryPlace = (node) => {
        const maxTries = 400;
        // pick size range again to vary
        const minW = boardW * 0.25;
        const maxW = boardW * 0.65;
        const w = Math.floor(minW + Math.random() * (maxW - minW));
        const h = Math.floor(w * (0.6 + Math.random() * 0.4));
        for (let t = 0; t < maxTries; t++) {
          const boardIndex = opts.acrossBoards
            ? ((nextBoard + t) % boards)
            : Math.floor(Math.random() * boards);

          const bx = boardIndex * boardW;
          const x = Math.floor(bx + Math.random() * (boardW - w));
          const y = opts.spreadVertical
            ? Math.floor(Math.random() * Math.max(1, boardH - h))
            : Math.floor((boardH - h) * Math.random() * 0.6);

          const candidate = { ...node, x, y, w, h };
          const overlap = placed.some((p) => overlapWith(candidate, p, spacing));
          if (!overlap) {
            placed.push(candidate);
            nextBoard = (boardIndex + 1) % boards;
            return candidate;
          }
        }
        // fallback clamp to board grid
        const boardIndex = nextBoard;
        nextBoard = (nextBoard + 1) % boards;
        const bx = boardIndex * boardW;
        const c = {
          ...node,
          x: bx + 2,
          y: 2,
          w: Math.min(maxW, boardW - spacing * 2),
          h: Math.min(Math.floor(maxW * 0.75), boardH - spacing * 2),
        };
        placed.push(c);
        return c;
      };

      setImages(src.map(tryPlace));
    },
    [images, boards, boardW, boardH, spacing]
  );

  // editorial: column rows grid that fills height properly
  const editorial = useCallback(
    (gap = spacing) => {
      const src = noDuplicateCopy(images);
      shuffleInPlace(src);
      const colsPerBoard = 2 + Math.floor(Math.random() * 3); // 2..4
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
            const h = Math.min(
              Math.floor(colW * (0.75 + Math.random() * 0.6)),
              boardH - y - gap
            );
            const node = { ...n, x: colX, y, w: colW, h };
            if (!placed.some((p) => overlapWith(node, p, gap * 0.5))) {
              placed.push(node);
              y += h + gap;
            } else {
              // try push down a bit
              y += Math.max(8, gap);
              idx--; // retry same item in next slot
            }
          }
          colX += colW + gap;
        }
      }
      setImages(placed);
    },
    [images, boards, boardW, boardH, spacing]
  );

  // seamless editorial (no spacing, edge to edge)
  const editorialSeamless = useCallback(() => editorial(0), [editorial]);

  // distribute across boards evenly (keeps original sizes)
  const distributeAcrossBoards = useCallback(() => {
    const src = noDuplicateCopy(images);
    shuffleInPlace(src);
    const perBoard = Math.ceil(src.length / Math.max(1, boards));
    let idx = 0;
    const out = [];
    for (let b = 0; b < boards; b++) {
      const bx = b * boardW;
      const start = idx;
      const end = Math.min(src.length, start + perBoard);
      for (let i = start; i < end; i++) {
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
  }, [images, boards, boardW, boardH]);

  // pack bottom fills from top to bottom with spacing
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
      if (!placedOne) placed.push(n); // keep original if cannot pack
    }
    setImages(placed);
  }, [images, boards, boardW, boardH, spacing]);

  // shuffle only order, keep positions
  const shuffleOrder = () => {
    const copy = noDuplicateCopy(images);
    shuffleInPlace(copy);
    setImages(copy);
  };

  // fix bounds clamps everything inside boards
  const fixBounds = () => {
    setImages((prev) =>
      prev.map((n) => {
        const w = clamp(n.w, 4, boardW);
        const h = clamp(n.h, 4, boardH);
        let x = clamp(n.x, 0, spreadW - w);
        // keep on same board slice if already inside a board
        const boardIndex = Math.floor(x / boardW);
        const bx = boardIndex * boardW;
        x = clamp(x, bx, bx + boardW - w);
        const y = clamp(n.y, 0, boardH - h);
        return { ...n, x, y, w, h };
      })
    );
  };

  // export single board
  const exportBoard = async (i, type = "image/png") => {
    const canvas = document.createElement("canvas");
    canvas.width = boardW * exportScale;
    canvas.height = boardH * exportScale;
    const ctx = canvas.getContext("2d");
    // background
    ctx.fillStyle = exportBg || "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // draw crops
    const ops = cropOpsForBoard(images, i, boardW, boardH);
    for (const op of ops) {
      const sx = op.sx * (op.img.naturalWidth / (op.placedW || 1));
      const sy = op.sy * (op.img.naturalHeight / (op.placedH || 1));
      const sw = op.sw * (op.img.naturalWidth / (op.placedW || 1));
      const sh = op.sh * (op.img.naturalHeight / (op.placedH || 1));

      ctx.drawImage(
        op.img,
        Math.max(0, sx),
        Math.max(0, sy),
        Math.max(1, sw),
        Math.max(1, sh),
        Math.round(op.dx * exportScale),
        Math.round(op.dy * exportScale),
        Math.round(op.dw * exportScale),
        Math.round(op.dh * exportScale)
      );
    }

    return await new Promise((res) => canvas.toBlob(res, type, type === "image/jpeg" ? 0.95 : undefined));
  };

  const downloadURL = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportPNG = async () => {
    if (images.some((n) => n.src && !n._imageEl)) {
      alert("Images are still loading. Try again in a moment.");
      return;
    }
    for (let i = 0; i < boards; i++) {
      const blob = await exportBoard(i, "image/png");
      downloadURL(blob, `858 art club_${i + 1}.png`);
    }
  };

  const exportJPG = async () => {
    if (images.some((n) => n.src && !n._imageEl)) {
      alert("Images are still loading. Try again in a moment.");
      return;
    }
    for (let i = 0; i < boards; i++) {
      const blob = await exportBoard(i, "image/jpeg");
      downloadURL(blob, `858 art club_${i + 1}.jpg`);
    }
  };

  const exportZIP = async () => {
    if (images.some((n) => n.src && !n._imageEl)) {
      alert("Images are still loading. Try again in a moment.");
      return;
    }
    const zip = new JSZip();
    for (let i = 0; i < boards; i++) {
      const blob = await exportBoard(i, "image/png");
      zip.file(`858 art club_${i + 1}.png`, blob);
    }
    const zblob = await zip.generateAsync({ type: "blob" });
    downloadURL(zblob, "858 art club.zip");
  };

  // keyboard
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
  }, [pack, randomise, selectedId]);

  // count
  const imgCount = images.length;

  return (
    <div
      className="app"
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "white",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      }}
    >
      {/* preview */}
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
          margin: "0 auto",
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
          {/* board dividers + slide numbers (non-export) */}
          {showGrid &&
            [...Array(boards)].map((_, i) => (
              <React.Fragment key={`grid${i}`}>
                <div
                  className="no-export"
                  style={{
                    position: "absolute",
                    left: i * boardW,
                    top: 0,
                    width: boardW,
                    height: 24,
                    display: "flex",
                    alignItems: "center",
                    paddingLeft: 8,
                    color: "#aaa",
                    fontSize: 12,
                    letterSpacing: 0.5,
                    background: "transparent",
                    pointerEvents: "none",
                  }}
                >
                  slide {i + 1}
                </div>
                <div
                  className="no-export"
                  style={{
                    position: "absolute",
                    left: i * boardW,
                    top: 0,
                    width: boardW,
                    height: boardH,
                    outline: `1px solid ${gridColour}80`,
                    pointerEvents: "none",
                    opacity: gridOpacity,
                  }}
                />
              </React.Fragment>
            ))}

          {/* images */}
          {images.map((n) => (
            <Item
              key={n.id}
              node={n}
              selected={n.id === selectedId}
              onSelect={() => setSelectedId(n.id)}
              onChange={(next) =>
                setImages((prev) => prev.map((x) => (x.id === n.id ? next : x)))
              }
            />
          ))}
        </div>
      </div>

      {/* controls bar at bottom */}
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
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <div>
          <label className="lbl">Boards</label>
          <input
            className="in"
            type="number"
            min={1}
            max={MAX_BOARDS}
            value={boards}
            onChange={(e) => setBoards(clamp(parseInt(e.target.value || "1", 10), 1, MAX_BOARDS))}
          />
        </div>

        <div>
          <label className="lbl">W</label>
          <input
            className="in"
            type="number"
            min={320}
            value={boardW}
            onChange={(e) => setBoardW(clamp(parseInt(e.target.value || "1", 10), 100, 8000))}
          />
        </div>
        <div>
          <label className="lbl">H</label>
          <input
            className="in"
            type="number"
            min={320}
            value={boardH}
            onChange={(e) => setBoardH(clamp(parseInt(e.target.value || "1", 10), 100, 8000))}
          />
        </div>

        <div>
          <label className="lbl">Spacing</label>
          <input
            className="in"
            type="number"
            min={0}
            max={200}
            value={spacing}
            onChange={(e) => setSpacing(clamp(parseInt(e.target.value || "0", 10), 0, 200))}
          />
        </div>

        <div>
          <button className="btn" onClick={() => randomise({ spreadVertical: true, acrossBoards: true })}>
            Randomise
          </button>
          <button className="btn" onClick={pack}>Pack</button>
          <button className="btn" onClick={editorial}>Editorial (spaced)</button>
          <button className="btn" onClick={editorialSeamless}>Editorial (seamless)</button>
          <button className="btn" onClick={distributeAcrossBoards}>Distribute boards</button>
          <button className="btn" onClick={shuffleOrder}>Shuffle order</button>
          <button className="btn" onClick={fixBounds}>Fix bounds</button>
          <button
            className="btn"
            onClick={() => setImages([])}
            title="Remove all placed images from the spread"
          >
            Reset layout
          </button>
        </div>

        <div>
          <label className="lbl">Preview zoom</label>
          <input
            className="in"
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            value={previewZoom}
            onChange={(e) => setPreviewZoom(parseFloat(e.target.value))}
          />
        </div>

        <div>
          <label className="lbl">Guides colour</label>
          <input
            className="in"
            type="color"
            value={gridColour}
            onChange={(e) => setGridColour(e.target.value)}
          />
        </div>

        <div>
          <label className="lbl">Guides opacity</label>
          <input
            className="in"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={gridOpacity}
            onChange={(e) => setGridOpacity(parseFloat(e.target.value))}
          />
        </div>

        <div>
          <label className="lbl">Show guides</label>
          <input
            className="chk"
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
          />
        </div>

        <div>
          <label className="lbl">Export scale</label>
          <input
            className="in"
            type="number"
            min={1}
            max={4}
            value={exportScale}
            onChange={(e) =>
              setExportScale(clamp(parseInt(e.target.value || "1", 10), 1, 4))
            }
          />
        </div>

        <div>
          <label className="lbl">Background</label>
          <input
            className="in"
            type="color"
            value={exportBg || "#000000"}
            onChange={(e) => setExportBg(e.target.value)}
          />
        </div>

        <div>
          <button className="btn" onClick={exportPNG}>Export PNG</button>
          <button className="btn" onClick={exportJPG}>Export JPG</button>
          <button className="btn" onClick={exportZIP}>Export ZIP</button>
        </div>

        <div>
          <label className="file-btn btn">
            Add images
            <input className="file" type="file" multiple accept="image/*" onChange={onFileInput} />
          </label>
          <span className="muted">Count: {imgCount}</span>
        </div>
      </div>

      {/* tiny style helpers */}
      <style>{`
        .btn {
          background:#161616; color:#eaeaea; border:1px solid #2a2a2a;
          border-radius:8px; padding:8px 10px; margin:2px; font-size:12px;
        }
        .btn:hover { background:#1e1e1e; }
        .in {
          width:100%; background:#121212; color:#f2f2f2; border:1px solid #2a2a2a;
          border-radius:6px; padding:6px 8px; font-size:12px;
        }
        .chk { transform: translateY(2px); }
        .lbl {
          display:block; font-size:11px; color:#9aa0a6; margin-bottom:4px;
        }
        .file { display:none; }
        .file-btn { position:relative; overflow:hidden; }
        .muted { color:#9aa0a6; font-size:12px; margin-left:8px; }
        .no-export { /* marker class; not used in canvas export */ }
      `}</style>
    </div>
  );
}
