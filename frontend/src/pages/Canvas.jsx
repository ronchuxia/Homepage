import { Link, useLocation } from 'react-router-dom';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { canvases } from '../canvases';

// Sidebar icons, keyed by each canvas's `icon` field (falls back to a generic
// canvas glyph). Add a new `case` when introducing a new icon name.
function CanvasIcon({ name, className }) {
  if (name === 'car') {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={className}
      >
        <path d="M5 11l1.6-3.6A2 2 0 0 1 8.4 6h7.2a2 2 0 0 1 1.8 1.1L19 11" />
        <path d="M3.5 11h17v4a1 1 0 0 1-1 1h-16a1 1 0 0 1-1-1v-4Z" />
        <circle cx="7.5" cy="16" r="1.4" />
        <circle cx="16.5" cy="16" r="1.4" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M3 8h14M8 3v14" />
    </svg>
  );
}

function getRouteSlug(pathname) {
  const prefix = '/canvas/';

  if (!pathname.startsWith(prefix)) {
    return '';
  }

  return decodeURIComponent(pathname.slice(prefix.length).replace(/\/$/, ''));
}

export default function Canvas() {
  const location = useLocation();
  const routeSlug = useMemo(
    () => getRouteSlug(location.pathname),
    [location.pathname],
  );

  const selectedCanvas = useMemo(() => {
    if (!canvases.length) {
      return null;
    }

    const fromRoute = canvases.find((canvas) => canvas.slug === routeSlug);

    if (fromRoute || routeSlug) {
      return fromRoute || null;
    }

    return canvases[0];
  }, [routeSlug]);

  const SelectedComponent = selectedCanvas?.Component;

  const navRef = useRef(null);
  const pillRef = useRef(null);
  const linkRefs = useRef([]);
  const prevSlugRef = useRef(null);

  // Slide a single highlight to sit behind the selected canvas. The flat list
  // never reflows, so a plain CSS transition is enough (snap on first paint).
  useLayoutEffect(() => {
    const nav = navRef.current;
    const pill = pillRef.current;
    if (!nav || !pill) {
      return undefined;
    }

    const slug = selectedCanvas?.slug;

    const place = (withTransition) => {
      const index = canvases.findIndex((canvas) => canvas.slug === slug);
      const el = linkRefs.current[index];

      if (!el) {
        pill.style.opacity = '0';
        return;
      }

      const navRect = nav.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      pill.style.transition = withTransition
        ? 'top 300ms ease-out, height 300ms ease-out, opacity 200ms ease-out'
        : 'none';
      pill.style.opacity = '1';
      pill.style.top = `${rect.top - navRect.top}px`;
      pill.style.height = `${rect.height}px`;
    };

    const firstPlacement = prevSlugRef.current === null;
    prevSlugRef.current = slug;
    place(!firstPlacement);

    const onResize = () => place(false);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selectedCanvas?.slug]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f7f7f4] text-neutral-950">
      <section className="mx-auto grid max-w-7xl gap-8 px-6 py-10 sm:px-10 lg:grid-cols-[18rem_1fr] lg:px-12">
        <aside className="border-b border-neutral-300 pb-6 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-8">
          <h1 className="mb-7 text-3xl font-semibold leading-tight tracking-tight">
            Canvas
          </h1>

          <nav ref={navRef} aria-label="Canvases" className="relative">
            <div
              ref={pillRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 rounded-md bg-sky-50"
              style={{ opacity: 0 }}
            />
            <ul className="relative">
              {canvases.map((canvas, index) => {
                const isSelected = selectedCanvas?.slug === canvas.slug;

                return (
                  <li key={canvas.slug}>
                    <Link
                      ref={(el) => (linkRefs.current[index] = el)}
                      to={`/canvas/${canvas.slug}`}
                      className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                        isSelected
                          ? 'font-medium text-sky-700'
                          : 'text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-950'
                      }`}
                    >
                      <CanvasIcon
                        name={canvas.icon}
                        className={`h-4 w-4 shrink-0 ${
                          isSelected ? 'text-sky-500' : 'text-neutral-400'
                        }`}
                      />
                      <span className="truncate">{canvas.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <section className="min-w-0">
          {SelectedComponent ? (
            <SelectedComponent />
          ) : (
            <p className="text-sm text-neutral-500">
              Canvas not found.
            </p>
          )}
        </section>
      </section>
    </main>
  );
}
