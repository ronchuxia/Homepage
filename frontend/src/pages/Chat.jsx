import { useEffect, useRef } from 'react';

// Each wave: color, line width, opacity, and two sine components whose
// amplitude, wavelength, and phase all drift over time.
// fa: amplitude drift rate, fk: wavelength drift rate, fp: phase speed (rad/s)
const waves = [
  { color: '124, 122, 232', width: 2.5, alpha: 0.75, seed: 0.0, fa: 0.31, fk: 0.13, fp: 0.6 },  // blue
  { color: '140, 205, 165', width: 1.5, alpha: 0.6, seed: 2.1, fa: 0.23, fk: 0.17, fp: 0.45 },   // green
  { color: '215, 150, 170', width: 1.5, alpha: 0.55, seed: 4.3, fa: 0.41, fk: 0.1, fp: 0.7 },    // pink
  { color: '170, 170, 175', width: 1.2, alpha: 0.45, seed: 6.7, fa: 0.19, fk: 0.27, fp: 0.35 },  // gray
];

function WavyBackground() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let frame;

    function resize() {
      canvas.width = innerWidth * devicePixelRatio;
      canvas.height = innerHeight * devicePixelRatio;
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    addEventListener('resize', resize);
    resize();

    function draw(now) {
      const t = now / 1000;
      const W = innerWidth, H = innerHeight, mid = H / 2;
      ctx.clearRect(0, 0, W, H);

      for (const w of waves) {
        const s = w.seed;
        // slowly drifting parameters -> the line changes shape, not just position
        const amp = (H * 0.2) * (0.6 + 0.4 * Math.sin(t * w.fa + s));
        const k = (2 * Math.PI / W) * (1.2 + 0.4 * Math.sin(t * w.fk + s));
        const ph = t * w.fp + s;

        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = mid + amp * Math.sin(k * x + ph);
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${w.color}, ${w.alpha})`;
        ctx.lineWidth = w.width;
        ctx.shadowColor = `rgba(${w.color}, 0.6)`;
        ctx.shadowBlur = 8;
        ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    }

    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(0); // single static frame
    } else {
      frame = requestAnimationFrame(draw);
    }

    return () => {
      removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

export default function Chat() {
  return (
    <main className="relative min-h-[calc(100vh-4rem)] overflow-hidden bg-[radial-gradient(circle_at_50%_40%,#fdfdfd,#ececec)] text-neutral-950">
      <WavyBackground />
      <section className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-6xl items-center justify-center px-6 py-10 text-center sm:px-10 lg:px-12">
        <div className="animate-fade-up">
          <h1 className="animate-gradient-x bg-gradient-to-r from-indigo-500 via-sky-400 to-emerald-400 bg-[length:200%_auto] bg-clip-text pb-2 text-7xl font-semibold leading-tight tracking-tight text-transparent motion-reduce:animate-none sm:text-8xl lg:text-9xl">
            Coming Soon
          </h1>

          <div className="mt-10 inline-flex items-center gap-2.5 rounded-full border border-neutral-300/70 bg-white/60 px-4 py-1.5 text-sm font-medium text-neutral-600 backdrop-blur-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-sky-500" />
            </span>
            In progress
          </div>
        </div>
      </section>
    </main>
  );
}
