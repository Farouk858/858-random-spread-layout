import React, { useEffect, useRef, useState } from "react";
import JSZip from "jszip";

/* ---------------------------- constants ---------------------------- */
const MAX_BOARDS = 20;
const DEFAULT_W = 1080;
const DEFAULT_H = 1320;
const DEFAULT_SPACING = 24;

const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const PRESETS = [
  { name: "1080 x 1320 (Portrait)", w: 1080, h: 1320 },
  { name: "1320 x 1080 (Landscape)", w: 1320, h: 1080 },
  { name: "1080 x 1080 (Square)", w: 1080, h: 1080 },
  { name: "1440 x 1080 (Widescreen)", w: 1440, h: 1080 },
];

const BOARD_LABEL_STYLE = {
  position: "absolute",
  top: 6,
  left: 6,
  fontSize: 16,              // bigger & readable
  fontWeight: 800,
  letterSpacing: 0.3,
  color: "rgba(127,255,127,0.95)",
  textShadow: "0 1px 0 #001",
  userSelect: "none",
  pointerEvents: "none",
};

/* -------------------------- math helpers -------------------------- */
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
function coverCrop(nW, nH, fW, fH, sx = 0, sy = 0, sw = fW, sh = fH) {
  const fAR = fW / fH, sAR = nW / nH;
  let coverW, coverH;
  if (sAR > fAR) { coverH = nH; coverW = fAR * coverH; }
  else { coverW = nW; coverH = coverW / fAR; }
  const srcX = (nW - coverW) / 2 + (sx / fW) * coverW;
  const srcY = (nH - coverH) / 2 + (sy / fH) * coverH;
  const srcW = (sw / fW) * coverW;
  const srcH = (sh / fH) * coverH;
  return { sx: srcX, sy: srcY, sw: srcW, sh: srcH };
}
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

/* ------------------------------- Item ------------------------------- */
function Item({ node, selected, onSelect, onChange }) {
  const ref = useRef(null);
  const img = useImg(node.src);

  useEffect(() => {
    if (!img) return;
    if (node._natW !== img.naturalWidth || node._natH !== img.naturalHeight) {
      onChange({ ...node, _natW: img.naturalWidth, _natH: img.naturalHeight });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;

    const down = (e) => {
      if (e.target.dataset.handle) return;
      dragging = true;
      const p = e.touches?.[0] || e;
      sx = p.clientX; sy = p.clientY; ox = node.x; oy = node.y;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      onSelect(node.id);
    };
    const move = (e) => {
      if (!dragging) return;
      const p = e.touches?.[0] || e;
      onChange({ ...node, x: ox + (p.clientX - sx), y: oy + (p.clientY - sy) });
    };
    const up = () => {
      dragging = false;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointerdown", down);
    return () => el.removeEventListener("pointerdown", down);
  }, [node, onChange, onSelect]);

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
        position: "absolute", left: node.x, top: node.y, width: node.w, height: node.h,
        border: selected ? "1px dashed rgba(180,255,180,0.8)" : "none",
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

      {selected && ["nw","ne","sw","se"].map((dir) => {
        const base = {
          position: "absolute", width: 12, height: 12, background: "#0e0e0e",
          border: "1px solid #88ff88", borderRadius: 2, transform: "translate(-50%,-50%)"
        };
        const pos = { nw:{left:0,top:0}, ne:{left:"100%",top:0}, sw:{left:0,top:"100%"}, se:{left:"100%",top:"100%"} }[dir];
        return (
          <span key={dir} data-handle onPointerDown={(e)=>startResize(dir,e)}
                style={{ ...base, ...pos, cursor:`${dir}-resize` }} />
        );
      })}
    </div>
  );
}

/* ------------------------------ App ------------------------------ */
export default function App() {
  /* geometry */
  const [boards, setBoards] = useState(6);
  const [BW, setBW] = useState(DEFAULT_W);
  const [BH, setBH] = useState(DEFAULT_H);
  const [spacing, setSpacing] = useState(DEFAULT_SPACING);

  /* preview */
  const [zoom, setZoom] = useState(0.62);
  const [showGuides, setShowGuides] = useState(true);
  const [guideColour, setGuideColour] = useState("#00ff5c");
  const [guideAlpha, setGuideAlpha] = useState(0.35);

  /* content */
  const [images, setImages] = useState([]);
  const [selected, setSelected] = useState(null);

  /* overlay shapes */
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayOnTop, setOverlayOnTop] = useState(true);     // <-- NEW: layer control
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [overlayColourA, setOverlayColourA] = useState("#1aff5c");
  const [overlayColourB, setOverlayColourB] = useState("#00a0ff");
  const [overlayShapes, setOverlayShapes] = useState([]); // {id, type:'bar'|'rect'|'circle'|'plus', board, x,y,w,h,r,s}

  /* colours favourites (background) */
  const [bgColour, setBgColour] = useState("#000");
  const [fav, setFav] = useState(() => {
    const raw = localStorage.getItem("favColours858");
    return raw ? JSON.parse(raw) : ["#000000", "#0b0b0b", "#ffffff", "#00ff5c", "#00c0ff", "#ff00ff"];
  });
  useEffect(()=>localStorage.setItem("favColours858", JSON.stringify(fav)), [fav]);

  /* export */
  const [exportScale, setExportScale] = useState(2);

  /* computed */
  const SPREAD_W = boards * BW;
  const SPREAD_H = BH;

  /* ------------- load files ------------- */
  const addFiles = async (fileList) => {
    const read = (f) => new Promise((res, rej) => {
      const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f);
    });
    const out = [];
    for (const f of fileList) {
      if (!f.type?.startsWith("image/")) continue;
      const src = await read(f);
      out.push({
        id: uid(), src,
        w: Math.floor(BW * (0.28 + Math.random() * 0.18)),
        h: Math.floor(BH * (0.28 + Math.random() * 0.18)),
        x: Math.floor(Math.random() * (SPREAD_W - BW)),
        y: Math.floor(Math.random() * (SPREAD_H - BH)),
      });
    }
    setImages((p) => [...p, ...out]);
  };

  /* ---------- overlap-safe random & pack & editorial ---------- */
  const noOverlapPlace = (arr) => {
    const cell = Math.max(16, Math.floor(Math.min(BW, BH) / 12));
    const occupied = [];
    const fits = (x,y,w,h) => !occupied.some(o => !(x + w <= o.x || o.x + o.w <= x || y + h <= o.y || o.y + o.h <= y));
    const take = (x,y,w,h) => occupied.push({x,y,w,h});
    const res = [];
    for (const n of arr) {
      const w = Math.min(n.w, BW - spacing * 2), h = Math.min(n.h, BH - spacing * 2);
      let attempts = 0, placed = false;
      while (attempts++ < 2000 && !placed) {
        const b = Math.floor(Math.random()*boards);
        const px = b*BW + spacing + Math.floor(Math.random() * ((BW - w - spacing*2) / cell)) * cell;
        const py = spacing + Math.floor(Math.random() * ((BH - h - spacing*2) / cell)) * cell;
        if (fits(px, py, w + spacing, h + spacing)) {
          take(px, py, w + spacing, h + spacing);
          res.push({ ...n, x: px, y: py, w, h });
          placed = true;
        }
      }
      if (!placed) {
        const b = 0;
        res.push({
          ...n,
          x: clamp(n.x, b*BW + spacing, (b+1)*BW - w - spacing),
          y: clamp(n.y, spacing, BH - h - spacing),
          w, h
        });
      }
    }
    return res;
  };
  const randomise = () => setImages(prev => noOverlapPlace(shuffle(prev)));

  const pack = () => {
    const placed = [];
    const sorted = [...images].sort((a,b)=>b.w*b.h - a.w*a.h);
    const res = sorted.map(n=>{
      for (let by = spacing; by <= BH - n.h - spacing; by += Math.max(8, spacing)) {
        for (let bxBoard = 0; bxBoard < boards; bxBoard++) {
          for (let bx = bxBoard*BW + spacing; bx <= (bxBoard+1)*BW - n.w - spacing; bx += Math.max(8, spacing)) {
            const cand = { ...n, x: bx, y: by };
            const collide = placed.some(p =>
              !(cand.x + cand.w + spacing <= p.x ||
                p.x + p.w + spacing <= cand.x ||
                cand.y + cand.h + spacing <= p.y ||
                p.y + p.h + spacing <= cand.y));
            if (!collide) { placed.push(cand); return cand; }
          }
        }
      }
      const keep = { ...n, x: clamp(n.x, spacing, SPREAD_W - n.w - spacing), y: clamp(n.y, spacing, SPREAD_H - n.h - spacing) };
      placed.push(keep); return keep;
    });
    setImages(res);
  };

  const editorial = (seamless=false) => {
    const colsPerBoard = 3;
    const totalCols = colsPerBoard * boards;
    const gutters = spacing;
    const colW = (BW - gutters * (colsPerBoard + 1)) / colsPerBoard;
    const order = shuffle(images);
    const heights = new Array(totalCols).fill(gutters);
    const out = order.map((n, i) => {
      const colIdx = i % totalCols;
      const boardIdx = Math.floor(colIdx / colsPerBoard);
      const within = colIdx % colsPerBoard;
      const x = boardIdx*BW + gutters + within*(colW+gutters);
      const ar = n._natW && n._natH ? n._natW/n._natH : 1.5;
      const w = colW, h = Math.max(60, Math.round(w / ar));
      const y = heights[colIdx];
      heights[colIdx] += h + (seamless ? 0 : gutters);
      return { ...n, x, y, w, h };
    });
    setImages(out);
  };

  const snapBottom = () => {
    setImages(prev => prev.map(n=>{
      const b = Math.floor(n.x/BW);
      const xw = n.x - b*BW;
      return { ...n, x: b*BW + clamp(xw, spacing, BW - n.w - spacing), y: BH - n.h - spacing };
    }));
  };

  const distributeBoards = () => {
    if (!images.length) return;
    const per = Math.ceil(images.length / boards);
    const order = shuffle(images);
    const res = [];
    for (let b=0;b<boards;b++){
      const slice = order.slice(b*per, b*per + per);
      let y = spacing;
      for (const n of slice) {
        const w = clamp(n.w || BW*0.32, BW*0.22, BW - spacing*2);
        const h = clamp(n.h || BH*0.24, BH*0.18, BH - spacing*2);
        if (y + h + spacing > BH) y = spacing;
        const x = b*BW + spacing + Math.random()*(BW - w - spacing*2);
        res.push({ ...n, x, y, w, h });
        y += h + spacing;
      }
    }
    setImages(res);
  };

  const fixBounds = () => {
    setImages(prev=>prev.map(n=>({
      ...n,
      x: clamp(n.x, spacing, SPREAD_W - n.w - spacing),
      y: clamp(n.y, spacing, SPREAD_H - n.h - spacing),
      w: Math.min(n.w, BW - spacing*2),
      h: Math.min(n.h, BH - spacing*2),
    })));
  };

  const resetLayout = () => {
    setImages(prev => prev.map((n,i)=>({
      ...n,
      x: (i%boards)*BW + spacing,
      y: spacing,
      w: clamp(n.w || BW*0.32, BW*0.24, BW - spacing*2),
      h: clamp(n.h || BH*0.24, BH*0.18, BH - spacing*2),
    })));
  };

  /* z order images */
  const sendToBack = () => { if(!selected) return;
    setImages(prev => { const i=prev.findIndex(n=>n.id===selected); if(i<0)return prev; const a=[...prev]; const [it]=a.splice(i,1); a.unshift(it); return a; });};
  const bringToFront = () => { if(!selected) return;
    setImages(prev => { const i=prev.findIndex(n=>n.id===selected); if(i<0)return prev; const a=[...prev]; const [it]=a.splice(i,1); a.push(it); return a; });};
  const bringForward = () => { if(!selected) return;
    setImages(prev => { const i=prev.findIndex(n=>n.id===selected); if(i<0||i===prev.length-1)return prev; const a=[...prev]; [a[i],a[i+1]]=[a[i+1],a[i]]; return a; });};
  const sendBackward = () => { if(!selected) return;
    setImages(prev => { const i=prev.findIndex(n=>n.id===selected); if(i<=0)return prev; const a=[...prev]; [a[i],a[i-1]]=[a[i-1],a[i]]; return a; });};

  /* ---------------- overlay shapes ---------------- */
  const regenOverlay = (mode="bars") => {
    const shapes = [];
    const perBoard = 18;
    for (let b=0;b<boards;b++){
      for (let i=0;i<perBoard;i++){
        const x = b*BW + Math.random()*BW;
        const y = Math.random()*BH;
        const pick = (m) => {
          if (m!=="mixed") return m;
          return ["bars","rects","circles","plus"][Math.floor(Math.random()*4)];
        };
        const kind = pick(mode);
        if (kind==="bars") {
          const w = 6 + Math.random()*14;
          const h = 60 + Math.random()* (BH*0.35);
          shapes.push({ id: uid(), type:"bar", board:b, x, y, w, h });
        } else if (kind==="rects") {
          const w = 40 + Math.random()*120;
          const h = 20 + Math.random()*90;
          shapes.push({ id: uid(), type:"rect", board:b, x, y, w, h });
        } else if (kind==="circles") {
          const r = 10 + Math.random()*40;
          shapes.push({ id: uid(), type:"circle", board:b, x, y, r });
        } else if (kind==="plus") {
          const s = 10 + Math.random()*36;
          shapes.push({ id: uid(), type:"plus", board:b, x, y, s });
        }
      }
    }
    setOverlayShapes(shapes);
  };
  const randomiseOverlay = () => {
    if (!overlayShapes.length) return regenOverlay("mixed");
    setOverlayShapes(shuffle(overlayShapes).map(s=>{
      const typePool = ["bar","rect","circle","plus"];
      const t = Math.random()<0.35 ? typePool[Math.floor(Math.random()*4)] : s.type;
      if (t==="bar"||t==="rect") {
        const w = t==="bar" ? 6 + Math.random()*14 : 40 + Math.random()*120;
        const h = t==="bar" ? 60 + Math.random()* (BH*0.35) : 20 + Math.random()*90;
        return { ...s, type:t, x:(Math.floor(s.x/BW))*BW + Math.random()*BW, y: Math.random()*BH, w, h, r:undefined, s:undefined };
      } else if (t==="circle") {
        const r = 10 + Math.random()*40;
        return { ...s, type:"circle", x:(Math.floor(s.x/BW))*BW + Math.random()*BW, y: Math.random()*BH, r, w:undefined, h:undefined, s:undefined };
      } else {
        const S = 10 + Math.random()*36;
        return { ...s, type:"plus", x:(Math.floor(s.x/BW))*BW + Math.random()*BW, y: Math.random()*BH, s:S, w:undefined, h:undefined, r:undefined };
      }
    }));
  };

  /* ---------------- export (no distortion) ---------------- */
  function buildOps(boardIndex) {
    const boardX = boardIndex * BW;
    const ops = [];
    for (const n of images) {
      const hit = intersect(n.x, n.y, n.w, n.h, boardX, 0, BW, BH);
      if (!hit) continue;
      if (!n._natW || !n._natH) continue;
      const fx = hit.x - n.x, fy = hit.y - n.y;
      const cover = coverCrop(n._natW, n._natH, n.w, n.h, fx, fy, hit.w, hit.h);
      ops.push({ img:n, src:cover, dst:{ dx: hit.x - boardX, dy: hit.y, dw: hit.w, dh: hit.h }});
    }
    return ops;
  }

  async function renderBoard(boardIndex, type="image/png", quality=0.95, scale=exportScale) {
    const canvas = document.createElement("canvas");
    canvas.width = BW * scale; canvas.height = BH * scale;
    const ctx = canvas.getContext("2d");
    // background
    ctx.fillStyle = bgColour || "#000"; ctx.fillRect(0,0,canvas.width,canvas.height);

    const drawOverlay = () => {
      ctx.globalAlpha = overlayOpacity;
      for (const s of overlayShapes) {
        const bx = boardIndex * BW;
        const ax = s.x - bx;
        if (ax < -BW || ax > BW) continue;
        if (s.type==="bar" || s.type==="rect") {
          ctx.fillStyle = overlayColourA;
          ctx.fillRect(Math.round((s.x - bx) * scale), Math.round(s.y * scale),
            Math.round((s.w||0) * scale), Math.round((s.h||0) * scale));
        } else if (s.type==="circle") {
          ctx.fillStyle = overlayColourB;
          ctx.beginPath();
          ctx.arc(Math.round((s.x - bx)*scale), Math.round(s.y*scale), (s.r||0)*scale, 0, Math.PI*2);
          ctx.fill();
        } else if (s.type==="plus") {
          ctx.fillStyle = overlayColourA;
          const sz = (s.s||18)*scale;
          const cx = (s.x - bx)*scale, cy = s.y*scale;
          ctx.fillRect(Math.round(cx - sz*0.15), Math.round(cy - sz*0.5), Math.round(sz*0.3), Math.round(sz));
          ctx.fillRect(Math.round(cx - sz*0.5), Math.round(cy - sz*0.15), Math.round(sz), Math.round(sz*0.3));
        }
      }
      ctx.globalAlpha = 1;
    };

    // If overlay is behind, draw it first
    if (overlayVisible && !overlayOnTop) drawOverlay();

    // draw images
    const ops = buildOps(boardIndex);
    for (const op of ops) {
      const el = new Image(); el.crossOrigin="anonymous";
      await new Promise(res=>{ el.onload=res; el.src=op.img.src; });
      ctx.drawImage(el, op.src.sx, op.src.sy, op.src.sw, op.src.sh,
        Math.round(op.dst.dx*scale), Math.round(op.dst.dy*scale),
        Math.round(op.dst.dw*scale), Math.round(op.dst.dh*scale));
    }

    // If overlay is on top, draw it now
    if (overlayVisible && overlayOnTop) drawOverlay();

    const ext = type === "image/jpeg" ? "jpg" : "png";
    const name = `858 art club_${boardIndex+1}.${ext}`;
    const dataUrl = canvas.toDataURL(type, quality);
    return { name, dataUrl };
  }
  const downloadURL = (dataUrl, filename) => {
    const a = document.createElement("a"); a.href = dataUrl; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
  };
  const exportPNG = async () => { for (let i=0;i<boards;i++){ const {name,dataUrl}=await renderBoard(i,"image/png",0.95); downloadURL(dataUrl,name);} };
  const exportJPG = async () => { for (let i=0;i<boards;i++){ const {name,dataUrl}=await renderBoard(i,"image/jpeg",0.92); downloadURL(dataUrl,name);} };
  const exportZIP = async () => {
    const zip = new JSZip();
    for (let i=0;i<boards;i++){ const {name,dataUrl}=await renderBoard(i,"image/png",0.95); zip.file(name, dataUrl.split(",")[1], {base64:true}); }
    const blob = await zip.generateAsync({type:"blob"}); const url=URL.createObjectURL(blob);
    downloadURL(url, "858 art club.zip"); URL.revokeObjectURL(url);
  };

  /* ---------------- UI computed ---------------- */
  const spreadStyle = {
    position: "relative",
    width: SPREAD_W * zoom,
    height: SPREAD_H * zoom,
    transform: `scale(${zoom})`,
    transformOrigin: "top left",
  };

  /* ---------------- render ---------------- */
  return (
    <div
      className="app"
      style={{ background:"#000", color:"#d6ffe0", minHeight:"100vh", display:"flex", flexDirection:"column" }}
      onDragOver={(e)=>e.preventDefault()}
      onDrop={(e)=>{e.preventDefault(); addFiles(e.dataTransfer.files);}}
    >
      {/* SPREAD */}
      <div style={{ flex:"1 1 auto", overflow:"auto", padding:12, borderBottom:"1px solid #0f3" }}
           onClick={(e)=>{ if (e.currentTarget===e.target) setSelected(null); }}>
        <div style={spreadStyle}>
          {/* guides */}
          {showGuides && [...Array(boards)].map((_,i)=>(
            <div key={i} style={{
              position:"absolute", left:i*BW, top:0, width:BW, height:BH,
              outline:`1px solid ${guideColour}`, opacity:guideAlpha,
            }}>
              <span style={BOARD_LABEL_STYLE}>slide {i+1}</span>
            </div>
          ))}

          {/* overlay (behind) */}
          {overlayVisible && !overlayOnTop && overlayShapes.map(s=>{
            const styleBase = { position:"absolute", opacity: overlayOpacity, pointerEvents:"none" };
            if (s.type==="bar"||s.type==="rect") {
              return <div key={s.id} style={{...styleBase, left:s.x, top:s.y, width:s.w, height:s.h, background: overlayColourA}} />;
            }
            if (s.type==="circle") {
              const d = (s.r||0)*2;
              return <div key={s.id} style={{...styleBase, left:s.x - s.r, top:s.y - s.r, width:d, height:d, borderRadius:"50%", background: overlayColourB}} />;
            }
            if (s.type==="plus") {
              const sz = s.s||18;
              return (
                <div key={s.id} style={{...styleBase, left:s.x - sz/2, top:s.y - sz/2, width:sz, height:sz}}>
                  <div style={{position:"absolute", left:"42%", top:0, width:"16%", height:"100%", background: overlayColourA}}/>
                  <div style={{position:"absolute", top:"42%", left:0, height:"16%", width:"100%", background: overlayColourA}}/>
                </div>
              );
            }
            return null;
          })}

          {/* items */}
          {images.map(n=>(
            <Item key={n.id} node={n} selected={selected===n.id}
                  onSelect={(id)=>setSelected(id)}
                  onChange={(next)=>setImages(prev=>prev.map(x=>x.id===n.id?next:x))}/>
          ))}

          {/* overlay (on top) */}
          {overlayVisible && overlayOnTop && overlayShapes.map(s=>{
            const styleBase = { position:"absolute", opacity: overlayOpacity, pointerEvents:"none" };
            if (s.type==="bar"||s.type==="rect") {
              return <div key={s.id} style={{...styleBase, left:s.x, top:s.y, width:s.w, height:s.h, background: overlayColourA}} />;
            }
            if (s.type==="circle") {
              const d = (s.r||0)*2;
              return <div key={s.id} style={{...styleBase, left:s.x - s.r, top:s.y - s.r, width:d, height:d, borderRadius:"50%", background: overlayColourB}} />;
            }
            if (s.type==="plus") {
              const sz = s.s||18;
              return (
                <div key={s.id} style={{...styleBase, left:s.x - sz/2, top:s.y - sz/2, width:sz, height:sz}}>
                  <div style={{position:"absolute", left:"42%", top:0, width:"16%", height:"100%", background: overlayColourA}}/>
                  <div style={{position:"absolute", top:"42%", left:0, height:"16%", width:"100%", background: overlayColourA}}/>
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>

      {/* CONTROLS */}
      <div
        className="panel"
        style={{
          background:"#0b0b0b", borderTop:"1px solid #0f3", padding:"10px 12px",
          display:"grid", gap:8, gridTemplateColumns:"repeat(12,minmax(0,1fr))", alignItems:"center", fontSize:13
        }}
      >
        {/* Layout */}
        <div style={{ gridColumn:"span 6", display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <span className="label">Layouts</span>
          <button onClick={randomise}>Randomise</button>
          <button onClick={pack}>Pack</button>
          <button onClick={()=>editorial(false)}>Editorial (spaced)</button>
          <button onClick={()=>editorial(true)}>Editorial (seamless)</button>
          <button onClick={snapBottom}>Snap bottom</button>
          <button onClick={distributeBoards}>Distribute boards</button>
          <button onClick={resetLayout}>Reset</button>
          <button onClick={fixBounds}>Fix bounds</button>
        </div>

        {/* Geometry */}
        <div style={{ gridColumn:"span 6", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <span className="label">Boards</span>
          <input type="number" min={1} max={MAX_BOARDS} value={boards}
                 onChange={(e)=>setBoards(clamp(parseInt(e.target.value||"1",10),1,MAX_BOARDS))}
                 style={{ width:64 }} />
          <select value={`${BW}x${BH}`} onChange={(e)=>{ const [w,h]=e.target.value.split("x").map(n=>parseInt(n,10)); setBW(w); setBH(h); fixBounds(); }}>
            {PRESETS.map(p=><option key={p.name} value={`${p.w}x${p.h}`}>{p.name}</option>)}
          </select>
          <span className="label">W</span><input type="number" value={BW} onChange={(e)=>setBW(clamp(parseInt(e.target.value||"1",10),200,4000))} style={{width:84}}/>
          <span className="label">H</span><input type="number" value={BH} onChange={(e)=>setBH(clamp(parseInt(e.target.value||"1",10),200,4000))} style={{width:84}}/>
          <span className="label">Spacing</span><input type="number" value={spacing} onChange={(e)=>setSpacing(clamp(parseInt(e.target.value||"0",10),0,400))} style={{width:64}}/>
        </div>

        {/* Export / BG */}
        <div style={{ gridColumn:"span 12", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <span className="label">Preview zoom</span>
          <input type="range" min={0.2} max={2} step={0.05} value={zoom} onChange={(e)=>setZoom(parseFloat(e.target.value))}/>
          <span className="label">Guides colour</span>
          <input type="color" value={guideColour} onChange={(e)=>setGuideColour(e.target.value)} />
          <span className="label">Guides opacity</span>
          <input type="range" min={0} max={1} step={0.05} value={guideAlpha} onChange={(e)=>setGuideAlpha(parseFloat(e.target.value))}/>
          <label className="check">
            <input type="checkbox" checked={showGuides} onChange={(e)=>setShowGuides(e.target.checked)} /> Show guides
          </label>

          <span className="label" style={{ marginLeft:"auto" }}>Count</span>
          <strong>{images.length}</strong>

          <button onClick={sendToBack}>Send to Back</button>
          <button onClick={sendBackward}>Send Backward</button>
          <button onClick={bringForward}>Bring Forward</button>
          <button onClick={bringToFront}>Bring to Front</button>

          <label className="file-btn" style={{ marginLeft:12 }}>
            Add images
            <input type="file" multiple accept="image/*" onChange={(e)=>e.target.files && addFiles(e.target.files)} style={{display:"none"}} />
          </label>
        </div>

        {/* Background + favourites + Export */}
        <div style={{ gridColumn:"span 8", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <span className="label">Background</span>
          <input type="color" value={bgColour} onChange={(e)=>setBgColour(e.target.value)}/>
          <div style={{ display:"flex", gap:6, alignItems:"center" }}>
            {fav.map((c,i)=>(
              <button key={i} title="Click apply • Alt+click remove"
                onClick={(e)=>{ if(e.altKey){ const a=[...fav]; a.splice(i,1); setFav(a);} else { setBgColour(c);} }}
                style={{ width:18, height:18, borderRadius:4, border:"1px solid #1aff7a", background:c }} />
            ))}
            <button onClick={()=>setFav(p=>Array.from(new Set([...p,bgColour])).slice(0,12))}>★ Save</button>
          </div>
        </div>
        <div style={{ gridColumn:"span 4", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <span className="label">Export scale</span>
          <input type="number" min={1} max={4} value={exportScale} onChange={(e)=>setExportScale(clamp(parseInt(e.target.value||"1",10),1,4))} style={{width:54}}/>
          <button onClick={exportPNG}>Export PNG</button>
          <button onClick={exportJPG}>Export JPG</button>
          <button onClick={exportZIP}>Export ZIP</button>
        </div>

        {/* Overlay controls */}
        <div style={{ gridColumn:"span 12", display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginTop:2 }}>
          <button onClick={()=>setOverlayVisible(v=>!v)}>{overlayVisible ? "Hide Overlay" : "Show Overlay"}</button>
          <button onClick={()=>setOverlayOnTop(false)}>Overlay to Back</button>  {/* NEW */}
          <button onClick={()=>setOverlayOnTop(true)}>Overlay to Front</button>
          <button onClick={()=>regenOverlay("bars")}>Bars</button>
          <button onClick={()=>regenOverlay("rects")}>Rects</button>
          <button onClick={()=>regenOverlay("circles")}>Circles</button>
          <button onClick={()=>regenOverlay("plus")}>Plus</button>
          <button onClick={()=>regenOverlay("mixed")}>Mixed overlay</button>     {/* NEW */}
          <button onClick={randomiseOverlay}>Mix overlay</button>                 {/* NEW */}
          <span className="label">Opacity</span>
          <input type="range" min={0} max={1} step={0.05} value={overlayOpacity} onChange={(e)=>setOverlayOpacity(parseFloat(e.target.value))}/>
          <span className="label">Colour A</span><input type="color" value={overlayColourA} onChange={(e)=>setOverlayColourA(e.target.value)}/>
          <span className="label">Colour B</span><input type="color" value={overlayColourB} onChange={(e)=>setOverlayColourB(e.target.value)}/>
        </div>
      </div>

      {/* Dark UI styling with readable inputs & labels */}
      <style>{`
        .app button {
          background:#0e0e0e;border:1px solid #1aff7a;color:#d6ffe0;
          padding:6px 10px;border-radius:8px;cursor:pointer; line-height:1
        }
        .app button:hover{background:#122;box-shadow:0 0 0 1px #1aff7a inset}
        .app input, .app select {
          background:#060606;border:1px solid #1aff7a;color:#d6ffe0;border-radius:6px;
          padding:6px 8px; outline:none
        }
        .app input::placeholder{ color:#9fffbf; opacity:0.7 }
        .app option { color:#0b0b0b; }
        .label{ color:#c8ffd9; font-weight:700; margin-right:4px }
        .check{ display:flex; align-items:center; gap:6px; color:#d6ffe0 }
        .file-btn{position:relative; overflow:hidden}
        .file-btn input{position:absolute; inset:0; opacity:0; cursor:pointer}
      `}</style>
    </div>
  );
}
