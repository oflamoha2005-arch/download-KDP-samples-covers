/**
 * KDP Samples Exporter — amazon_page.js
 * Version 7.1.0
 * 
 * Injected into Amazon product pages and read.amazon.com preview iframes.
 * Provides:
 *  - Floating toolbar with live page counter & range selector
 *  - Smooth Auto-scroll to trigger lazy loading of all preview pages
 *  - Direct Export to Merged PDF (via jsPDF)
 *  - Direct Export to PNG ZIP (via built-in zero-dependency SimpleZip)
 *  - Full communication with popup and parent/child frames
 */

(function () {
  'use strict';

  const WIDGET_ID    = 'kdp-export-widget';
  const TOAST_ID     = 'kdp-toast';
  const SEL_RENDERER = '#renderer-container';

  // ── Helpers ───────────────────────────────────────────────
  const delay = ms => new Promise(r => setTimeout(r, ms));

  let _toastTimer = null;
  function showToast(msg) {
    let t = document.getElementById(TOAST_ID);
    if (!t) {
      t = document.createElement('div');
      t.id = TOAST_ID;
      t.style.cssText = [
        'position:fixed', 'bottom:28px', 'left:50%',
        'transform:translateX(-50%) translateY(60px)',
        'z-index:2147483647', 'padding:12px 24px',
        'border-radius:32px', 'opacity:0',
        'background:linear-gradient(135deg,#0f172a,#1e293b)',
        'color:#f8fafc', 'font:600 13px/-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
        'box-shadow:0 10px 30px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.1)',
        'transition:transform .35s cubic-bezier(.34,1.56,.64,1),opacity .35s',
        'pointer-events:none', 'white-space:nowrap',
      ].join(';');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateX(-50%) translateY(0)';
    });
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(60px)';
    }, 4000);
  }

  // ── Zero-dependency Pure JS ZIP Creator ───────────────────
  class SimpleZip {
    constructor() {
      this.files = [];
    }

    addFile(filename, uint8Array) {
      this.files.push({
        name: filename,
        data: uint8Array,
        crc: SimpleZip.crc32(uint8Array)
      });
    }

    generateBlob() {
      const encoder = new TextEncoder();
      const fileEntries = [];
      let offset = 0;

      for (const file of this.files) {
        const nameBytes = encoder.encode(file.name);
        const localHeaderOffset = offset;
        
        const localHeader = new Uint8Array(30 + nameBytes.length);
        const view = new DataView(localHeader.buffer);
        
        view.setUint32(0, 0x04034b50, true); // Local file header signature
        view.setUint16(4, 20, true);         // Version needed: 2.0
        view.setUint16(6, 0, true);          // General purpose bit flag
        view.setUint16(8, 0, true);          // Compression method: 0 (STORE)
        view.setUint16(10, 0, true);         // Last mod time
        view.setUint16(12, 0, true);         // Last mod date
        view.setUint32(14, file.crc, true);  // CRC-32
        view.setUint32(18, file.data.length, true); // Compressed size
        view.setUint32(22, file.data.length, true); // Uncompressed size
        view.setUint16(26, nameBytes.length, true); // Filename length
        view.setUint16(28, 0, true);         // Extra field length
        localHeader.set(nameBytes, 30);
        
        offset += localHeader.length + file.data.length;
        
        fileEntries.push({
          file,
          nameBytes,
          localHeader,
          localHeaderOffset
        });
      }

      const centralDirOffset = offset;
      const centralDirParts = [];
      let centralDirSize = 0;

      for (const entry of fileEntries) {
        const cd = new Uint8Array(46 + entry.nameBytes.length);
        const view = new DataView(cd.buffer);
        
        view.setUint32(0, 0x02014b50, true); // Central directory signature
        view.setUint16(4, 20, true);         // Version made by: 2.0
        view.setUint16(6, 20, true);         // Version needed: 2.0
        view.setUint16(8, 0, true);          // Bit flag
        view.setUint16(10, 0, true);         // Compression: 0 (STORE)
        view.setUint16(12, 0, true);         // Last mod time
        view.setUint16(14, 0, true);         // Last mod date
        view.setUint32(16, entry.file.crc, true); // CRC-32
        view.setUint32(20, entry.file.data.length, true); // Compressed size
        view.setUint32(24, entry.file.data.length, true); // Uncompressed size
        view.setUint16(28, entry.nameBytes.length, true); // Filename length
        view.setUint16(30, 0, true);         // Extra field length
        view.setUint16(32, 0, true);         // File comment length
        view.setUint16(34, 0, true);         // Disk number start
        view.setUint16(36, 0, true);         // Internal file attributes
        view.setUint32(38, 0, true);         // External file attributes
        view.setUint32(42, entry.localHeaderOffset, true); // Offset of local header
        cd.set(entry.nameBytes, 46);

        centralDirParts.push(cd);
        centralDirSize += cd.length;
      }

      // End of central directory record (EOCD)
      const eocd = new Uint8Array(22);
      const eocdView = new DataView(eocd.buffer);
      eocdView.setUint32(0, 0x06054b50, true); // EOCD signature
      eocdView.setUint16(4, 0, true);          // Number of this disk
      eocdView.setUint16(6, 0, true);          // Disk with central dir
      eocdView.setUint16(8, this.files.length, true);  // Number of central directory records
      eocdView.setUint16(10, this.files.length, true); // Total central directory records
      eocdView.setUint32(12, centralDirSize, true);    // Size of central directory
      eocdView.setUint32(16, centralDirOffset, true);  // Offset of central directory
      eocdView.setUint16(20, 0, true);                 // Comment length

      // Assemble final byte buffer
      const totalSize = offset + centralDirSize + 22;
      const finalBuffer = new Uint8Array(totalSize);
      let p = 0;
      for (const entry of fileEntries) {
        finalBuffer.set(entry.localHeader, p);
        p += entry.localHeader.length;
        finalBuffer.set(entry.file.data, p);
        p += entry.file.data.length;
      }
      for (const cd of centralDirParts) {
        finalBuffer.set(cd, p);
        p += cd.length;
      }
      finalBuffer.set(eocd, p);

      return new Blob([finalBuffer], { type: 'application/zip' });
    }

    static crc32(uint8Array) {
      if (!SimpleZip.table) {
        const table = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
          let c = i;
          for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
          }
          table[i] = c;
        }
        SimpleZip.table = table;
      }
      let crc = 0 ^ (-1);
      const table = SimpleZip.table;
      for (let i = 0; i < uint8Array.length; i++) {
        crc = (crc >>> 8) ^ table[(crc ^ uint8Array[i]) & 0xff];
      }
      return (crc ^ (-1)) >>> 0;
    }
  }

  // ── Bulletproof File Downloader ───────────────────────────
  function sanitizeForWindows(filename, defaultExt = 'pdf') {
    let clean = (filename || 'Amazon_Book_Sample')
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    const ext = clean.endsWith('.zip') ? '.zip' : (clean.endsWith('.pdf') ? '.pdf' : `.${defaultExt}`);
    const base = clean.replace(/\.(pdf|zip)$/i, '').slice(0, 75).trim() || 'Amazon_Book_Sample';
    return `${base}${ext}`;
  }

  function showDownloadPrompt(url, filename) {
    let p = document.getElementById('kdp-download-prompt');
    if (!p) {
      p = document.createElement('div');
      p.id = 'kdp-download-prompt';
      p.style.cssText = [
        'position:fixed', 'bottom:25px', 'left:50%',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'padding:12px 24px',
        'border-radius:30px',
        'background:linear-gradient(135deg, #10b981, #059669)',
        'color:#ffffff',
        'font:700 13px/-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif',
        'box-shadow:0 10px 30px rgba(16,185,129,0.5), 0 0 0 1px rgba(255,255,255,0.25)',
        'display:flex', 'align-items:center', 'gap:10px',
        'cursor:pointer',
        'transition:transform .2s ease, filter .2s ease',
        'user-select:none'
      ].join(';');
      document.body.appendChild(p);
    }

    p.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      <span>⬇️ Click to Save to PC: ${filename}</span>
    `;

    p.onclick = () => {
      p.innerHTML = `<span>⏳ Saving file to PC…</span>`;
      
      // 1. Chrome extension background download
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD',
          url: url,
          filename: filename
        }, (resp) => {
          if (resp && resp.downloadId) {
            p.innerHTML = `<span>✅ Downloaded! Check Downloads folder.</span>`;
            setTimeout(() => { p.remove(); }, 3500);
          } else {
            // Also delegate to top window
            if (window.self !== window.top) {
              window.top.postMessage({
                type: 'KDP_TRIGGER_TOP_DOWNLOAD',
                dataUrl: url,
                filename: filename
              }, '*');
            }
            p.innerHTML = `<span>✅ Download started!</span>`;
            setTimeout(() => { p.remove(); }, 3500);
          }
        });
      } else {
        if (window.self !== window.top) {
          window.top.postMessage({
            type: 'KDP_TRIGGER_TOP_DOWNLOAD',
            dataUrl: url,
            filename: filename
          }, '*');
        }
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        p.innerHTML = `<span>✅ Downloaded!</span>`;
        setTimeout(() => { p.remove(); }, 3500);
      }
    };

    setTimeout(() => {
      if (p && p.parentNode) p.remove();
    }, 45000);
  }

  async function downloadBlob(blob, filename) {
    const cleanName = sanitizeForWindows(filename, blob.type && blob.type.includes('zip') ? 'zip' : 'pdf');
    showToast(`⏳ Saving file: ${cleanName}…`);

    let dataUrl = null;
    try {
      dataUrl = await blobToDataUrl(blob);
    } catch (err) {
      console.warn('[KDP] blobToDataUrl error:', err);
    }

    let downloadSuccess = false;

    // 1. PRIMARY: Native Chrome Downloads API via Service Worker
    if (dataUrl && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const resp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD',
            url: dataUrl,
            filename: cleanName
          }, (r) => {
            if (chrome.runtime.lastError) {
              resolve({ error: chrome.runtime.lastError.message });
            } else {
              resolve(r || {});
            }
          });
        });

        if (resp && resp.downloadId) {
          downloadSuccess = true;
          const finalName = resp.filename || cleanName;
          console.log('[KDP] Download successful via chrome.downloads! ID:', resp.downloadId);
          showToast(`✅ Saved to Downloads: ${finalName}!`, 6000);
          const prompt = document.getElementById('kdp-download-prompt');
          if (prompt) prompt.remove();
          return true;
        } else if (resp && resp.error) {
          console.warn('[KDP] chrome.downloads error:', resp.error);
        }
      } catch (err) {
        console.warn('[KDP] Background download message failed:', err);
      }
    }

    // 2. SECONDARY: Ask top frame (amazon.com) to trigger download (never blocked by iframe restrictions!)
    if (window.self !== window.top && dataUrl) {
      try {
        window.top.postMessage({
          type: 'KDP_TRIGGER_TOP_DOWNLOAD',
          dataUrl: dataUrl,
          filename: cleanName
        }, '*');
        console.log('[KDP] Download delegated to top window.');
        downloadSuccess = true;
        showToast(`✅ Download initiated in main window: ${cleanName}`);
      } catch (err) {
        console.warn('[KDP] postMessage to top failed:', err);
      }
    }

    // 3. TERTIARY: Standard <a download> click in top window / same context
    try {
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = cleanName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(blobUrl);
      }, 3000);
    } catch (err) {
      console.warn('[KDP] <a> click failed:', err);
    }

    // 4. FALLBACK: Show interactive prompt only if native download didn't confirm
    if (!downloadSuccess) {
      showDownloadPrompt(dataUrl || URL.createObjectURL(blob), cleanName);
    }

    return downloadSuccess;
  }

  function dataUrlToUint8Array(dataUrl) {
    const base64 = dataUrl.split(',')[1];
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── Sample Pages Collection (Inside Book Sample ONLY) ─────
  function getSamplePages() {
    const isInsideReader = window.location.hostname === 'read.amazon.com';

    let container = null;
    if (isInsideReader) {
      // Inside Kindle Cloud Reader iframe / tab
      container = document.querySelector(SEL_RENDERER) ||
                  document.querySelector('.a-m-us-scroller') ||
                  document.querySelector('#kindleReader_page_container') ||
                  document.querySelector('#viewer-container') ||
                  document.body;
    } else {
      // In the top-level Amazon.com shopping page.
      // ONLY search inside actual reader preview containers!
      container = document.querySelector(SEL_RENDERER) ||
                  document.querySelector('.a-m-us-scroller') ||
                  document.querySelector('#kindleReader_page_container') ||
                  document.querySelector('#viewer-container') ||
                  document.querySelector('.sample-reader-container') ||
                  document.querySelector('#litb-container');

      // CRITICAL: If no reader container exists on amazon.com, return EMPTY!
      // NEVER scrape document.body on Amazon shopping pages (prevents ads/faucets/lamps).
      if (!container) {
        return [];
      }
    }

    const seen = new Set();
    const items = [];

    // 1. Collect all preview page images inside the reader container
    container.querySelectorAll('img').forEach(img => {
      const src = (img.src || img.dataset.src || '').trim();
      if (!src || src.startsWith('data:') || seen.has(src)) return;

      const w = img.naturalWidth || img.offsetWidth || img.width;
      const h = img.naturalHeight || img.offsetHeight || img.height;

      // Book sample pages are large (>200px)
      if (w > 0 && h > 0 && (w < 200 || h < 200)) return;

      const lower = src.toLowerCase();
      if (
        lower.includes('logo') ||
        lower.includes('icon') ||
        lower.includes('sprite') ||
        lower.includes('spinner') ||
        lower.includes('pixel') ||
        lower.includes('transparent') ||
        lower.includes('rating') ||
        lower.includes('badge') ||
        lower.includes('button') ||
        lower.includes('advertisement') ||
        lower.includes('sponsored')
      ) return;

      seen.add(src);
      items.push({ src, el: img, type: 'img' });
    });

    // 2. Also collect <canvas> elements if reader renders to canvas
    container.querySelectorAll('canvas').forEach(cvs => {
      const w = cvs.width || cvs.offsetWidth;
      const h = cvs.height || cvs.offsetHeight;
      if (w < 200 || h < 200) return;

      const key = `canvas_${cvs.offsetLeft}_${cvs.offsetTop}_${w}_${h}`;
      if (seen.has(key)) return;
      seen.add(key);

      try {
        const dataUrl = cvs.toDataURL('image/jpeg', 0.95);
        if (dataUrl && dataUrl.length > 500) {
          items.push({ src: dataUrl, el: cvs, type: 'canvas' });
        }
      } catch (_) {}
    });

    // Sort top to bottom based on physical position in page (reading order)
    return items.sort((a, b) => {
      const ay = a.el.getBoundingClientRect().top + window.scrollY;
      const by = b.el.getBoundingClientRect().top + window.scrollY;
      return ay - by;
    });
  }

  function getPageImages() {
    return getSamplePages();
  }

  // ── Book Covers Collection (High-Res Listing Covers ONLY) ──
  function getBookCovers() {
    const covers = [];
    const seen = new Set();

    // 1. First: Find the primary Book Front Cover
    const mainCoverSelectors = [
      '#landingImage',
      '#imgBlkFront',
      '#ebooksImgBlkFront',
      '#main-image-container img',
      '#ebooks-fullscreen-img-blk',
      '#main-image',
      '.frontImage'
    ];

    let frontCoverFound = false;

    for (const sel of mainCoverSelectors) {
      const img = document.querySelector(sel);
      if (img) {
        // Exclude if inside ads, recommendations, or customer carousels
        if (img.closest('[id*="sponsored" i], [class*="sponsored" i], [id*="sims" i], [id*="carousel" i]:not(#imageBlock *)')) {
          continue;
        }

        // Try extracting highest resolution from data-a-dynamic-image
        const dyn = img.getAttribute('data-a-dynamic-image');
        if (dyn) {
          try {
            const parsed = JSON.parse(dyn);
            const sorted = Object.entries(parsed).sort((a, b) => (b[1][0] * b[1][1]) - (a[1][0] * a[1][1]));
            for (const [url] of sorted) {
              if (!seen.has(url)) {
                seen.add(url);
                covers.push({ src: url, el: img, label: 'Front Cover (Full HD)' });
                frontCoverFound = true;
                break;
              }
            }
          } catch (_) {}
        }

        if (!frontCoverFound && img.src && !seen.has(img.src)) {
          // Clean Amazon thumbnail tags (e.g. ._SX300_.) to fetch original publisher asset
          const fullRes = img.src.replace(/\._[A-Z0-9_,]+_\./i, '.');
          seen.add(fullRes);
          covers.push({ src: fullRes, el: img, label: 'Front Cover' });
          frontCoverFound = true;
        }

        if (frontCoverFound) break;
      }
    }

    // 2. Official Gallery thumbnails (Back cover, inside look) STRICTLY inside #imageBlock or #altImages
    // We NEVER query .imageThumbnail globally across document to prevent scraping faucets, lamps, ads, recommendations!
    const galleryContainer = document.querySelector('#imageBlock #altImages, #altImages, #booksImageBlock #altImages');
    if (galleryContainer) {
      const thumbs = galleryContainer.querySelectorAll('li:not(.video) img, .a-button-thumbnail img');
      thumbs.forEach((thumb) => {
        // Security check: must NOT be an ad or recommendation
        if (thumb.closest('[id*="sponsored" i], [class*="sponsored" i], [id*="sims" i], [id*="rhf" i]')) {
          return;
        }

        let src = thumb.src || thumb.getAttribute('data-src') || '';
        if (!src || src.startsWith('data:')) return;

        const lower = src.toLowerCase();
        if (lower.includes('icon') || lower.includes('play-button') || lower.includes('sprite') || lower.includes('video')) {
          return;
        }

        // Transform thumbnail URL into full original resolution
        // e.g. https://m.media-amazon.com/images/I/71xyz._AC_US40_.jpg -> https://m.media-amazon.com/images/I/71xyz.jpg
        const highRes = src.replace(/\._[A-Z0-9_,]+_\./i, '.');

        if (!seen.has(highRes) && !seen.has(src)) {
          seen.add(highRes);
          seen.add(src);
          const isSecond = covers.length === 1;
          const label = isSecond ? 'Back Cover' : `Book Image ${covers.length + 1}`;
          covers.push({ src: highRes, el: thumb, label });
        }
      });
    }

    // A book only ever has 1 to 3 real covers (Front, Back, and maybe spine/interior).
    // Limit to maximum 3 covers to guarantee 100% purity with zero accidental ad inclusions.
    return covers.slice(0, 3);
  }

  // ── Bulletproof Image Extraction (Canvas + Page Fetch + Background) ──
  async function getExportableImage({ src, el }) {
    // 1. Direct Canvas extraction from DOM image element (fastest, works with blob: URLs!)
    if (el && (el.naturalWidth || el.offsetWidth || el.complete)) {
      try {
        const w = el.naturalWidth || el.offsetWidth || 800;
        const h = el.naturalHeight || el.offsetHeight || 1200;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(el, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
        if (dataUrl && dataUrl.length > 200) {
          const buffer = dataUrlToUint8Array(dataUrl);
          return {
            dataUrl,
            buffer,
            mimeType: 'image/jpeg',
            width: w,
            height: h
          };
        }
      } catch (canvasErr) {
        // Canvas might be tainted if external image without CORS headers; fall through
      }
    }

    // 2. Direct fetch in page context (plain fetch handles blob: and same-origin URLs)
    try {
      const resp = await fetch(src);
      if (resp.ok) {
        const blob = await resp.blob();
        const buffer = new Uint8Array(await blob.arrayBuffer());
        const dataUrl = await blobToDataUrl(blob);
        const mime = blob.type || (src.includes('.png') ? 'image/png' : 'image/jpeg');
        return {
          dataUrl,
          buffer,
          mimeType: mime,
          width: el?.naturalWidth || el?.offsetWidth || 800,
          height: el?.naturalHeight || el?.offsetHeight || 1200
        };
      }
    } catch (fetchErr) {
      // Fall through to background fetch
    }

    // 3. Background service worker fetch (bypasses CORS for external Amazon CDN domains)
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'FETCH_IMAGE', url: src }, (resp) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (resp && resp.error) {
          return reject(new Error(resp.error));
        }
        if (resp && resp.dataUrl) {
          const buffer = dataUrlToUint8Array(resp.dataUrl);
          resolve({
            dataUrl: resp.dataUrl,
            buffer,
            mimeType: resp.mimeType || 'image/jpeg',
            width: el?.naturalWidth || el?.offsetWidth || 800,
            height: el?.naturalHeight || el?.offsetHeight || 1200
          });
        } else {
          reject(new Error('Unknown error loading image'));
        }
      });
    });
  }

  // ── Smart Filename ────────────────────────────────────────
  async function getSmartFilename(ext = 'pdf') {
    return new Promise((resolve) => {
      let resolved = false;

      const onMsg = (e) => {
        if (e.data && e.data.type === 'KDP_TITLE_RESPONSE') {
          resolved = true;
          window.removeEventListener('message', onMsg);
          let t = e.data.title || 'Amazon Preview';
          resolve(sanitizeForWindows(`${t} - Sample`, ext));
        }
      };
      window.addEventListener('message', onMsg);

      try {
        window.parent.postMessage({ type: 'KDP_GET_TITLE' }, '*');
      } catch (_) {}

      let fallbackTitle = document.title || '';
      const h1 = document.querySelector('h1, #productTitle, .book-title');
      if (h1 && h1.textContent.trim()) {
        fallbackTitle = h1.textContent.trim();
      }

      setTimeout(() => {
        if (!resolved) {
          window.removeEventListener('message', onMsg);
          let clean = fallbackTitle;
          if (!clean || clean.toLowerCase().includes('amazon')) {
            clean = 'Amazon_Book_Sample';
          }
          resolve(sanitizeForWindows(clean, ext));
        }
      }, 350);
    });
  }

  // ── Auto Scroller (Smoothly triggers lazy loading) ────────
  let _isScrolling = false;
  async function doAutoScroll() {
    if (_isScrolling) return;
    _isScrolling = true;

    const btnScroll = document.getElementById('kdp-btn-scroll');
    const origText = btnScroll ? btnScroll.textContent : '⏬ Load All';
    if (btnScroll) btnScroll.textContent = '⏬ Loading…';

    showToast('⏬ Auto-scrolling to load all book preview pages…');

    const scroller = document.querySelector('.a-m-us-scroller') ||
                     document.querySelector(SEL_RENDERER) ||
                     document.scrollingElement ||
                     document.documentElement ||
                     window;

    const getH = () => (scroller.scrollHeight || document.body.scrollHeight || 0);
    const getTop = () => (scroller.scrollTop !== undefined ? scroller.scrollTop : window.scrollY);
    const setTop = (val) => {
      if (scroller.scrollTo) {
        scroller.scrollTo({ top: val, behavior: 'smooth' });
      } else {
        window.scrollTo(0, val);
      }
    };

    let prevTop = -1;
    let currentTop = getTop();
    const step = Math.max(window.innerHeight * 0.75, 450);

    while (currentTop < getH() && currentTop !== prevTop) {
      prevTop = currentTop;
      currentTop = Math.min(currentTop + step, getH());
      setTop(currentTop);

      const count = getPageImages().length;
      if (btnScroll) btnScroll.textContent = `⏬ ${count} pg…`;
      await delay(220);
    }

    // Scroll back to top
    setTop(0);
    const finalCount = getPageImages().length;
    if (btnScroll) {
      btnScroll.textContent = `✅ ${finalCount} Ready`;
      setTimeout(() => { if (btnScroll) btnScroll.textContent = origText; }, 4000);
    }
    _isScrolling = false;

    showToast(`✅ Loaded ${finalCount} pages! Starting PDF download now…`);

    // Automatically trigger PDF export so the user doesn't have to wait or guess!
    await delay(700);
    doExportPDF();
  }

  // ── PDF Export ────────────────────────────────────────────
  async function doExportPDF(sOverride, eOverride) {
    const btnPdf = document.getElementById('kdp-btn-pdf');
    const origText = btnPdf ? btnPdf.textContent : '🖨️ PDF';

    try {
      let pages = getPageImages();

      const startInput = document.getElementById('kdp-start');
      const endInput   = document.getElementById('kdp-end');
      const s = sOverride !== undefined ? sOverride : (startInput ? parseInt(startInput.value, 10) : NaN);
      const endVal = eOverride !== undefined ? eOverride : (endInput ? parseInt(endInput.value, 10) : NaN);

      let startIndex = 0;
      let endIndex = pages.length;
      if (!isNaN(s) && s >= 1) startIndex = s - 1;
      if (!isNaN(endVal) && endVal >= 1) endIndex = Math.min(endVal, pages.length);

      pages = pages.slice(startIndex, endIndex);

      if (!pages.length) {
        // If in window.top, delegate to reader iframe if present
        const readerIframe = document.querySelector('iframe[src*="read.amazon.com"], iframe#litb-canvas-click-window');
        if (readerIframe && readerIframe.contentWindow) {
          readerIframe.contentWindow.postMessage({
            type: 'KDP_EXPORT_SAMPLE',
            format: 'pdf',
            start: sOverride,
            end: eOverride
          }, '*');
          showToast('📖 Exporting sample pages from Reader…');
          return;
        }
        showToast('⚠️ No sample pages found. Open "Read sample" first.');
        return;
      }

      if (btnPdf) {
        btnPdf.textContent = '0%';
        btnPdf.style.pointerEvents = 'none';
      }
      showToast(`🖨️ Generating PDF (${pages.length} pages)…`);

      const PDFClass = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!PDFClass) {
        throw new Error('jsPDF library not available. Please refresh the page.');
      }

      let pdf = null;
      let done = 0;

      for (let i = 0; i < pages.length; i++) {
        const { src, el } = pages[i];
        const pct = Math.round((done / pages.length) * 92);
        if (btnPdf) btnPdf.textContent = pct + '%';

        try {
          const imgData = await getExportableImage(pages[i]);
          let dataUrl = imgData.dataUrl;
          if (!dataUrl) {
            const blob = new Blob([imgData.buffer], { type: imgData.mimeType });
            dataUrl = await blobToDataUrl(blob);
          }

          const pw = (el && (el.naturalWidth || el.offsetWidth)) || 794;
          const ph = (el && (el.naturalHeight || el.offsetHeight)) || 1123;
          const mw = pw * 0.2646; // px to mm (96dpi)
          const mh = ph * 0.2646;

          if (!pdf) {
            pdf = new PDFClass({
              orientation: mw >= mh ? 'landscape' : 'portrait',
              unit: 'mm',
              format: [mw, mh],
              compress: true
            });
          } else {
            pdf.addPage([mw, mh], mw >= mh ? 'landscape' : 'portrait');
          }

          const format = (imgData.mimeType && imgData.mimeType.includes('png')) ? 'PNG' : 'JPEG';
          pdf.addImage(dataUrl, format, 0, 0, mw, mh, '', 'FAST');
        } catch (err) {
          console.warn('[KDP] skip PDF page', done + 1, err.message);
        }

        done++;
        await delay(15);
      }

      if (!pdf) {
        if (btnPdf) {
          btnPdf.textContent = origText;
          btnPdf.style.pointerEvents = 'auto';
        }
        showToast('❌ Could not process any page images.');
        return;
      }

      if (btnPdf) btnPdf.textContent = 'Saving…';
      const pdfBlob = pdf.output('blob');
      const filename = await getSmartFilename('pdf');
      await downloadBlob(pdfBlob, filename);

      if (btnPdf) {
        btnPdf.textContent = '✅ Saved';
        setTimeout(() => {
          if (btnPdf) {
            btnPdf.textContent = origText;
            btnPdf.style.pointerEvents = 'auto';
          }
        }, 3000);
      }
      showToast(`✅ Saved ${done}-page PDF (${filename})! Check Downloads.`);

    } catch (err) {
      console.error('[KDP] Error in doExportPDF:', err);
      if (btnPdf) {
        btnPdf.textContent = origText;
        btnPdf.style.pointerEvents = 'auto';
      }
      showToast('❌ PDF export failed: ' + err.message);
    }
  }

  // ── PNG ZIP Export ────────────────────────────────────────
  async function doExportZIP(sOverride, eOverride) {
    const btnZip = document.getElementById('kdp-btn-zip');
    const origText = btnZip ? btnZip.textContent : '📦 PNG ZIP';

    try {
      let pages = getPageImages();

      const startInput = document.getElementById('kdp-start');
      const endInput   = document.getElementById('kdp-end');
      const s = sOverride !== undefined ? sOverride : (startInput ? parseInt(startInput.value, 10) : NaN);
      const endVal = eOverride !== undefined ? eOverride : (endInput ? parseInt(endInput.value, 10) : NaN);

      let startIndex = 0;
      let endIndex = pages.length;
      if (!isNaN(s) && s >= 1) startIndex = s - 1;
      if (!isNaN(endVal) && endVal >= 1) endIndex = Math.min(endVal, pages.length);

      pages = pages.slice(startIndex, endIndex);

      if (!pages.length) {
        // If in window.top, delegate to reader iframe if present
        const readerIframe = document.querySelector('iframe[src*="read.amazon.com"], iframe#litb-canvas-click-window');
        if (readerIframe && readerIframe.contentWindow) {
          readerIframe.contentWindow.postMessage({
            type: 'KDP_EXPORT_SAMPLE',
            format: 'pdf',
            start: sOverride,
            end: eOverride
          }, '*');
          showToast('📖 Exporting sample pages from Reader…');
          return;
        }
        showToast('⚠️ No sample pages found. Open "Read sample" first.');
        return;
      }

      if (btnZip) {
        btnZip.textContent = '0%';
        btnZip.style.pointerEvents = 'none';
      }
      showToast(`📦 Packaging ${pages.length} PNGs into ZIP…`);

      const zip = new SimpleZip();
      let done = 0;

      for (let i = 0; i < pages.length; i++) {
        const { src } = pages[i];
        const pct = Math.round((done / pages.length) * 92);
        if (btnZip) btnZip.textContent = pct + '%';

        try {
          const imgData = await getExportableImage(pages[i]);
          const ext = (imgData.mimeType && imgData.mimeType.includes('png')) ? 'png' : 'jpg';
          const pageNum = String(startIndex + i + 1).padStart(3, '0');
          zip.addFile(`page-${pageNum}.${ext}`, imgData.buffer);
        } catch (err) {
          console.warn('[KDP] skip ZIP page', done + 1, err.message);
        }

        done++;
        await delay(15);
      }

      if (btnZip) btnZip.textContent = 'Saving…';
      const zipBlob = zip.generateBlob();
      const filename = await getSmartFilename('zip');
      await downloadBlob(zipBlob, filename);

      if (btnZip) {
        btnZip.textContent = '✅ Saved';
        setTimeout(() => {
          if (btnZip) {
            btnZip.textContent = origText;
            btnZip.style.pointerEvents = 'auto';
          }
        }, 3000);
      }
      showToast(`✅ Saved ${done} images into ${filename}! Check Downloads.`);

    } catch (err) {
      console.error('[KDP] Error in doExportZIP:', err);
      if (btnZip) {
        btnZip.textContent = origText;
        btnZip.style.pointerEvents = 'auto';
      }
      showToast('❌ ZIP export failed: ' + err.message);
    }
  }

  // ── Book Covers Export (Front/Back/Gallery) ───────────────
  async function doExportCovers(format = 'zip') {
    const btnCovers = document.getElementById('kdp-btn-covers');
    const origText = btnCovers ? btnCovers.textContent : '🖼️ Covers';

    let covers = getBookCovers();

    // If in iframe and no covers found here, ask top window (amazon.com)
    if (!covers.length && window.self !== window.top) {
      try {
        window.parent.postMessage({ type: 'KDP_DOWNLOAD_COVERS', format }, '*');
        showToast('🖼️ Requesting covers from product page…');
        return;
      } catch (_) {}
    }

    if (!covers.length) {
      showToast('⚠️ No book covers found. Open the book product page.');
      return;
    }

    if (btnCovers) {
      btnCovers.textContent = '⏳…';
      btnCovers.style.pointerEvents = 'none';
    }
    showToast(`🖼️ Downloading ${covers.length} high-resolution cover(s)…`);

    try {
      const zip = new SimpleZip();
      let done = 0;

      for (let i = 0; i < covers.length; i++) {
        try {
          const imgData = await getExportableImage(covers[i]);
          const ext = (imgData.mimeType && imgData.mimeType.includes('png')) ? 'png' : 'jpg';
          const name = i === 0 ? `01-Front-Cover-FullHD.${ext}` : (i === 1 ? `02-Back-Cover.${ext}` : `03-Cover-Alternate.${ext}`);
          zip.addFile(name, imgData.buffer);
          done++;
        } catch (e) {
          console.warn('Skip cover', e);
        }
      }

      const baseName = await getSmartFilename('zip');
      const filename = `Covers-${baseName}`;
      await downloadBlob(zip.generateBlob(), filename);

      if (btnCovers) {
        btnCovers.textContent = '✅ Saved';
        setTimeout(() => {
          if (btnCovers) {
            btnCovers.textContent = origText;
            btnCovers.style.pointerEvents = 'auto';
          }
        }, 3000);
      }
      showToast(`✅ Saved ${done} cover(s) into ${filename}! Check Downloads.`);
    } catch (err) {
      console.error('Covers export error:', err);
      if (btnCovers) {
        btnCovers.textContent = origText;
        btnCovers.style.pointerEvents = 'auto';
      }
      showToast('❌ Failed to download covers: ' + err.message);
    }
  }

  // ── Drag & Drop Floating Toolbar Helper ───────────────────
  function makeDraggable(element, handle) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      handle.style.cursor = 'grabbing';
      startX = e.clientX;
      startY = e.clientY;
      const rect = element.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      element.style.transform = 'none';
      element.style.left = initialLeft + 'px';
      element.style.top = initialTop + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxLeft = Math.max(10, window.innerWidth - element.offsetWidth - 10);
      const maxTop = Math.max(10, window.innerHeight - element.offsetHeight - 10);
      element.style.left = Math.min(Math.max(10, initialLeft + dx), maxLeft) + 'px';
      element.style.top = Math.min(Math.max(10, initialTop + dy), maxTop) + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        handle.style.cursor = 'grab';
      }
    });
  }

  // ── Floating Widget UI Injection ──────────────────────────
  function isPreviewContext() {
    // 1. Inside read.amazon.com iframe or top-level window
    if (window.location.hostname === 'read.amazon.com') {
      return true;
    }
    // 2. Has preview renderer container or scroller
    if (
      document.querySelector(SEL_RENDERER) ||
      document.querySelector('.a-m-us-scroller') ||
      document.querySelector('#litb-container') ||
      document.querySelector('.sample-reader-container') ||
      document.querySelector('#kindle-reader-container')
    ) {
      return true;
    }
    // 3. Visible reader iframe exists
    const readerIframe = document.querySelector('iframe[src*="read.amazon.com"], iframe#litb-canvas-click-window');
    if (readerIframe && (readerIframe.offsetWidth > 150 || readerIframe.offsetHeight > 150)) {
      return true;
    }
    return false;
  }

  function shouldInject() {
    if (document.getElementById(WIDGET_ID) || document.getElementById('kdp-minimized-pill')) return false;
    return isPreviewContext();
  }

  function inject() {
    if (document.getElementById(WIDGET_ID) || document.getElementById('kdp-minimized-pill')) return;
    if (!shouldInject()) return;

    console.log('[KDP Exporter] Injecting floating export toolbar…');

    // 1. Minimized Pill (small unobtrusive pill in corner)
    const pill = document.createElement('div');
    pill.id = 'kdp-minimized-pill';
    pill.innerHTML = `
      <style>
        #kdp-minimized-pill {
          position: fixed !important;
          top: 14px !important;
          right: 20px !important;
          z-index: 2147483647 !important;
          background: #1e293b !important;
          color: #f8fafc !important;
          padding: 6px 14px !important;
          border-radius: 20px !important;
          display: none;
          align-items: center !important;
          gap: 6px !important;
          cursor: pointer !important;
          box-shadow: 0 6px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.12) !important;
          font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          user-select: none !important;
          transition: transform .15s ease, filter .15s ease !important;
        }
        #kdp-minimized-pill:hover {
          transform: scale(1.06) !important;
          filter: brightness(1.2) !important;
        }
      </style>
      <span>📖</span>
      <span>Export Book</span>
    `;
    document.body.appendChild(pill);

    // 2. Main Floating Toolbar
    const widget = document.createElement('div');
    widget.id = WIDGET_ID;

    widget.innerHTML = `
      <style>
        #${WIDGET_ID} {
          position: fixed !important;
          top: 14px !important;
          left: 50% !important;
          transform: translateX(-50%) !important;
          z-index: 2147483647 !important;
          background: #1e293b !important;
          padding: 6px 12px !important;
          border-radius: 28px !important;
          display: flex !important;
          align-items: center !important;
          gap: 8px !important;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.1) !important;
          color: #f8fafc !important;
          font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif !important;
          user-select: none !important;
          backdrop-filter: blur(8px) !important;
        }
        #${WIDGET_ID} .kdp-drag-handle {
          cursor: grab !important;
          color: #64748b !important;
          font-size: 15px !important;
          padding: 2px 4px !important;
          user-select: none !important;
          display: flex !important;
          align-items: center !important;
          line-height: 1 !important;
        }
        #${WIDGET_ID} .kdp-drag-handle:hover {
          color: #cbd5e1 !important;
        }
        #${WIDGET_ID} button {
          appearance: none !important;
          border: none !important;
          padding: 5px 12px !important;
          border-radius: 18px !important;
          font-size: 12px !important;
          font-weight: 700 !important;
          cursor: pointer !important;
          display: flex !important;
          align-items: center !important;
          gap: 5px !important;
          height: 28px !important;
          transition: transform .15s ease, opacity .15s ease, filter .15s ease !important;
          white-space: nowrap !important;
        }
        #${WIDGET_ID} button:hover {
          transform: translateY(-1px) !important;
          filter: brightness(1.08) !important;
        }
        #${WIDGET_ID} button:active {
          transform: translateY(0) !important;
        }
        #${WIDGET_ID} #kdp-btn-scroll {
          background: #334155 !important;
          color: #f1f5f9 !important;
        }
        #${WIDGET_ID} #kdp-btn-pdf {
          background: linear-gradient(135deg, #ffd814, #f59e0b) !important;
          color: #0f172a !important;
          box-shadow: 0 2px 8px rgba(245,158,11,0.3) !important;
        }
        #${WIDGET_ID} #kdp-btn-zip {
          background: linear-gradient(135deg, #6366f1, #8b5cf6) !important;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(99,102,241,0.35) !important;
        }
        #${WIDGET_ID} #kdp-btn-covers {
          background: linear-gradient(135deg, #0d9488, #14b8a6) !important;
          color: #ffffff !important;
          box-shadow: 0 2px 8px rgba(13,148,136,0.35) !important;
        }
        #${WIDGET_ID} #kdp-btn-close {
          background: rgba(255,255,255,0.08) !important;
          color: #94a3b8 !important;
          padding: 0 !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          border-radius: 50% !important;
          width: 24px !important;
          height: 24px !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          margin-left: 2px !important;
        }
        #${WIDGET_ID} #kdp-btn-close:hover {
          background: #ef4444 !important;
          color: #ffffff !important;
        }
        #${WIDGET_ID} .kdp-count {
          font-size: 12px !important;
          font-weight: 600 !important;
          color: #94a3b8 !important;
          min-width: 36px !important;
          text-align: center !important;
        }
        #${WIDGET_ID} .kdp-range {
          display: flex !important;
          align-items: center !important;
          gap: 5px !important;
        }
        #${WIDGET_ID} input {
          width: 42px !important;
          height: 24px !important;
          padding: 0 !important;
          background: #0f172a !important;
          border: 1px solid #475569 !important;
          border-radius: 6px !important;
          color: #f8fafc !important;
          font-size: 12px !important;
          font-weight: 600 !important;
          text-align: center !important;
          outline: none !important;
        }
        #${WIDGET_ID} input:focus {
          border-color: #6366f1 !important;
          box-shadow: 0 0 0 2px rgba(99,102,241,0.3) !important;
        }
        #${WIDGET_ID} input::placeholder {
          color: #64748b !important;
        }
        #${WIDGET_ID} input::-webkit-outer-spin-button,
        #${WIDGET_ID} input::-webkit-inner-spin-button {
          -webkit-appearance: none !important;
          margin: 0 !important;
        }
      </style>
      <div class="kdp-drag-handle" id="kdp-drag-handle" title="Drag to move toolbar anywhere on screen">⠿</div>
      <button id="kdp-btn-scroll" title="Scroll down smoothly to load all preview pages">⏬ Load All</button>
      <div class="kdp-count" id="kdp-count">…</div>
      <div class="kdp-range">
        <input type="number" id="kdp-start" placeholder="1" min="1" step="1">
        <span style="color:#64748b;font-size:11px;font-weight:600;">to</span>
        <input type="number" id="kdp-end" placeholder="All" min="1" step="1">
      </div>
      <button id="kdp-btn-pdf" title="Download inside sample pages as Merged PDF">📖 Sample PDF</button>
      <button id="kdp-btn-zip" title="Download inside sample pages as PNG ZIP">📦 Sample PNG</button>
      <button id="kdp-btn-covers" title="Download high-resolution book cover(s)">🖼️ Covers</button>
      <button id="kdp-btn-close" title="Hide Toolbar (Click 📖 icon in corner to reopen)">✕</button>
    `;

    document.body.appendChild(widget);

    // Make Draggable
    const dragHandle = widget.querySelector('#kdp-drag-handle');
    makeDraggable(widget, dragHandle);

    // Close & Reopen Listeners
    const btnClose = widget.querySelector('#kdp-btn-close');
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      widget.style.display = 'none';
      pill.style.display = 'flex';
      sessionStorage.setItem('kdp_toolbar_hidden', '1');
      showToast('ℹ️ Toolbar hidden. Click "📖 Export Book" at top-right to reopen.');
    });

    pill.addEventListener('click', () => {
      pill.style.display = 'none';
      widget.style.display = 'flex';
      sessionStorage.removeItem('kdp_toolbar_hidden');
    });

    if (sessionStorage.getItem('kdp_toolbar_hidden') === '1') {
      widget.style.display = 'none';
      pill.style.display = 'flex';
    }

    // Action button event listeners
    widget.querySelector('#kdp-btn-scroll').addEventListener('click', doAutoScroll);
    widget.querySelector('#kdp-btn-pdf').addEventListener('click', () => doExportPDF());
    widget.querySelector('#kdp-btn-zip').addEventListener('click', () => doExportZIP());
    widget.querySelector('#kdp-btn-covers').addEventListener('click', () => doExportCovers());

    // Live page counter
    setInterval(() => {
      const el = document.getElementById('kdp-count');
      if (el) {
        const n = getPageImages().length;
        el.textContent = n > 0 ? `${n} pg` : '…';
        const endInput = document.getElementById('kdp-end');
        if (endInput && !endInput.value && n > 0) {
          endInput.placeholder = String(n);
        }
      }
    }, 1000);
  }

  // ── Auto-Open "Read Sample" Helper ───────────────────────
  function openAmazonSample() {
    const selectors = [
      '#readSampleButton',
      '#lookInsideBadge',
      '#litb-cover-overlay',
      '#sitbLogoStamp',
      '#litb-canvas-click-window-button',
      'a[href*="read.amazon.com"]',
      'input[value*="Read sample" i]',
      'button[name*="submit.read-sample" i]',
      '#sample-button',
      '#ebooks-instant-preview-button',
      '#instant-preview-button',
      '.sample-button',
      '#imgBlkFront',
      '#landingImage'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && (el.offsetWidth > 0 || el.offsetHeight > 0)) {
        el.click();
        showToast('📖 Opening book sample… Please wait a moment.');
        return true;
      }
    }
    showToast('⚠️ Click on the book cover or "Read sample" on the page to open.');
    return false;
  }

  // ── Expose Global APIs (Accessible via executeScript & popup) ──
  window.kdpExportPDF    = doExportPDF;
  window.kdpExportZIP    = doExportZIP;
  window.kdpExportCovers = doExportCovers;
  window.kdpAutoScroll   = doAutoScroll;
  window.kdpGetImages    = getPageImages;
  window.kdpGetCovers    = getBookCovers;
  window.kdpOpenSample   = openAmazonSample;

  // ── Messaging Listeners ───────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'KDP_OPEN_SAMPLE') {
      const opened = openAmazonSample();
      sendResponse({ opened });
      return false;
    }

    if (message.type === 'KDP_GET_STATUS') {
      const pages = getPageImages();
      const covers = getBookCovers();
      sendResponse({
        active: true,
        hasWidget: !!document.getElementById(WIDGET_ID),
        pageCount: pages.length,
        coverCount: covers.length,
        title: document.title || ''
      });
      return false;
    }

    if (message.type === 'KDP_TRIGGER_COVERS') {
      doExportCovers(message.format);
      sendResponse({ started: true });
      return false;
    }

    if (message.type === 'KDP_TOGGLE_TOOLBAR') {
      const widget = document.getElementById(WIDGET_ID);
      const pill = document.getElementById('kdp-minimized-pill');
      if (widget) {
        if (widget.style.display === 'none') {
          widget.style.display = 'flex';
          if (pill) pill.style.display = 'none';
          sessionStorage.removeItem('kdp_toolbar_hidden');
          sendResponse({ visible: true });
        } else {
          widget.style.display = 'none';
          if (pill) pill.style.display = 'flex';
          sessionStorage.setItem('kdp_toolbar_hidden', '1');
          sendResponse({ visible: false });
        }
      }
      return false;
    }

    if (message.type === 'KDP_TRIGGER_PDF') {
      doExportPDF(message.start, message.end);
      sendResponse({ started: true });
      return false;
    }

    if (message.type === 'KDP_TRIGGER_ZIP') {
      doExportZIP(message.start, message.end);
      sendResponse({ started: true });
      return false;
    }

    if (message.type === 'KDP_TRIGGER_SCROLL') {
      doAutoScroll();
      sendResponse({ started: true });
      return false;
    }
  });

  // Cross-frame message listener for book title & delegation
  window.addEventListener('message', (e) => {
    if (!e.data) return;
    if (e.data.type === 'KDP_GET_TITLE') {
      let title = document.title;
      const pt = document.querySelector('#productTitle, h1');
      if (pt) title = pt.textContent.trim();
      try {
        e.source.postMessage({ type: 'KDP_TITLE_RESPONSE', title }, '*');
      } catch (_) {}
    }
    if (e.data.type === 'KDP_TRIGGER_TOP_DOWNLOAD') {
      const { dataUrl, filename } = e.data;
      console.log('[KDP Top Frame] Triggering download from top window:', filename);
      // 1. chrome.downloads via background
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD',
          url: dataUrl,
          filename: filename
        });
      }
      // 2. Direct <a> click in TOP frame where it is never blocked
      try {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 2500);
      } catch (err) {
        console.warn('[KDP Top Frame] <a> click error:', err);
      }
    }
    if (e.data.type === 'KDP_EXPORT_SAMPLE') {
      if (e.data.format === 'pdf') {
        doExportPDF(e.data.start, e.data.end);
      } else if (e.data.format === 'zip') {
        doExportZIP(e.data.start, e.data.end);
      }
    }
    if (e.data.type === 'KDP_DOWNLOAD_COVERS') {
      doExportCovers(e.data.format);
    }
    if (e.data.type === 'KDP_LOAD_ALL') {
      doAutoScroll();
    }
  });

  // ── Polling & Boot ────────────────────────────────────────
  setInterval(() => {
    const isPreview = isPreviewContext();
    const widget = document.getElementById(WIDGET_ID);
    const pill = document.getElementById('kdp-minimized-pill');

    if (!isPreview) {
      // If we are NOT in preview (e.g. search page or home), remove widget immediately
      if (widget) widget.remove();
      if (pill) pill.remove();
      return;
    }

    if (!widget && !pill) {
      inject();
    }
  }, 1000);

  // Initial attempt
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (isPreviewContext()) inject();
    });
  } else {
    if (isPreviewContext()) inject();
  }

})();
