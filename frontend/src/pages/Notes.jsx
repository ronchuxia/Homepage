import { Link, useLocation } from 'react-router-dom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';

const NOTES_BASE_URL = '/notes';
const NOTES_INDEX_URL = `${NOTES_BASE_URL}/index.json`;

function getRouteSlug(pathname) {
  const prefix = '/notes/';

  if (!pathname.startsWith(prefix)) {
    return '';
  }

  return decodeURIComponent(pathname.slice(prefix.length).replace(/\/$/, ''));
}

// Whether the selected note is reachable through expanded folders (i.e. not
// hidden inside a collapsed one) — used to show/hide the sliding highlight.
function isNoteVisible(tree, slug, expandedFolders) {
  let found = false;

  function walk(nodes, ancestorsExpanded) {
    nodes.forEach((node) => {
      if (node.type === 'folder') {
        const expanded = ancestorsExpanded && expandedFolders.has(node.path);
        if (node.children) {
          walk(node.children, expanded);
        }
      } else if (node.slug === slug && ancestorsExpanded) {
        found = true;
      }
    });
  }

  walk(tree, true);
  return found;
}

// Percent-encode each path segment (note names can contain spaces and other
// URL-significant characters) while keeping the "/" separators intact.
function encodePath(notePath) {
  return notePath.split('/').map(encodeURIComponent).join('/');
}

function getNoteUrl(notePath) {
  return `${NOTES_BASE_URL}/${encodePath(notePath)}`;
}

function getAssetUrl(src, notePath) {
  if (!src || /^(https?:|data:|\/)/.test(src)) {
    return src;
  }

  const noteFolder = notePath.split('/').slice(0, -1).join('/');
  const baseUrl = `${window.location.origin}${NOTES_BASE_URL}/${encodePath(noteFolder)}/`;

  return new URL(src, baseUrl).toString();
}

function splitMarkdownHref(href) {
  const match = href.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);

  return {
    path: match?.[1] || '',
    query: match?.[2] || '',
    hash: match?.[3] || '',
  };
}

function normalizeNotePath(notePath) {
  const segments = [];

  decodeURIComponent(notePath)
    .split('/')
    .forEach((segment) => {
      if (!segment || segment === '.') {
        return;
      }

      if (segment === '..') {
        segments.pop();
        return;
      }

      segments.push(segment);
    });

  return segments.join('/');
}

function getMarkdownNoteLink(href, notePath) {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/|#|\/)/i.test(href)) {
    return null;
  }

  const { path: hrefPath, query, hash } = splitMarkdownHref(href);

  if (!hrefPath.toLowerCase().endsWith('.md')) {
    return null;
  }

  const noteFolder = notePath.split('/').slice(0, -1).join('/');
  const targetPath = normalizeNotePath(`${noteFolder}/${hrefPath}`);
  const slug = targetPath.replace(/\.md$/i, '');

  return `${NOTES_BASE_URL}/${encodePath(slug)}${query}${hash}`;
}

function hasBlankMarkdownLine(markdownLines, lineNumber) {
  const line = markdownLines[lineNumber - 1];

  return typeof line === 'string' && line.trim() === '';
}

function getCodeBlockSpacingClass(node, markdownLines) {
  const startLine = node?.position?.start?.line;
  const endLine = node?.position?.end?.line;

  if (!startLine || !endLine) {
    return '';
  }

  return [
    hasBlankMarkdownLine(markdownLines, startLine - 1)
      ? 'note-code--loose-before'
      : 'note-code--tight-before',
    hasBlankMarkdownLine(markdownLines, endLine + 1)
      ? 'note-code--loose-after'
      : 'note-code--tight-after',
  ].join(' ');
}

function TreeNode({ node, selectedSlug, expandedFolders, onToggleFolder, registerSelected }) {
  if (node.type === 'folder') {
    const isExpanded = expandedFolders.has(node.path);

    return (
      <li>
        <button
          type="button"
          onClick={() => onToggleFolder(node.path)}
          className="grid w-full grid-cols-[1.25rem_1fr] items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-neutral-700 transition-colors hover:bg-neutral-200/60 hover:text-neutral-950"
          aria-expanded={isExpanded}
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            className={`h-3 w-3 text-neutral-400 transition-transform duration-300 ease-in-out ${
              isExpanded ? 'rotate-90' : ''
            }`}
          >
            <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-4 w-4 shrink-0 text-neutral-400"
            >
              <path d="M3 5.5A1.5 1.5 0 0 1 4.5 4h3.38a1.5 1.5 0 0 1 1.06.44l.94.94a1.5 1.5 0 0 0 1.06.44h3.56A1.5 1.5 0 0 1 16 7.5v7A1.5 1.5 0 0 1 14.5 16h-10A1.5 1.5 0 0 1 3 14.5v-9Z" />
            </svg>
            <span className="truncate">{node.name}</span>
          </span>
        </button>

        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <ul className="ml-4 border-l border-neutral-300 pl-3">
              {node.children.map((child) => (
                <TreeNode
                  key={child.path}
                  node={child}
                  selectedSlug={selectedSlug}
                  expandedFolders={expandedFolders}
                  onToggleFolder={onToggleFolder}
                  registerSelected={registerSelected}
                />
              ))}
            </ul>
          </div>
        </div>
      </li>
    );
  }

  const isSelected = selectedSlug === node.slug;

  return (
    <li>
      <Link
        ref={isSelected ? registerSelected : undefined}
        to={`/notes/${node.slug}`}
        className={`relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
          isSelected
            ? 'font-medium text-sky-700'
            : 'text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-950'
        }`}
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          aria-hidden="true"
          className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-sky-500' : 'text-neutral-400'}`}
        >
          <path d="M4 2h5l3 3v9H4V2Z" strokeLinejoin="round" />
          <path d="M9 2v3h3" strokeLinejoin="round" />
        </svg>
        <span className="truncate">{node.name.replace(/\.md$/, '')}</span>
      </Link>
    </li>
  );
}

export default function Notes() {
  const location = useLocation();
  const routeSlug = useMemo(
    () => getRouteSlug(location.pathname),
    [location.pathname],
  );
  const [notesIndex, setNotesIndex] = useState(null);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [markdown, setMarkdown] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');

  const navRef = useRef(null);
  const selectedLinkRef = useRef(null);
  const pillRef = useRef(null);
  const prevSlugRef = useRef(null);
  const markdownLines = useMemo(() => markdown.split(/\r?\n/), [markdown]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadIndex() {
      try {
        setStatus('loading');
        const response = await fetch(NOTES_INDEX_URL, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to load notes index: ${response.status}`);
        }

        const data = await response.json();
        setNotesIndex(data);
        // Folders start collapsed; the user expands what they want.
        setError('');
      } catch (indexError) {
        if (indexError.name !== 'AbortError') {
          setStatus('error');
          setError(indexError.message);
        }
      }
    }

    loadIndex();

    return () => controller.abort();
  }, []);

  const selectedNote = useMemo(() => {
    if (!notesIndex?.notes?.length) {
      return null;
    }

    const noteFromRoute = notesIndex.notes.find(
      (note) => note.slug === routeSlug,
    );

    if (noteFromRoute || routeSlug) {
      return noteFromRoute || null;
    }

    return notesIndex.notes[0];
  }, [notesIndex, routeSlug]);

  useEffect(() => {
    if (!selectedNote) {
      return;
    }

    const controller = new AbortController();

    async function loadMarkdown() {
      try {
        setStatus('loading');
        const response = await fetch(getNoteUrl(selectedNote.path), {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Failed to load note: ${response.status}`);
        }

        setMarkdown(await response.text());
        setStatus('ready');
        setError('');
      } catch (markdownError) {
        if (markdownError.name !== 'AbortError') {
          setStatus('error');
          setError(markdownError.message);
        }
      }
    }

    loadMarkdown();

    return () => controller.abort();
  }, [selectedNote]);

  function toggleFolder(path) {
    setExpandedFolders((currentFolders) => {
      const nextFolders = new Set(currentFolders);

      if (nextFolders.has(path)) {
        nextFolders.delete(path);
      } else {
        nextFolders.add(path);
      }

      return nextFolders;
    });
  }

  // Slide a single highlight to sit behind the selected note. The pill is
  // driven imperatively so the two motions can differ:
  //  - selection change: glide between rows with a CSS transition;
  //  - folder expand/collapse: the rows physically move, so we track the
  //    selected row frame-by-frame (no transition) to stay in exact lockstep.
  // The full-width pill only needs a vertical position (top + height); it is
  // hidden when the selection lives inside a collapsed folder.
  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (!pill) {
      return undefined;
    }

    const slug = selectedNote?.slug;

    const measure = () => {
      const nav = navRef.current;
      const el = selectedLinkRef.current;
      const visible =
        nav &&
        el &&
        slug &&
        notesIndex &&
        isNoteVisible(notesIndex.tree, slug, expandedFolders);

      if (!visible) {
        return null;
      }

      const navRect = nav.getBoundingClientRect();
      const rect = el.getBoundingClientRect();
      return { top: rect.top - navRect.top, height: rect.height };
    };

    const place = (pos, withTransition) => {
      if (!pos) {
        pill.style.opacity = '0';
        return;
      }

      pill.style.transition = withTransition
        ? 'top 300ms ease-out, height 300ms ease-out, opacity 200ms ease-out'
        : 'none';
      pill.style.opacity = '1';
      pill.style.top = `${pos.top}px`;
      pill.style.height = `${pos.height}px`;
    };

    const slugChanged = prevSlugRef.current !== slug;
    const firstPlacement = prevSlugRef.current === null;
    prevSlugRef.current = slug;

    let raf = 0;

    if (slugChanged) {
      // Different note selected: glide between rows (snap on first paint).
      place(measure(), !firstPlacement);
    } else {
      // Folder expanded/collapsed: follow the moving row every frame so the
      // pill and the content travel together for the full ~300ms animation.
      const start = performance.now();
      const tick = (now) => {
        place(measure(), false);
        if (now - start < 340) {
          raf = requestAnimationFrame(tick);
        }
      };
      raf = requestAnimationFrame(tick);
    }

    const onResize = () => place(measure(), false);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [selectedNote?.slug, expandedFolders, notesIndex]);

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f7f7f4] text-neutral-950">
      <section className="mx-auto grid max-w-7xl gap-8 px-6 py-10 sm:px-10 lg:grid-cols-[18rem_1fr] lg:px-12">
        <aside className="border-b border-neutral-300 pb-6 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          <h1 className="mb-7 text-3xl font-semibold leading-tight tracking-tight">
            Notes
          </h1>

          {notesIndex && (
            <nav ref={navRef} aria-label="Notes folders" className="relative">
              <div
                ref={pillRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 rounded-md bg-sky-50"
                style={{ opacity: 0 }}
              />
              <ul className="relative">
                {notesIndex.tree.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    selectedSlug={selectedNote?.slug}
                    expandedFolders={expandedFolders}
                    onToggleFolder={toggleFolder}
                    registerSelected={(el) => {
                      if (el) selectedLinkRef.current = el;
                    }}
                  />
                ))}
              </ul>
            </nav>
          )}
        </aside>

        <section className="min-w-0">
          {selectedNote && (
            <header className="mb-8 border-b border-neutral-300 pb-6">
              <p className="mb-3 inline-block rounded-full bg-neutral-200/70 px-3 py-1 font-mono text-xs text-neutral-500">
                {selectedNote.path}
              </p>
              <h2 className="text-4xl font-semibold leading-tight tracking-tight">
                {selectedNote.title}
              </h2>
              {selectedNote.updated && (
                <p className="mt-3 text-sm text-neutral-500">
                  {selectedNote.updated}
                </p>
              )}
            </header>
          )}

          {status === 'error' && (
            <p className="border-l-2 border-red-700 pl-4 text-sm text-red-800">
              {error}
            </p>
          )}

          {status === 'loading' && (
            <div className="flex items-center gap-1.5 text-sm text-neutral-500">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400" />
            </div>
          )}

          {status === 'ready' && selectedNote && (
            <article
              key={selectedNote.slug}
              className="note-prose prose prose-neutral max-w-none animate-fade-up prose-headings:tracking-tight prose-li:my-[0.15em] prose-a:font-medium prose-a:text-sky-700 prose-a:no-underline hover:prose-a:underline prose-pre:rounded-lg prose-pre:border prose-pre:border-neutral-200 prose-pre:bg-neutral-950 prose-pre:text-neutral-50 prose-img:rounded-lg prose-img:border prose-img:border-neutral-200"
            >
              <ReactMarkdown
                remarkPlugins={[remarkMath]}
                rehypePlugins={[rehypeKatex, rehypeHighlight]}
                components={{
                  pre: ({ node, className = '', children, ...props }) => {
                    const spacingClass = getCodeBlockSpacingClass(
                      node,
                      markdownLines,
                    );

                    return (
                      <pre
                        className={[className, spacingClass].filter(Boolean).join(' ')}
                        {...props}
                      >
                        {children}
                      </pre>
                    );
                  },
                  img: ({ src = '', alt = '' }) => (
                    <img
                      src={getAssetUrl(src, selectedNote.path)}
                      alt={alt}
                      loading="lazy"
                    />
                  ),
                  a: (linkProps) => {
                    const props = { ...linkProps };
                    const href = props.href || '';
                    const children = props.children;

                    delete props.node;
                    delete props.href;
                    delete props.children;

                    const noteLink = getMarkdownNoteLink(href, selectedNote.path);

                    if (noteLink) {
                      return (
                        <Link to={noteLink} {...props}>
                          {children}
                        </Link>
                      );
                    }

                    return (
                      <a href={href} {...props}>
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {markdown}
              </ReactMarkdown>
            </article>
          )}
        </section>
      </section>
    </main>
  );
}
