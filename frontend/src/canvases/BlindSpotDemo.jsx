import { useEffect, useRef } from 'react';

// Shared classes for the numeric readout pills (match the site's chip style).
const READOUT =
  'rounded-md bg-neutral-100 px-2.5 py-1 text-xs tabular-nums text-neutral-600';

// Faithful port of notes/references/blind-spot-demo.html. The drawing math is
// kept verbatim; the DOM lookups are replaced with refs and the animation loop
// is cleaned up on unmount.
export default function BlindSpotDemo() {
  const canvasRef = useRef(null);
  const angRef = useRef(null);
  const radRef = useRef(null);
  const convRef = useRef(null);
  const angOutRef = useRef(null);
  const fovOutRef = useRef(null);
  const gapOutRef = useRef(null);
  const radOutRef = useRef(null);

  useEffect(() => {
    const cv = canvasRef.current;
    const ctx = cv.getContext('2d');

    // Render the 900x660 figure oversampled at the device pixel ratio so it
    // stays crisp when CSS-stretched to fill the column on hi-DPI screens. All
    // drawing below stays in the original 900x660 coordinate space.
    const RENDER_SCALE = Math.max(2, window.devicePixelRatio || 1);
    cv.width = 900 * RENDER_SCALE;
    cv.height = 660 * RENDER_SCALE;
    ctx.scale(RENDER_SCALE, RENDER_SCALE);

    const slider = angRef.current;
    const radSlider = radRef.current;
    const convSel = convRef.current;
    const angOut = angOutRef.current;
    const fovOut = fovOutRef.current;
    const gapOut = gapOutRef.current;
    const radOut = radOutRef.current;

    let S = 75, OX = 130, OY = 40;                   // px per meter and origin
    const px = p => [OX + p[0] * S, OY + p[1] * S];  // world (m) -> screen

    // World frame: x right, y rearward, car front bumper at y = 0
    const CAR = { w: 1.8, l: 4.6 };
    const EYE = [-0.5, 1.9];                          // driver's eye, left front seat
    const MIR = [1.05, 1.15];                         // right mirror center (15 cm outboard)
    const MW = 0.16;                                  // mirror glass width
    const L = 24;                                     // ray length drawn (m)

    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]];
    const mul = (a, k) => [a[0] * k, a[1] * k], dot = (a, b) => a[0] * b[0] + a[1] * b[1];
    const norm = a => mul(a, 1 / Math.hypot(a[0], a[1]));
    const reflect = (d, n) => sub(d, mul(n, 2 * dot(d, n)));  // law of reflection
    const angOf = v => Math.atan2(v[1], v[0]);

    function poly(pts, fill, stroke) {
      ctx.beginPath();
      pts.forEach((p, i) => i ? ctx.lineTo(...px(p)) : ctx.moveTo(...px(p)));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
    }
    function line(a, b, color, w, dash = []) {
      ctx.save(); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(...px(a)); ctx.lineTo(...px(b)); ctx.stroke(); ctx.restore();
    }
    function label(t, p, color = '#3b4a55', align = 'left') {
      ctx.fillStyle = color; ctx.font = '13px "Avenir Next","Segoe UI",sans-serif';
      ctx.textAlign = align; ctx.fillText(t, ...px(p));
    }

    let headNow = 0;                                   // current head rotation (rad)
    let limNow = 118 * Math.PI / 180;                  // current peripheral limit (rad)
    let capNow = 0, capTarget = 0;                     // caption blend: 0 = inside cone, 1 = left
    let frame = 0;

    function drawCar() {
      const X = (x, y) => px([x, y]);
      // wheels first, so the body sits over them with the tyres peeking out;
      // front axle 0.95 m, rear axle 3.65 m (2.7 m wheelbase), track 1.72 m
      ctx.fillStyle = '#1d2329';
      for (const [wx, wy] of [[-0.86, 0.95], [0.86, 0.95], [-0.86, 3.65], [0.86, 3.65]]) {
        ctx.beginPath(); ctx.roundRect(...X(wx - 0.08, wy - 0.31), 0.16 * S, 0.62 * S, 0.06 * S); ctx.fill();
      }
      // body shell: tapered nose and tail, straight flanks (max half width 0.9 m)
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#7e8d97'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(...X(-0.30, 0.02));
      ctx.lineTo(...X(0.30, 0.02));
      ctx.bezierCurveTo(...X(0.68, 0.04), ...X(0.86, 0.22), ...X(0.90, 0.75));
      ctx.lineTo(...X(0.90, 4.05));
      ctx.bezierCurveTo(...X(0.88, 4.45), ...X(0.66, 4.58), ...X(0.30, 4.60));
      ctx.lineTo(...X(-0.30, 4.60));
      ctx.bezierCurveTo(...X(-0.66, 4.58), ...X(-0.88, 4.45), ...X(-0.90, 4.05));
      ctx.lineTo(...X(-0.90, 0.75));
      ctx.bezierCurveTo(...X(-0.86, 0.22), ...X(-0.68, 0.04), ...X(-0.30, 0.02));
      ctx.closePath(); ctx.fill(); ctx.stroke();

      // hood and trunk cut lines
      ctx.strokeStyle = '#aeb9c0'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(...X(-0.80, 0.92)); ctx.quadraticCurveTo(...X(0, 0.74), ...X(0.80, 0.92)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...X(-0.78, 4.16)); ctx.quadraticCurveTo(...X(0, 4.30), ...X(0.78, 4.16)); ctx.stroke();

      // seat back and headrest, peeking out behind the driver
      ctx.fillStyle = '#707c86';
      ctx.beginPath(); ctx.roundRect(...X(EYE[0] - 0.28, EYE[1] + 0.10), 0.56 * S, 0.14 * S, 5); ctx.fill();
      ctx.beginPath(); ctx.roundRect(...X(EYE[0] - 0.13, EYE[1] + 0.16), 0.26 * S, 0.10 * S, 4); ctx.fill();

      // steering wheel: the rim is raked toward the driver, so from above it
      // projects as a flattened ellipse; hub and three spokes likewise foreshortened
      const WY = 1.52;
      ctx.strokeStyle = '#2e3338'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.ellipse(...px([EYE[0], WY]), 0.19 * S, 0.085 * S, 0, 0, 7); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(...px([EYE[0] - 0.055, WY])); ctx.lineTo(...px([EYE[0] - 0.185, WY])); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...px([EYE[0] + 0.055, WY])); ctx.lineTo(...px([EYE[0] + 0.185, WY])); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...px([EYE[0], WY + 0.026])); ctx.lineTo(...px([EYE[0], WY + 0.082])); ctx.stroke();
      ctx.fillStyle = '#2e3338';
      ctx.beginPath(); ctx.ellipse(...px([EYE[0], WY]), 0.055 * S, 0.026 * S, 0, 0, 7); ctx.fill();

      // driver, top down: torso + shoulders forward, head rotates toward the
      // mirror when the glance convention is selected (small head turn, ~28°)
      ctx.fillStyle = '#3b4a55';
      ctx.beginPath(); ctx.ellipse(...px(EYE), 0.26 * S, 0.14 * S, 0, 0, 7); ctx.fill();   // shoulders
      // arms: shoulder to hand with a slight outward elbow bend
      ctx.strokeStyle = '#3b4a55'; ctx.lineWidth = 0.082 * S; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(...px(add(EYE, [-0.24, 0])));
      ctx.quadraticCurveTo(...px([EYE[0] - 0.30, EYE[1] - 0.19]), ...px([EYE[0] - 0.165, 1.555])); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(...px(add(EYE, [0.24, 0])));
      ctx.quadraticCurveTo(...px([EYE[0] + 0.30, EYE[1] - 0.19]), ...px([EYE[0] + 0.165, 1.555])); ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.fillStyle = '#d9a47e';                                                      // hands on the rim
      ctx.beginPath(); ctx.arc(...px([EYE[0] - 0.165, 1.555]), 0.046 * S, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(...px([EYE[0] + 0.165, 1.555]), 0.046 * S, 0, 7); ctx.fill();
      ctx.save();                                      // head, rotated by gaze (animated)
      ctx.translate(...px(EYE)); ctx.rotate(headNow);
      ctx.fillStyle = '#d9a47e';                                                      // ears (skin)
      ctx.beginPath(); ctx.arc(-0.112 * S, 0, 0.034 * S, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(0.112 * S, 0, 0.034 * S, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-0.05 * S, -0.105 * S); ctx.lineTo(0, -0.185 * S); ctx.lineTo(0.05 * S, -0.105 * S);
      ctx.closePath(); ctx.fill();                     // nose (skin) marks facing direction
      ctx.fillStyle = '#d9a47e';
      ctx.beginPath(); ctx.ellipse(0, 0, 0.105 * S, 0.125 * S, 0, 0, 7); ctx.fill();          // face/skull
      ctx.fillStyle = '#33281f';                                                      // hair: crescent over the crown
      ctx.beginPath(); ctx.ellipse(0, 0.012 * S, 0.105 * S, 0.118 * S, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#d9a47e';                                                      // forehead strip of skin at the front
      ctx.beginPath(); ctx.ellipse(0, -0.085 * S, 0.066 * S, 0.035 * S, 0, 0, 7); ctx.fill();
      ctx.restore();

      // glasshouse band: windshield, side glass, rear window in one glass surface
      ctx.fillStyle = 'rgba(201,213,221,.55)';
      ctx.beginPath();
      ctx.moveTo(...X(-0.76, 1.05)); ctx.lineTo(...X(0.76, 1.05));
      ctx.lineTo(...X(0.80, 1.75)); ctx.lineTo(...X(0.80, 3.45));
      ctx.lineTo(...X(0.71, 4.02)); ctx.lineTo(...X(-0.71, 4.02));
      ctx.lineTo(...X(-0.80, 3.45)); ctx.lineTo(...X(-0.80, 1.75));
      ctx.closePath(); ctx.fill();

      // roof panel; the visible glass margins become windshield, windows, backlight
      ctx.fillStyle = 'rgba(238,241,243,.65)'; ctx.strokeStyle = '#aeb9c0'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.roundRect(...X(-0.62, 1.62), 1.24 * S, 1.92 * S, 0.18 * S);
      ctx.fill(); ctx.stroke();

      label('driver', add(EYE, [0, -0.62]), '#22313c', 'center');
    }

    function draw() {
      const phi = +slider.value * Math.PI / 180;        // mirror angle vs. car's lateral axis
      const RC = +radSlider.value;                      // convex radius of curvature (m)
      ctx.clearRect(0, 0, cv.width, cv.height);

      // lane lines: divider at 1.8 m, far edge of adjacent 3.6 m lane at 5.4 m
      line([1.8, -1], [1.8, 30], '#b9c2c8', 2, [14, 12]);
      line([5.4, -1], [5.4, 30], '#b9c2c8', 2, [14, 12]);

      const t = [Math.cos(phi), Math.sin(phi)];         // mirror tangent
      const n = [-Math.sin(phi), Math.cos(phi)];        // mirror normal (faces rearward)
      const P1 = sub(MIR, mul(t, MW / 2)), P2 = add(MIR, mul(t, MW / 2));   // glass edges

      const d1 = norm(sub(P1, EYE)), d2 = norm(sub(P2, EYE));
      // spherical convex glass
      const Cc = sub(MIR, mul(n, Math.sqrt(RC * RC - (MW / 2) ** 2)));    // center of curvature
      const n1 = norm(sub(P1, Cc)), n2 = norm(sub(P2, Cc));           // local surface normals at the edges
      const r1 = reflect(d1, n1), r2 = reflect(d2, n2);

      // order the edge rays: out = away from the car, inn = toward the car
      const [out, inn] = [{ P: P1, r: r1 }, { P: P2, r: r2 }].sort((a, b) => angOf(a.r) - angOf(b.r));

      // occlusion by the car body
      const RX = CAR.w / 2, SIDE_END = 4.05, K = [RX, SIDE_END];
      const hit = o => {                                // intersection of a reflected ray with the car's right flank
        if (o.r[0] >= 0) return null;
        const u = (RX - o.P[0]) / o.r[0], y = o.P[1] + u * o.r[1];
        return (u > 0 && y < SIDE_END) ? [RX, y] : null;
      };
      const sample = s => {                             // mirror surface point at s in [-1,1] and its reflected ray
        const Q = add(MIR, mul(t, s * MW / 2));
        const nn = norm(sub(Q, Cc));
        return { Q, r: reflect(norm(sub(Q, EYE)), nn) };
      };
      const Hi = hit(inn), Ho = hit(out);
      let outEnd = add(out.P, mul(out.r, L)), innEnd = add(inn.P, mul(inn.r, L));
      let fov = [out.P, outEnd, innEnd, inn.P];
      let visInn = inn.r;                               // inner boundary direction of the VISIBLE cone
      if (Hi && Ho) {                                   // whole cone blocked by the car
        outEnd = Ho; innEnd = Hi;
        fov = [out.P, Ho, Hi, inn.P];
        visInn = null;                                  // nothing extends beyond the body
      } else if (Hi) {                                  // inner part blocked: bisect for the ray grazing corner K
        const miss = s => { const o = sample(s), k = sub(K, o.Q); return o.r[0] * k[1] - o.r[1] * k[0]; };
        let a = -1, b = 1;
        for (let i = 0; i < 40; i++) { const m = (a + b) / 2; Math.sign(miss(m)) === Math.sign(miss(a)) ? a = m : b = m; }
        const g = sample((a + b) / 2);
        innEnd = Hi;
        fov = [out.P, outEnd, add(g.Q, mul(g.r, L)), K, Hi, inn.P];
        visInn = g.r;                                   // grazing ray bounds the visible part
      }

      // peripheral vision limit ray, measured from straight ahead
      const aLim = limNow;                              // eased toward the selected convention
      const p = [Math.sin(aLim), -Math.cos(aLim)];
      const pe = add(EYE, mul(p, L));

      // blind spot wedge: between peripheral limit and the outermost reflected ray.
      const gap = angOf(out.r) - angOf(p);
      if (gap > 0.005) {
        const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
        const w0 = sub(out.P, EYE), D = -cross(p, out.r);
        const v = cross(out.r, w0) / D, u = cross(p, w0) / D;   // EYE + v·p = out.P + u·out.r
        const Xp = (v > 0 && u > 0) ? add(EYE, mul(p, v)) : EYE;
        poly([Xp, pe, outEnd], 'rgba(192,57,43,.16)');
        const mid = (angOf(out.r) + angOf(p)) / 2;
        label('blind spot', add(Xp, [Math.cos(mid) * 4.5, Math.sin(mid) * 4.5]), '#c0392b', 'center');
      }

      // blind spot WIDTH reported below uses the SAE 950601 convention
      const LC = 3.6;                                    // adjacent lane centre
      const hitX = (O, d) => d[0] !== 0 ? add(O, mul(d, (LC - O[0]) / d[0])) : O;
      const T = hitX(EYE, p), T2 = hitX(out.P, out.r);
      const gapSAE = angOf(sub(T2, out.P)) - angOf(sub(T, out.P));

      drawCar();

      // mirror field of view, clipped by the car body; boundary stroked solid
      ctx.lineWidth = 1.6;
      poly(fov, 'rgba(11,125,110,.18)', '#0b7d6e');
      {
        ctx.font = '13px "Avenir Next","Segoe UI",sans-serif';
        const tw = ctx.measureText('seen in mirror').width;
        const rad = 5.5;
        const dirMid = visInn ? norm(add(out.r, visInn)) : [0, 1];
        const inPos = add(out.P, mul(dirMid, rad));                 // in-area position (centre)
        const visAng = visInn ? angOf(visInn) - angOf(out.r) : 0;   // visible angular width
        capTarget = (visInn && visAng * rad * S > tw + 14) ? 0 : 1; // 0 = inside, 1 = left side
        const base = visInn ? ((Hi && !Ho) ? K : inn.P) : K;        // start of the inner visible boundary
        const d = visInn || [0, 1];
        const u = (inPos[1] - base[1]) / d[1];                      // boundary point at the in-area height
        const perpL = [-d[1], d[0]];                                // unit normal pointing left of the boundary
        const outAnchor = add(add(base, mul(d, u)), mul(perpL, 0.22));
        const outPos = sub(outAnchor, [tw / (2 * S), 0]);           // its centre-aligned equivalent
        const pos = [inPos[0] + (outPos[0] - inPos[0]) * capNow, inPos[1] + (outPos[1] - inPos[1]) * capNow];
        label('seen in mirror', pos, '#0b7d6e', 'center');
      }

      // incident rays (drawn after the car so they stay visible over the body)
      line(EYE, P1, '#c97a10', 2.2); line(EYE, P2, '#c97a10', 2.2);

      // peripheral limit
      line(EYE, pe, '#9fb3c0', 1.6, [7, 6]);
      label('peripheral vision limit', add(add(EYE, mul(p, 5.0)), [0.45, 0]), '#7a8b97');

      // mirror glass + housing; left mirror is the exact reflection of the right
      line(P1, P2, '#11202b', 5);
      line([-P1[0], P1[1]], [-P2[0], P2[1]], '#11202b', 5);
      label(`right mirror (convex, R = ${RC.toFixed(2)} m)`, add(MIR, [0.25, -0.15]), '#11202b');

      // 1 m scale bar
      line([-1.5, 7.9], [-0.5, 7.9], '#5b6b76', 3);
      label('1 m', [-1.2, 7.6], '#5b6b76');

      // readouts
      angOut.textContent = `${(+slider.value).toFixed(1)}°`;
      radOut.textContent = `${RC.toFixed(2)} m`;
      fovOut.textContent = `mirror FOV: ${(Math.abs(angOf(r1) - angOf(r2)) * 180 / Math.PI).toFixed(1)}°`;
      gapOut.textContent = gapSAE > 0.005 ? `blind spot width: ${(gapSAE * 180 / Math.PI).toFixed(1)}°`
        : 'blind spot closed';

      // ease the head, the peripheral limit, and the caption blend toward targets
      const targetHead = convSel.value === 'glance' ? 28 * Math.PI / 180 : 0;
      const targetLim = { eyesonly: 118, glance: 130 }[convSel.value] * Math.PI / 180;
      const dH = targetHead - headNow, dL = targetLim - limNow, dC = capTarget - capNow;
      if (Math.abs(dH) > 0.005 || Math.abs(dL) > 0.005 || Math.abs(dC) > 0.01) {
        headNow += dH * 0.18; limNow += dL * 0.18; capNow += dC * 0.18;
        frame = requestAnimationFrame(draw);
      } else if (headNow !== targetHead || limNow !== targetLim || capNow !== capTarget) {
        headNow = targetHead; limNow = targetLim; capNow = capTarget;  // snap, then render once exactly
        frame = requestAnimationFrame(draw);
      }
    }

    slider.addEventListener('input', draw);
    radSlider.addEventListener('input', draw);
    convSel.addEventListener('change', draw);
    draw();

    return () => {
      cancelAnimationFrame(frame);
      slider.removeEventListener('input', draw);
      radSlider.removeEventListener('input', draw);
      convSel.removeEventListener('change', draw);
    };
  }, []);

  return (
    <div className="animate-fade-up">
      <header className="mb-8 border-b border-neutral-300 pb-6">
        <h2 className="text-4xl font-semibold leading-tight tracking-tight">
          How A Car&apos;s Blind Spot Forms
        </h2>
      </header>

      <div className="prose prose-neutral mb-6 max-w-none">
        <p>
          I got my driver&apos;s license not long ago and didn't quite understand
          why blind spots exist. That's why I built this interactive figure to show how
          a car&apos;s blind spot forms, and how the mirror&apos;s convex
          curvature and angle change its width.
        </p>
      </div>

      <canvas
        ref={canvasRef}
        width="900"
        height="660"
        className="block h-auto w-full rounded-lg border border-neutral-300 bg-neutral-200"
      />

      {/* Each control sits in a row beside the value it sets, so the link
          between a slider and its number reads at a glance. */}
      <div className="mt-6 grid grid-cols-[max-content_1fr_max-content] items-center gap-x-4 gap-y-4">
        <label htmlFor="ang" className="text-sm font-medium text-neutral-700">
          Mirror angle
        </label>
        <input
          ref={angRef}
          id="ang"
          type="range"
          min="25"
          max="35"
          step="0.1"
          defaultValue="28"
          className="h-1.5 w-full cursor-pointer accent-sky-500"
        />
        <span ref={angOutRef} className={READOUT} />

        <label htmlFor="rad" className="text-sm font-medium text-neutral-700">
          Mirror radius
        </label>
        <input
          ref={radRef}
          id="rad"
          type="range"
          min="0.889"
          max="1.651"
          step="0.01"
          defaultValue="1.01"
          className="h-1.5 w-full cursor-pointer accent-sky-500"
        />
        <span ref={radOutRef} className={READOUT} />

        <label htmlFor="conv" className="text-sm font-medium text-neutral-700">
          Peripheral vision
        </label>
        <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <select
            ref={convRef}
            id="conv"
            defaultValue="eyesonly"
            className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-sm text-neutral-700 transition-colors focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <option value="eyesonly">Glance with no head turn (118°)</option>
            <option value="glance">Glance with a head turn (130°)</option>
          </select>
          {/* Computed outcomes of the inputs above, pushed to the right. */}
          <span ref={fovOutRef} className={`${READOUT} ml-auto`} />
          <span
            ref={gapOutRef}
            className="rounded-md bg-sky-50 px-2.5 py-1 text-xs font-medium tabular-nums text-sky-700"
          />
        </div>
      </div>

      <div className="prose prose-neutral mt-6 max-w-none">
        <p>
          The scene is drawn top-down and to scale: a 4.6 × 1.8 m car, a
          16 cm-wide passenger mirror, and rays traced under the law of
          reflection.
        </p>
        <p>
          The passenger mirror is a section of a sphere, and the
          radius slider sets its curvature. The radius is bounded between
          0.889 and 1.651 m, the range permitted for factory passenger-side
          mirrors under FMVSS 111.
        </p>
        <p>
          The peripheral vision setting
          selects how far to the side the driver can see, measured from straight
          ahead. Glance with no head turn (118°) is approximate. Glance with a head turn (130°) follows the SAE
          950601 blind-zone convention, about 40° rearward of the lateral axis.
        </p>
        <p>
          The blind spot is the wedge between the limit of peripheral vision and the
          near edge of the mirror's coverage. The width reported above follows
          the SAE method: the angle subtended at the mirror between where peripheral
          vision and the mirror's coverage each reach the centre of the adjacent
          lane.
        </p>
      </div>
    </div>
  );
}
