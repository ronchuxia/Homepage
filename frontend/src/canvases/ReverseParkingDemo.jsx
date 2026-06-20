import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Scene + car dimensions, all in METRES (drawn to scale). World frame has y
// pointing UP: the parking spots sit at the top (back wall at y = WALL, their
// mouth at y = MOUTH) and the driving aisle is the band below the mouth.
// ---------------------------------------------------------------------------
const MOUTH = 6; // y of the spot opening (curb line between spots and aisle)
const WALL = 11; // y of the back wall of the spots (depth 5 m)
const SPOT_W = 2.6; // perpendicular stall width (US standard ~2.6 m)

// Stall divider lines: three stalls centred on x = -2.6, 0, +2.6.
const DIVIDERS = [-1.5 * SPOT_W, -0.5 * SPOT_W, 0.5 * SPOT_W, 1.5 * SPOT_W];

// Our car. The rear axle is the reference point: it sits 0.95 m behind the rear
// bumper and 3.65 m (wheelbase + front overhang) ahead lies the front bumper.
const CAR = { len: 4.6, wid: 1.8, wb: 2.7, rearOH: 0.95 };

const R = 4.5; // minimum turning radius at the rear axle (~31° steering lock)
const QUARTER = (Math.PI / 2) * R; // arc length of a 90° turn at radius R

// Screen transform (shared by both figures so the stalls line up). The view
// runs from about y = -3 (deep in the aisle) up past the back wall.
const S = 29.5; // px per metre
const CW = 470;
const CH_WIDE = 440; // tall enough to show the head-in car's deep swing
const CH_NARROW = 351; // crop at y = 0 (= OY), where the 6 m aisle ends
const OX = 195.5;
const OY = 351;
const px = (p) => [OX + p[0] * S, OY - p[1] * S];

// ---------------------------------------------------------------------------
// Kinematic bicycle model. A maneuver is a list of constant-control segments;
// within a segment the rear axle either drives straight or along a circular arc
// of signed curvature k (left turn positive), travelling forward (dir +1) or in
// reverse (dir -1). Because every segment is a straight line or a true arc, the
// rear wheels never slip sideways — the car cannot slide on the ground.
// ---------------------------------------------------------------------------
function endPose(seg) {
  const { k, dir, len, x0, y0, th0 } = seg;
  const th1 = th0 + dir * k * len;
  let x1, y1;
  if (Math.abs(k) < 1e-9) {
    x1 = x0 + dir * len * Math.cos(th0);
    y1 = y0 + dir * len * Math.sin(th0);
  } else {
    x1 = x0 + (1 / k) * (Math.sin(th1) - Math.sin(th0));
    y1 = y0 - (1 / k) * (Math.cos(th1) - Math.cos(th0));
  }
  return { x1, y1, th1 };
}

function buildManeuver(start, controls) {
  let { x, y, th } = start;
  const segs = [];
  for (const c of controls) {
    if (c.len <= 1e-9) continue;
    const seg = { k: c.k, dir: c.dir, len: c.len, x0: x, y0: y, th0: th };
    const e = endPose(seg);
    seg.x1 = e.x1;
    seg.y1 = e.y1;
    seg.th1 = e.th1;
    segs.push(seg);
    x = e.x1;
    y = e.y1;
    th = e.th1;
  }
  return { segs, total: segs.reduce((a, s) => a + s.len, 0), start };
}

function poseInSeg(seg, u) {
  const { k, dir, x0, y0, th0 } = seg;
  const th = th0 + dir * k * u;
  let x, y;
  if (Math.abs(k) < 1e-9) {
    x = x0 + dir * u * Math.cos(th0);
    y = y0 + dir * u * Math.sin(th0);
  } else {
    x = x0 + (1 / k) * (Math.sin(th) - Math.sin(th0));
    y = y0 - (1 / k) * (Math.cos(th) - Math.cos(th0));
  }
  return { x, y, th, seg };
}

function poseAtDist(man, d) {
  let r = Math.max(0, Math.min(d, man.total));
  for (const seg of man.segs) {
    if (r <= seg.len + 1e-9) return poseInSeg(seg, r);
    r -= seg.len;
  }
  const last = man.segs[man.segs.length - 1];
  return poseInSeg(last, last.len);
}

// Re-time the slider so the 90° turn lands in the same window for both figures,
// even though the maneuvers differ in length. The lead-in + arc (identical in
// both) share the first TURN_T of the slider at constant speed — so the arc,
// and with it the centre of rotation, appears at the same moment in each — and
// the final straight-in fills the rest.
const TURN_T = 2 / 3;
function distanceForT(man, t) {
  let leadArc = 0;
  for (const s of man.segs) {
    leadArc += s.len;
    if (Math.abs(s.k) > 1e-9) break; // stop once the arc is included
  }
  if (t <= TURN_T) return (t / TURN_T) * leadArc;
  return leadArc + ((t - TURN_T) / (1 - TURN_T)) * (man.total - leadArc);
}

// Both cars finish flush with the parked neighbours, which fill y = [6.2, 10.8].
// The turn height is kept separate from the parked depth so the reverse and the
// head-in "jam" turns stay exact mirror images.
const TURN_Y = 6.95; // height where the symmetric 90° turn finishes
const PARK_OUT_Y = 9.85; // rear axle parked nose-out (rear bumper at the wall)
const PARK_IN_Y = 7.15; // rear axle parked nose-in (nose at the wall)

// Reverse: from alongside the stall (already pulled past it), back in — the car
// only ever moves backward. Ends nose-out, so the rear axle (the pivot) finishes
// deep in the stall. The arc finishes its 90° turn at y = 6.95 — the same height
// the head-in arc ends — so the two turn centres are exact mirror images about
// the stall centre, at (±4.5, 6.95). The car then backs straight the rest in.
const reverseMan = buildManeuver(
  { x: R, y: TURN_Y - R, th: 0 },
  [
    { k: 1 / R, dir: -1, len: QUARTER },
    { k: 0, dir: -1, len: PARK_OUT_Y - TURN_Y },
  ],
);

// Head-in, "narrow" view: the mirror image of the reverse turn (turn centre at
// (-4.5, 6.95)). Leading with the nose, the same full-lock turn sweeps the wide
// end between the parked cars — its outer corner runs into the neighbour and the
// path jams, so it never reaches a parked pose.
const headInJam = buildManeuver(
  { x: -R, y: TURN_Y - R, th: 0 },
  [
    { k: 1 / R, dir: 1, len: QUARTER },
  ],
);

// Head-in, "wide" view: the same full-lock turn, but started far enough back
// that the nose finishes straightening before the mouth and clears the
// neighbours. It finishes the turn low (y = 3.2), then drives straight in — and
// has to begin its turn well outside a 6 m aisle to pull it off.
const HEAD_YALIGN = 3.2;
const headInClean = buildManeuver(
  { x: -R, y: HEAD_YALIGN - R, th: 0 },
  [
    { k: 1 / R, dir: 1, len: QUARTER },
    { k: 0, dir: 1, len: PARK_IN_Y - HEAD_YALIGN },
  ],
);

// Convex outline of the tapered shell, sampled along the same bezier corners
// carShell draws (local u = forward / v = left). Collisions test this rather
// than a bounding rectangle, so a car freezes exactly when the drawn bodies
// touch — not when their square corners would.
function cubicPoint(p0, p1, p2, p3, t) {
  const m = 1 - t;
  return [
    m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0],
    m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1],
  ];
}
const SHELL_POLY = (() => {
  const pts = [];
  const add = (p) => {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) pts.push(p);
  };
  const arc = (p0, p1, p2, p3) => {
    for (let i = 1; i <= 4; i++) add(cubicPoint(p0, p1, p2, p3, i / 4));
  };
  add([3.63, 0.3]);
  add([3.63, -0.3]);
  arc([3.63, -0.3], [3.61, -0.68], [3.43, -0.86], [2.9, -0.9]);
  add([-0.4, -0.9]);
  arc([-0.4, -0.9], [-0.8, -0.88], [-0.93, -0.66], [-0.95, -0.3]);
  add([-0.95, 0.3]);
  arc([-0.95, 0.3], [-0.93, 0.66], [-0.8, 0.88], [-0.4, 0.9]);
  add([2.9, 0.9]);
  arc([2.9, 0.9], [3.43, 0.86], [3.61, 0.68], [3.63, 0.3]);
  const f = pts[0];
  const l = pts[pts.length - 1];
  if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 1e-6) pts.pop();
  return pts;
})();

// The car's body outline at a given rear-axle pose, in world metres.
function carBody(p) {
  const c = Math.cos(p.th);
  const s = Math.sin(p.th);
  return SHELL_POLY.map(([u, v]) => [p.x + u * c - v * s, p.y + u * s + v * c]);
}

// --- realistic top-down car, adapted from the blind-spot canvas --------------
// Drawn in a local frame: u = metres forward of the rear axle, v = metres to
// the car's left. makeL maps that frame to screen pixels at a given pose.
const EGO_CAR = { fill: '#7aa9e6', stroke: '#2f6bb3' };
const EGO_HIT = { fill: '#efa6a6', stroke: '#dc2626' };
const NEIGHBOR_CAR = { fill: '#cbd0d6', stroke: '#9aa1a8' };

function makeL(pose) {
  const c = Math.cos(pose.th);
  const s = Math.sin(pose.th);
  return (u, v) => px([pose.x + u * c - v * s, pose.y + u * s + v * c]);
}

// Tapered body outline (nose at u = 3.63, tail at u = -0.95, half-width 0.9).
function carShell(ctx, L) {
  ctx.beginPath();
  ctx.moveTo(...L(3.63, 0.3));
  ctx.lineTo(...L(3.63, -0.3));
  ctx.bezierCurveTo(...L(3.61, -0.68), ...L(3.43, -0.86), ...L(2.9, -0.9));
  ctx.lineTo(...L(-0.4, -0.9));
  ctx.bezierCurveTo(...L(-0.8, -0.88), ...L(-0.93, -0.66), ...L(-0.95, -0.3));
  ctx.lineTo(...L(-0.95, 0.3));
  ctx.bezierCurveTo(...L(-0.93, 0.66), ...L(-0.8, 0.88), ...L(-0.4, 0.9));
  ctx.lineTo(...L(2.9, 0.9));
  ctx.bezierCurveTo(...L(3.43, 0.86), ...L(3.61, 0.68), ...L(3.63, 0.3));
  ctx.closePath();
}

function drawCar(ctx, pose, colors, showIcr) {
  const L = makeL(pose);
  const delta = Math.atan(CAR.wb * pose.seg.k); // front-wheel steering angle

  // wheels first, so the body sits over them with the tyres peeking out
  ctx.fillStyle = '#1f2937';
  const wheel = (u0, v0, al) => {
    const f = [Math.cos(al), Math.sin(al)];
    const g = [-Math.sin(al), Math.cos(al)];
    ctx.beginPath();
    [[0.31, 0.08], [0.31, -0.08], [-0.31, -0.08], [-0.31, 0.08]].forEach(
      ([a, b], i) => {
        const pt = L(u0 + a * f[0] + b * g[0], v0 + a * f[1] + b * g[1]);
        if (i) ctx.lineTo(...pt);
        else ctx.moveTo(...pt);
      },
    );
    ctx.closePath();
    ctx.fill();
  };
  wheel(CAR.wb, 0.86, delta); // front axle: steered
  wheel(CAR.wb, -0.86, delta);
  wheel(0, 0.86, 0); // rear axle: aligned
  wheel(0, -0.86, 0);

  // body shell
  carShell(ctx, L);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = colors.stroke;
  ctx.stroke();

  // hood + boot cut lines
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(...L(2.73, 0.8));
  ctx.quadraticCurveTo(...L(2.91, 0), ...L(2.73, -0.8));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(...L(-0.51, 0.78));
  ctx.quadraticCurveTo(...L(-0.65, 0), ...L(-0.51, -0.78));
  ctx.stroke();

  // glasshouse (windshield, side glass, backlight), then the roof panel over it
  ctx.beginPath();
  ctx.moveTo(...L(2.6, 0.76));
  ctx.lineTo(...L(2.6, -0.76));
  ctx.lineTo(...L(1.9, -0.8));
  ctx.lineTo(...L(0.2, -0.8));
  ctx.lineTo(...L(-0.37, -0.71));
  ctx.lineTo(...L(-0.37, 0.71));
  ctx.lineTo(...L(0.2, 0.8));
  ctx.lineTo(...L(1.9, 0.8));
  ctx.closePath();
  ctx.fillStyle = 'rgba(38,50,60,0.34)';
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(...L(2.03, 0.6));
  ctx.lineTo(...L(2.03, -0.6));
  ctx.lineTo(...L(0.2, -0.6));
  ctx.lineTo(...L(0.2, 0.6));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();

  // instantaneous centre of rotation + spokes (every wheel ⟂ its spoke)
  const k = pose.seg.k;
  if (showIcr && Math.abs(k) > 1e-6) {
    const c = Math.cos(pose.th);
    const s = Math.sin(pose.th);
    const icr = [pose.x - (1 / k) * s, pose.y + (1 / k) * c];
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = '#aab2bb';
    ctx.lineWidth = 1;
    for (const [u, v] of [[CAR.wb, 0.86], [CAR.wb, -0.86], [0, 0.86], [0, -0.86]]) {
      ctx.beginPath();
      ctx.moveTo(...px(icr));
      ctx.lineTo(...L(u, v));
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = '#7b848d';
    const ic = px(icr);
    ctx.beginPath();
    ctx.arc(ic[0], ic[1], 3, 0, 7);
    ctx.fill();
  }
}

// Separating-axis test for two convex polygons. A rotated car is much smaller
// than its bounding box, so an axis-aligned test would falsely flag the car
// against a neighbour mid-turn; this checks the true (rotated) outline.
function polysOverlap(A, B) {
  for (const poly of [A, B]) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const nx = -(b[1] - a[1]);
      const ny = b[0] - a[0];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const p of A) {
        const d = p[0] * nx + p[1] * ny;
        if (d < minA) minA = d;
        if (d > maxA) maxA = d;
      }
      for (const p of B) {
        const d = p[0] * nx + p[1] * ny;
        if (d < minB) minB = d;
        if (d > maxB) maxB = d;
      }
      if (maxA <= minB || maxB <= minA) return false; // a gap on this axis
    }
  }
  return true;
}

function bodyHitsCar(p, otherPoly) {
  return polysOverlap(carBody(p), otherPoly);
}

// Distance along a maneuver at which the body first overlaps a neighbour, or
// Infinity if it never does (a clean park).
function firstBlockDist(man) {
  const N = 800;
  for (let i = 0; i <= N; i++) {
    const d = (man.total * i) / N;
    const p = poseAtDist(man, d);
    for (const n of NEIGHBORS) if (bodyHitsCar(p, n.poly)) return d;
  }
  return Infinity;
}

// Two parked neighbour cars, centred nose-in in the side stalls. Each keeps its
// pose (for drawing) and its world-space shell outline (for collisions).
const NB_CY = (MOUTH + WALL) / 2; // 8.5 m, the parked neighbour's centre
const NEIGHBORS = [-1, 1].map((side) => {
  const pose = { x: side * SPOT_W, y: NB_CY - 1.35, th: Math.PI / 2, seg: { k: 0 } };
  return { pose, poly: carBody(pose) };
});

export default function ReverseParkingDemo() {
  // 'wide' = wide aisle, both park (default); 'narrow' = 6 m aisle, head-in jams.
  const [mode, setMode] = useState('wide');

  // Narrow mode crops the figure to the 6 m aisle; wide mode shows the deep swing.
  const CH = mode === 'narrow' ? CH_NARROW : CH_WIDE;

  const headCanvasRef = useRef(null);
  const revCanvasRef = useRef(null);
  const sliderRef = useRef(null);
  // Animated segmented control: a highlight pill slides to the active option.
  const toggleRef = useRef(null);
  const wideBtnRef = useRef(null);
  const narrowBtnRef = useRef(null);
  const pillRef = useRef(null);
  const pillPlacedRef = useRef(false);

  useLayoutEffect(() => {
    const place = (animate) => {
      const cont = toggleRef.current;
      const pill = pillRef.current;
      const btn = (mode === 'wide' ? wideBtnRef : narrowBtnRef).current;
      if (!cont || !pill || !btn) return;
      const cr = cont.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
      pill.style.transition = animate
        ? `transform 300ms ${ease}, width 300ms ${ease}`
        : 'none';
      pill.style.width = `${br.width}px`;
      pill.style.transform = `translateX(${br.left - cr.left}px)`;
    };

    place(pillPlacedRef.current); // snap on first paint, animate after
    pillPlacedRef.current = true;
    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [mode]);

  useEffect(() => {
    const setup = (cv) => {
      const ctx = cv.getContext('2d');
      const dpr = Math.max(2, window.devicePixelRatio || 1);
      cv.width = CW * dpr;
      cv.height = CH * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    };
    const headCtx = setup(headCanvasRef.current);
    const revCtx = setup(revCanvasRef.current);
    const slider = sliderRef.current;

    const headMan = mode === 'narrow' ? headInJam : headInClean;
    const figures = {
      head: {
        ctx: headCtx,
        man: headMan,
        path: samplePath(headMan),
        blockDist: firstBlockDist(headMan),
      },
      rev: {
        ctx: revCtx,
        man: reverseMan,
        path: samplePath(reverseMan),
        blockDist: firstBlockDist(reverseMan),
      },
    };

    function samplePath(man) {
      const pts = [];
      for (let i = 0; i <= 200; i++) pts.push(poseAtDist(man, (man.total * i) / 200));
      return pts;
    }

    // --- drawing primitives (world coordinates -> screen via px) ------------
    function polyPath(ctx, pts) {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p))));
    }
    function fillPoly(ctx, pts, fill, stroke, lw = 1.5) {
      polyPath(ctx, pts);
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = stroke;
        ctx.stroke();
      }
    }
    function seg(ctx, a, b, color, lw, dash = []) {
      ctx.save();
      ctx.setLineDash(dash);
      ctx.lineWidth = lw;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(...px(a));
      ctx.lineTo(...px(b));
      ctx.stroke();
      ctx.restore();
    }
    function text(ctx, t, p, color, align = 'left', size = 12) {
      ctx.fillStyle = color;
      ctx.font = `${size}px "Avenir Next","Segoe UI",sans-serif`;
      ctx.textAlign = align;
      ctx.fillText(t, ...px(p));
    }

    function drawFigure(fig, t) {
      const ctx = fig.ctx;
      ctx.clearRect(0, 0, CW, CH);

      // ground
      ctx.fillStyle = '#e6e8eb';
      ctx.fillRect(0, 0, CW, CH);
      // aisle asphalt: from the mouth to the bottom of the figure. In narrow
      // mode the figure is cropped at y = 0, so the asphalt ends at the aisle.
      ctx.fillStyle = '#d4d7db';
      ctx.fillRect(0, px([0, MOUTH])[1], CW, CH - px([0, MOUTH])[1]);
      // stall area
      ctx.fillStyle = '#eceef1';
      ctx.fillRect(0, px([0, WALL])[1], CW, px([0, MOUTH])[1] - px([0, WALL])[1]);

      // middle stall highlight (the target)
      fillPoly(
        ctx,
        [
          [-0.5 * SPOT_W, MOUTH],
          [0.5 * SPOT_W, MOUTH],
          [0.5 * SPOT_W, WALL],
          [-0.5 * SPOT_W, WALL],
        ],
        '#e0ecff',
        null,
      );

      // stall paint, back wall, mouth (curb) line
      for (const dx of DIVIDERS) seg(ctx, [dx, MOUTH], [dx, WALL], '#ffffff', 3);
      seg(ctx, [-1.55 * SPOT_W, WALL], [1.55 * SPOT_W, WALL], '#8b939b', 4);
      seg(ctx, [-1.55 * SPOT_W, MOUTH], [1.55 * SPOT_W, MOUTH], '#ffffff', 2, [10, 8]);

      // neighbours, parked nose-in
      for (const n of NEIGHBORS) drawCar(ctx, n.pose, NEIGHBOR_CAR, false);

      // Swept footprint: faint ghosts trace where the car can go. Keep the
      // same spacing in every view, and stop once a narrow path hits a car.
      ctx.fillStyle = 'rgba(47,107,179,0.08)';
      for (let i = 1; i < 9; i++) {
        const d = (fig.man.total * i) / 9;
        if (d > fig.blockDist) break;
        const p = poseAtDist(fig.man, d);
        carShell(ctx, makeL(p));
        ctx.fill();
      }

      // rear-axle path of this maneuver
      ctx.save();
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#2563eb';
      polyPath(ctx, fig.path.map((p) => [p.x, p.y]));
      ctx.stroke();
      ctx.restore();

      // the car, at the slider position; if the path jams against a neighbour
      // it can't drive through, so freeze it at the point of contact
      const rawD = distanceForT(fig.man, t);
      const blocked = rawD >= fig.blockDist; // jammed against a neighbour
      const pose = poseAtDist(fig.man, blocked ? fig.blockDist : rawD);
      drawCar(ctx, pose, blocked ? EGO_HIT : EGO_CAR, true);

      // 1 m scale bar, upper-right in every figure.
      const sx = 6.9;
      const sy = 10.1;
      seg(ctx, [sx, sy], [sx + 1, sy], '#5b6b76', 3);
      text(ctx, '1 m', [sx + 0.5, sy + 0.45], '#5b6b76', 'center', 11);
    }

    function render() {
      const t = +slider.value / 1000;
      drawFigure(figures.head, t);
      drawFigure(figures.rev, t);
    }

    slider.addEventListener('input', render);
    render();
    return () => slider.removeEventListener('input', render);
  }, [mode, CH]);

  return (
    <div className="animate-fade-up">
      <header className="mb-8 border-b border-neutral-300 pb-6">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight">
          Head-In vs. Reverse Parking
        </h2>
      </header>

      <div className="prose prose-neutral mb-6 max-w-none">
        <p>
          I wanted to understand why reversing into a parking spot usually
          works better in a narrow aisle. This interactive figure compares
          reverse and head-in parking using the same car, the same stall, and the
          same steering angle.
        </p>
      </div>

      <div ref={toggleRef} className="relative mb-6 inline-flex text-sm">
        <span
          ref={pillRef}
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 rounded-md bg-sky-50"
          style={{ width: 0 }}
        />
        <button
          ref={wideBtnRef}
          type="button"
          onClick={() => setMode('wide')}
          className={`relative z-10 rounded-md px-3 py-2 font-medium transition-colors ${
            mode === 'wide' ? 'text-sky-700' : 'text-neutral-600 hover:text-sky-700'
          }`}
        >
          Wide aisle
        </button>
        <button
          ref={narrowBtnRef}
          type="button"
          onClick={() => setMode('narrow')}
          className={`relative z-10 rounded-md px-3 py-2 font-medium transition-colors ${
            mode === 'narrow' ? 'text-sky-700' : 'text-neutral-600 hover:text-sky-700'
          }`}
        >
          Narrow aisle
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <figure className="min-w-0">
          <figcaption className="mb-2 text-sm font-medium text-neutral-700">
            Head-in Parking
          </figcaption>
          <canvas
            ref={headCanvasRef}
            width={CW}
            height={CH}
            className="block h-auto w-full rounded-lg border border-neutral-300 bg-neutral-200"
          />
        </figure>

        <figure className="min-w-0">
          <figcaption className="mb-2 text-sm font-medium text-neutral-700">
            Reverse Parking
          </figcaption>
          <canvas
            ref={revCanvasRef}
            width={CW}
            height={CH}
            className="block h-auto w-full rounded-lg border border-neutral-300 bg-neutral-200"
          />
        </figure>
      </div>

      <div className="mt-6">
        <input
          ref={sliderRef}
          type="range"
          min="0"
          max="1000"
          step="1"
          defaultValue="0"
          aria-label="Drive the car from the aisle into the stall"
          className="h-1.5 w-full cursor-pointer accent-sky-500"
        />
        <div className="mt-1 flex justify-between text-xs text-neutral-500">
          <span>In the aisle</span>
          <span>Parked</span>
        </div>
      </div>

      <div className="prose prose-neutral mt-8 max-w-none">
        <p>
          The scene is drawn to scale: 2.6&nbsp;m stalls 5&nbsp;m deep, a
          4.6&nbsp;×&nbsp;1.8&nbsp;m car with a 2.7&nbsp;m wheelbase. The motion
          follows a kinematic bicycle model. The steering angle is fixed at
          31°, giving a rear-axle turning radius of 4.5&nbsp;m.
        </p>
        <p>
          The key difference is which end enters the stall first. The rear axle sits near
          the tail, so the tail follows a tight inner arc while the nose swings
          through a wider one. When you back in, the tail enters the stall first
          and the nose swings out in the open aisle. When you drive in, the nose
          has to clear the parked cars, so the turn must start farther away.
        </p>
      </div>
    </div>
  );
}
