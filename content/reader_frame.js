/**
 * KDP Samples Exporter — Reader Frame Content Script  v2
 *
 * Injected into read.amazon.com iframes.
 * JSZip and jsPDF are injected BEFORE this script via manifest content_scripts order.
 *
 * Responsibilities:
 *  1. Detect all book preview page images in DOM order (top → bottom)
 *  2. Listen for commands from the parent page (postMessage)
 *  3. Export as ZIP of PNGs  (using JSZip)
 *  4. Export as merged PDF   (using jsPDF)
 *  5. Post progress / results back to parent
 */

(function () {
  'use strict';

  /* ────────────────────────────────────────────────
     IMAGE COLLECTION
     Book pages in the Amazon reader are rendered as
     vertically stacked <img> elements. We identify
     them by being "large" (>300px wide) and having
     a recognisable CDN src pattern. We exclude tiny
     UI icons and logo images.
  ──────────────────────────────────────────────── */

  /** Minimum size a page image must have to be considered a book page */
  const MIN_W = 300;
  const MIN_H = 300;

  /**
   * Returns all book-page images sorted by their vertical position
   * in the rendered document (true reading order, top → bottom).
   * @returns {{ src: string, el: HTMLImageElement }[]}
   */
  function collectPageImages() {
    const seen = new Set();
    const items = [];

    document.querySelectorAll('img').forEach(img => {
      // Skip data-URIs and empty src
      const src = (img.src || img.dataset.src || '').trim();
      if (!src || src.startsWith('data:') || seen.has(src)) return;

      // Check rendered / natural size
      const w = img.naturalWidth  || img.offsetWidth  || img.width;
      const h = img.naturalHeight || img.offsetHeight || img.height;
      if (w < MIN_W && h < MIN_H) return;

      // Exclude known UI / decoration images
      const lower = src.toLowerCase();
      if (
        lower.includes('logo')    ||
        lower.includes('sprite')  ||
        lower.includes('button')  ||
        lower.includes('icon')    ||
        lower.includes('blank')   ||
        lower.includes('spinner')
      ) return;

      seen.add(src);
      items.push({ src, el: img });
    });

    // Sort by vertical document position (top → bottom)
    items.sort((a, b) => {
      const ay = a.el.getBoundingClientRect().top + window.scrollY;
      const by = b.el.getBoundingClientRect().top + window.scrollY;
      return ay - by;
    });

    return items;
  }

  /* ────────────────────────────────────────────────
     HELPERS
  ──────────────────────────────────────────────── */

  /** Post a message to the parent (amazon.com) page */
  function toParent(msg) {
    try { window.parent.postMessage({ source: 'kdp-reader-frame', ...msg }, '*'); }
    catch (_) {}
  }

  /** ms delay */
  const delay = ms => new Promise(r => setTimeout(r, ms));

  /**
   * Fetch an image as an ArrayBuffer, trying CORS fetch first,
   * then falling back to a canvas draw (cross-origin taint may block this).
   */
  async function fetchImageBuffer(src) {
    // ── Try fetch ──────────────────────────────────
    try {
      const resp = await fetch(src, { mode: 'cors', credentials: 'omit' });
      if (resp.ok) {
        const blob = await resp.blob();
        return { buffer: await blob.arrayBuffer(), mimeType: blob.type || 'image/jpeg', blob };
      }
    } catch (_) { /* fall through */ }

    // ── Canvas fallback ────────────────────────────
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);
        canvas.toBlob(blob => {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
          blob.arrayBuffer().then(buffer => resolve({ buffer, mimeType: 'image/png', blob }));
        }, 'image/png');
      };
      img.onerror = () => reject(new Error(`Image load failed: ${src}`));
      img.src = src;
    });
  }

  /**
   * Convert a Blob to a base64 data-URL string.
   */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror   = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Trigger a browser download from a Blob.
   */
  function downloadBlob(blob, filename) {
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* ────────────────────────────────────────────────
     EXPORT: ZIP of PNGs
  ──────────────────────────────────────────────── */

  async function exportZip() {
    const pages = collectPageImages();
    if (!pages.length) {
      toParent({ type: 'ERROR', msg: 'No book pages detected. Scroll through the preview first.' });
      return;
    }

    toParent({ type: 'PROGRESS', pct: 0, label: `Collecting ${pages.length} pages…` });

    // Wait for JSZip to be available (it's injected before this script)
    if (typeof JSZip === 'undefined') {
      toParent({ type: 'ERROR', msg: 'JSZip library not loaded. Please reload the page.' });
      return;
    }

    const zip = new JSZip();
    const folder = zip.folder('amazon-preview');

    let done = 0;
    for (const { src } of pages) {
      const pct = Math.round((done / pages.length) * 90);
      toParent({ type: 'PROGRESS', pct, label: `Loading page ${done + 1}/${pages.length}…` });

      try {
        const { blob } = await fetchImageBuffer(src);
        // Determine extension from mime type
        const ext = blob.type.includes('png') ? 'png' : 'jpg';
        const filename = `page-${String(done + 1).padStart(3, '0')}.${ext}`;
        folder.file(filename, blob);
      } catch (e) {
        console.warn('[KDP Export] Skipping page', done + 1, e.message);
      }

      done++;
      await delay(50); // brief yield to keep UI responsive
    }

    toParent({ type: 'PROGRESS', pct: 95, label: 'Compressing ZIP…' });

    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      metadata => {
        toParent({ type: 'PROGRESS', pct: 95 + Math.round(metadata.percent * 0.05), label: 'Compressing…' });
      }
    );

    downloadBlob(zipBlob, 'amazon-preview-pages.zip');
    toParent({ type: 'EXPORT_DONE', format: 'zip', count: done });
  }

  /* ────────────────────────────────────────────────
     EXPORT: Merged PDF  (jsPDF)
  ──────────────────────────────────────────────── */

  async function exportPDF() {
    const pages = collectPageImages();
    if (!pages.length) {
      toParent({ type: 'ERROR', msg: 'No book pages detected. Scroll through the preview first.' });
      return;
    }

    if (typeof window.jspdf === 'undefined' && typeof jsPDF === 'undefined') {
      toParent({ type: 'ERROR', msg: 'jsPDF library not loaded. Please reload the page.' });
      return;
    }

    // jsPDF is exposed as window.jspdf.jsPDF when loaded as UMD
    const { jsPDF: PDF } = (window.jspdf || { jsPDF });

    toParent({ type: 'PROGRESS', pct: 0, label: `Building PDF (${pages.length} pages)…` });

    let pdf = null;
    let done = 0;

    for (const { src, el } of pages) {
      const pct = Math.round((done / pages.length) * 95);
      toParent({ type: 'PROGRESS', pct, label: `Adding page ${done + 1}/${pages.length}…` });

      try {
        const { blob, mimeType } = await fetchImageBuffer(src);
        const dataUrl = await blobToDataURL(blob);

        // Get image natural dimensions
        const imgW = el.naturalWidth  || el.offsetWidth  || 595;
        const imgH = el.naturalHeight || el.offsetHeight || 842;

        // Convert px to mm (96 DPI screen → 1px = 0.2646mm)
        const mmW = imgW * 0.2646;
        const mmH = imgH * 0.2646;

        if (pdf === null) {
          // First page: create PDF with matching orientation
          pdf = new PDF({
            orientation: mmW > mmH ? 'landscape' : 'portrait',
            unit: 'mm',
            format: [mmW, mmH],
            compress: true,
          });
        } else {
          pdf.addPage([mmW, mmH], mmW > mmH ? 'landscape' : 'portrait');
        }

        // Determine image format for jsPDF
        const fmt = mimeType.includes('png') ? 'PNG' : 'JPEG';
        pdf.addImage(dataUrl, fmt, 0, 0, mmW, mmH, undefined, 'FAST');

      } catch (e) {
        console.warn('[KDP Export] Skipping PDF page', done + 1, e.message);
      }

      done++;
      await delay(50);
    }

    if (!pdf) {
      toParent({ type: 'ERROR', msg: 'Could not load any page images.' });
      return;
    }

    toParent({ type: 'PROGRESS', pct: 98, label: 'Saving PDF…' });

    const pdfBlob = pdf.output('blob');
    downloadBlob(pdfBlob, 'amazon-preview.pdf');
    toParent({ type: 'EXPORT_DONE', format: 'pdf', count: done });
  }

  /* ────────────────────────────────────────────────
     MESSAGE LISTENER (from amazon_page.js)
  ──────────────────────────────────────────────── */

  window.addEventListener('message', async (event) => {
    if (!event.data || event.data.source !== 'kdp-parent') return;

    switch (event.data.type) {
      case 'GET_PAGE_COUNT':
        toParent({ type: 'PAGE_COUNT', count: collectPageImages().length });
        break;
      case 'EXPORT_ZIP':
        await exportZip();
        break;
      case 'EXPORT_PDF':
        await exportPDF();
        break;
    }
  });

  /* ────────────────────────────────────────────────
     AUTO-REPORT PAGE COUNT
  ──────────────────────────────────────────────── */

  function reportCount() {
    toParent({ type: 'PAGE_COUNT', count: collectPageImages().length });
  }

  const mo = new MutationObserver(reportCount);
  mo.observe(document.body, { childList: true, subtree: true });

  reportCount();
  setTimeout(reportCount, 1000);
  setTimeout(reportCount, 2500);
  setTimeout(reportCount, 5000);

})();
