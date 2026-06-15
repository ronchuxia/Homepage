import { Link, useLocation } from 'react-router-dom';
import { useLayoutEffect, useRef, useState } from 'react';

const PORTFOLIO_URL = 'https://ronchuxia.github.io';

function ExternalIcon({ className }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
      <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
    </svg>
  );
}

export default function Navbar() {
  const location = useLocation();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isActive = (path) => {
    return (
      location.pathname === path ||
      (path === '/chat' && location.pathname === '/') ||
      location.pathname.startsWith(`${path}/`)
    );
  };

  const navLinks = [
    { path: '/chat', label: 'Chat' },
    { path: '/notes', label: 'Notes' },
    { path: '/canvas', label: 'Canvas' },
  ];

  // Sliding highlight: measure the active desktop link and move a single pill
  // to sit behind it, so the highlight glides between links on navigation.
  const linkRefs = useRef([]);
  const [pill, setPill] = useState({ left: 0, width: 0, visible: false });

  useLayoutEffect(() => {
    function reposition() {
      const activeIndex = navLinks.findIndex((link) => isActive(link.path));
      const el = linkRefs.current[activeIndex];

      if (el && el.offsetWidth) {
        setPill({ left: el.offsetLeft, width: el.offsetWidth, visible: true });
      } else {
        setPill((current) => ({ ...current, visible: false }));
      }
    }

    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [location.pathname]);

  return (
    <nav className="sticky top-0 z-50 border-b border-neutral-200 bg-white/80 backdrop-blur">
      <div className="mx-auto max-w-7xl px-6 sm:px-10 lg:px-12">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Name */}
          <Link
            to="/"
            className="text-xl font-bold tracking-tight text-neutral-900 transition-colors hover:text-sky-700"
          >
            Xia Chu
          </Link>

          {/* Desktop Navigation */}
          <div className="relative hidden md:block">
            <div
              aria-hidden="true"
              className={`absolute top-0 h-full rounded-md bg-sky-50 transition-all duration-300 ease-out ${
                pill.visible ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ left: pill.left, width: pill.width }}
            />
            <div className="relative flex space-x-5">
              {navLinks.map((link, index) => (
                <Link
                  key={link.path}
                  ref={(el) => (linkRefs.current[index] = el)}
                  to={link.path}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(link.path)
                      ? 'text-sky-700'
                      : 'text-neutral-600 hover:text-sky-700'
                  }`}
                >
                  {link.label}
                </Link>
              ))}

              <a
                href={PORTFOLIO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-neutral-600 transition-colors hover:text-sky-700"
              >
                Portfolio
                <ExternalIcon className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 rounded-md text-neutral-600 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {isMenuOpen ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Navigation */}
        {isMenuOpen && (
          <div className="md:hidden pb-4">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setIsMenuOpen(false)}
                className={`block px-3 py-2 rounded-md text-base font-medium transition-colors ${
                  isActive(link.path)
                    ? 'text-sky-700 bg-sky-50'
                    : 'text-neutral-600 hover:text-sky-700 hover:bg-neutral-100'
                }`}
              >
                {link.label}
              </Link>
            ))}

            <a
              href={PORTFOLIO_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setIsMenuOpen(false)}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-base font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-sky-700"
            >
              Portfolio
              <ExternalIcon className="h-3.5 w-3.5" />
            </a>
          </div>
        )}
      </div>
    </nav>
  );
}
