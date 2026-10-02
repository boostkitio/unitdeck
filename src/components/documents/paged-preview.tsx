"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The page box every document here prints on: A4, with the margins the PDF
 * renderer uses (see `@page` in globals.css). Handed to Paged.js so the
 * preview breaks where the PDF does.
 */
const PAGE_CSS = `
@page { size: A4; margin: 16mm 14mm; }
/* The keep-together rules the PDF prints with (globals.css, @media print):
   Paged.js only honours the ones it is handed. Whole sections are not kept
   together here — see .pagedjs_pages .break-inside-avoid in globals.css. */
tr, li, dl { break-inside: avoid; }
h1, h2, h3 { break-after: avoid; }
thead { display: table-header-group; }
`;

type Polisher = { destroy: () => void };
type PagedModule = {
  Previewer: new () => PreviewerInstance;
  Handler: new (...args: unknown[]) => object;
  registerHandlers: (...handlers: unknown[]) => void;
};

let headersRegistered = false;

/**
 * Repeats a table's header row on every page it runs onto, as the PDF does.
 *
 * Paged.js carries a split table onto the next page as a bare table, header
 * and all left behind — so the next page's columns lose their names and, with
 * a fixed layout that sizes columns from the first row, their widths. The
 * header is put back as the first row of the carried-over table is laid out,
 * so the page's overflow check allows for it.
 */
function registerRepeatedHeaders(paged: PagedModule) {
  if (headersRegistered) return;
  headersRegistered = true;
  class RepeatTableHeaders extends paged.Handler {
    renderNode(clone: Node, node: Node) {
      if (!(clone instanceof HTMLTableRowElement) || !(node instanceof HTMLElement)) return;
      const section = clone.parentElement;
      const table = section?.parentElement;
      if (!section || section.tagName !== "TBODY" || !table || table.tagName !== "TABLE") return;
      if (!table.hasAttribute("data-split-from") || table.querySelector(":scope > thead")) return;
      const header = node.closest("table")?.querySelector(":scope > thead");
      if (!header) return;
      const repeated = header.cloneNode(true) as HTMLElement;
      // Not the original's rows: Paged.js finds where to put content by these.
      repeated.removeAttribute("data-ref");
      repeated.querySelectorAll("[data-ref]").forEach((el) => el.removeAttribute("data-ref"));
      table.insertBefore(repeated, section);
    }
  }
  paged.registerHandlers(RepeatTableHeaders);
}
type PreviewerInstance = {
  preview: (
    content: Node,
    stylesheets: Record<string, string>[],
    renderTo: HTMLElement,
  ) => Promise<unknown>;
  polisher: Polisher;
};

/**
 * A document shown as the separate A4 pages it prints on.
 *
 * The document is rendered once, out of sight, and Paged.js flows it onto real
 * pages — breaking tables between rows, keeping sections together, repeating
 * nothing it should not — the way the PDF will. Each page is its own sheet
 * with a gap between, like a PDF viewer, instead of one long strip with lines
 * drawn where the pages might end.
 *
 * It lays out again whenever the document changes, a moment after the last
 * change, so typing into a call sheet does not re-paginate on every key.
 */
export function PagedPreview({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const source = useRef<HTMLDivElement>(null);
  const pages = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);

  useEffect(() => {
    const from = source.current;
    const to = pages.current;
    if (!from || !to) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let running = false;
    let again = false;
    // The styles Paged.js inserts for the pages on show. They stay until the
    // next layout replaces them, or the preview goes.
    let shown: Polisher | null = null;

    async function paginate() {
      if (running) {
        again = true;
        return;
      }
      running = true;
      const staging = document.createElement("div");
      try {
        const paged = (await import("pagedjs")) as PagedModule;
        registerRepeatedHeaders(paged);
        const { Previewer } = paged;
        if (cancelled || !from || !to) return;
        // Laid out off-screen, then swapped in whole, so the preview never
        // shows a half-paginated document.
        staging.style.cssText = "position:absolute;left:-100000px;top:0;";
        document.body.appendChild(staging);
        const previewer = new Previewer();
        // A copy: Paged.js marks up what it is given, and the original is
        // React's to manage.
        const copy = from.cloneNode(true) as HTMLElement;
        // The copy is the document, not the hidden holder it was rendered in.
        copy.removeAttribute("class");
        copy.removeAttribute("aria-hidden");
        const flow = (await previewer.preview(copy, [{ "unitdeck-page.css": PAGE_CSS }], staging)) as {
          pages?: { removeListeners: () => void }[];
        };
        // The layout is finished. Left listening, each page re-lays itself out
        // whenever it resizes — which moving it into view and scaling it to
        // fit both do — and fails, having nothing left to lay out.
        flow.pages?.forEach((page) => page.removeListeners());
        if (cancelled) {
          previewer.polisher.destroy();
          return;
        }
        to.replaceChildren(...Array.from(staging.childNodes));
        shown?.destroy();
        shown = previewer.polisher;
        setPageCount(to.querySelectorAll(".pagedjs_page").length);
      } catch (err) {
        // A layout that fails leaves the last good one on show.
        console.error("Could not lay the document out on pages", err);
      } finally {
        staging.remove();
        running = false;
        if (again && !cancelled) {
          again = false;
          void paginate();
        }
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void paginate(), 350);
    }

    void paginate();
    const observer = new MutationObserver(schedule);
    observer.observe(from, { subtree: true, childList: true, characterData: true, attributes: true });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (timer) clearTimeout(timer);
      shown?.destroy();
    };
  }, []);

  return (
    <div className={cn("paged-preview", className)}>
      {/* What is paginated: rendered, never seen. */}
      <div ref={source} aria-hidden className="paged-preview-source">
        {children}
      </div>
      {pageCount === null && (
        <div className="mx-auto h-[297mm] w-[210mm] animate-pulse bg-white shadow-xl" />
      )}
      <div ref={pages} />
      {pageCount !== null && (
        <p className="paged-preview-count mt-2 text-center text-xs text-muted-foreground">
          {pageCount} {pageCount === 1 ? "page" : "pages"}
        </p>
      )}
    </div>
  );
}
