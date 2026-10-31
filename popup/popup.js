/**
 * KDP Samples Exporter — Popup Script v7.1.0
 * Handles direct export triggers, live page detection, and UI progress.
 */
(async function () {
  'use strict';

  const dot          = document.getElementById('sdot');
  const label        = document.getElementById('slabel');
  const badge        = document.getElementById('sbadge');
  const btnPdf       = document.getElementById('btn-export-pdf');
  const btnZip       = document.getElementById('btn-export-zip');
  const btnScroll    = document.getElementById('btn-load-all');
  const btnCovers    = document.getElementById('btn-export-covers');
  const btnSearchCovers = document.getElementById('btn-search-covers');
  const btnToggle    = document.getElementById('btn-toggle-toolbar');
  const btnOpenSample = document.getElementById('btn-open-sample');
  const demoBtnPdf   = document.getElementById('demo-btn-pdf');
  const demoBtnZip   = document.getElementById('demo-btn-zip');
  const demoTitle    = document.getElementById('demo-title');
  const inputStart   = document.getElementById('pop-start');
  const inputEnd     = document.getElementById('pop-end');
  const progressBox  = document.getElementById('progress-box');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');

  function setStatus(state, msg, badgeText) {
    dot.className = 'dot' + (state ? ` ${state}` : '');
    label.textContent = msg;
    if (badgeText !== undefined) {
      badge.textContent = badgeText;
    }
  }

  function setButtonsEnabled(enabled) {
    btnPdf.disabled = !enabled;
    btnZip.disabled = !enabled;
    btnScroll.disabled = !enabled;
    if (btnCovers) btnCovers.disabled = !enabled;
  }

  // Disable initially until scan finishes
  setButtonsEnabled(false);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('error', 'No active tab found', 'Error');
    return;
  }

  const isAmazon = /amazon\.(com|co\.uk|ca|de|fr|es|it|co\.jp)|read\.amazon\.com/.test(tab.url || '');
  if (!isAmazon) {
    setStatus('', 'Open an Amazon book preview page', 'Not Amazon');
    return;
  }

  setStatus('check', 'Scanning for book pages…', 'Checking…');

  let activeTabId = tab.id;
  let detectedPageCount = 0;

  // ── Scan Tab for preview content ──────────────────────────
  async function scanTab() {
    try {
      // 1. Try sending message to existing content script
      const resp = await new Promise((resolve) => {
        chrome.tabs.sendMessage(activeTabId, { type: 'KDP_GET_STATUS' }, (r) => {
          if (chrome.runtime.lastError || !r) {
            resolve(null);
          } else {
            resolve(r);
          }
        });
      });

      if (resp && resp.active) {
        handleStatusResponse(resp);
        return;
      }

      // 2. Fallback: inspect DOM across all frames via scripting
      const results = await chrome.scripting.executeScript({
        target: { tabId: activeTabId, allFrames: true },
        func: () => {
          const path = window.location.pathname || '';
          const search = window.location.search || '';
          const isSearch = path.startsWith('/s') || search.includes('k=') || search.includes('field-keywords=');
          let searchCount = 0;
          let searchKeyword = '';
          if (isSearch) {
            searchCount = document.querySelectorAll('div[data-component-type="s-search-result"], .s-result-item[data-asin]:not([data-asin=""])').length;
            const input = document.getElementById('twotabsearchtextbox') || document.querySelector('input[name="field-keywords"]');
            searchKeyword = input?.value || '';
          }

          // Check if this frame is a REAL reader preview!
          const isReader = window.location.hostname === 'read.amazon.com' ||
                           !!document.querySelector('#renderer-container, .a-m-us-scroller, #kindleReader_page_container, #litb-container');
          
          let samplePages = 0;
          if (isReader && typeof window.kdpGetImages === 'function') {
            samplePages = window.kdpGetImages().length;
          } else if (isReader) {
            samplePages = [...document.querySelectorAll('img')].filter(img => {
              const w = img.naturalWidth || img.offsetWidth || img.width;
              const h = img.naturalHeight || img.offsetHeight || img.height;
              const src = (img.src || img.dataset.src || '').toLowerCase();
              return (w >= 200 || h >= 250) && !src.startsWith('data:') &&
                     !src.includes('logo') && !src.includes('icon') &&
                     !src.includes('sprite') && !src.includes('spinner');
            }).length;
          }

          const hasWidget = !!document.getElementById('kdp-export-widget');
          const title = document.title || '';
          return { isReader, isSearch, searchCount, searchKeyword, samplePages, hasWidget, title };
        }
      });

      let totalSamplePages = 0;
      let hasWidget = false;
      let pageTitle = '';
      let isSearchFallback = false;
      let searchCountFallback = 0;
      let searchKeywordFallback = '';

      for (const r of results || []) {
        if (!r.result) continue;
        hasWidget = hasWidget || r.result.hasWidget;
        if (r.result.isReader) {
          totalSamplePages += r.result.samplePages;
        }
        if (r.result.isSearch) {
          isSearchFallback = true;
          searchCountFallback = Math.max(searchCountFallback, r.result.searchCount || 0);
          if (r.result.searchKeyword) searchKeywordFallback = r.result.searchKeyword;
        }
        if (r.result.title && !pageTitle) pageTitle = r.result.title;
      }

      handleStatusResponse({
        pageCount: totalSamplePages,
        title: pageTitle,
        hasWidget,
        isSearch: isSearchFallback,
        searchCount: searchCountFallback,
        searchKeyword: searchKeywordFallback
      });

    } catch (err) {
      console.warn('[KDP Popup] Scan error:', err);
      setStatus('', 'Open an Amazon book or search page', 'Waiting');
    }
  }

  function handleStatusResponse(info) {
    const isSearch = !!info.isSearch;
    const searchCount = info.searchCount || 0;
    const searchKeyword = info.searchKeyword || '';
    const count = info.pageCount !== undefined ? info.pageCount : (info.count || 0);
    const title = info.title || '';

    if (isSearch) {
      const kw = searchKeyword || 'Keyword';
      const c = searchCount || 0;
      setStatus('ok', `Search: "${kw}" (${c} books)`, `${c} Books`);
      if (demoTitle) demoTitle.textContent = `Search: ${kw}`.slice(0, 18);

      if (btnSearchCovers) {
        btnSearchCovers.style.display = 'flex';
        btnSearchCovers.textContent = `📥 Download All ${c} Search Covers (ZIP)`;
        btnSearchCovers.disabled = false;
      }
      if (btnOpenSample) btnOpenSample.style.display = 'none';
      if (btnCovers) {
        btnCovers.textContent = `🖼️ Download All Search Covers (${c} Books)`;
        btnCovers.disabled = false;
      }
      if (btnScroll) {
        btnScroll.textContent = `⏬ Auto-Scroll Search Page (${c} Books)`;
        btnScroll.disabled = false;
      }
      btnPdf.disabled = true;
      btnZip.disabled = true;
      return;
    }

    // Normal Book Page:
    if (btnSearchCovers) btnSearchCovers.style.display = 'none';
    if (btnCovers) btnCovers.textContent = '🖼️ Download Book Cover(s)';
    if (btnScroll) btnScroll.textContent = '⏬ Auto-Load All Pages First';

    detectedPageCount = count;
    if (title && demoTitle) {
      demoTitle.textContent = title.length > 18 ? title.slice(0, 18) + '…' : title;
    }

    if (btnCovers) btnCovers.disabled = false;
    btnScroll.disabled = false;

    if (count > 0) {
      setStatus('ok', `Ready! ${count} sample pages detected`, `${count} pages`);
      btnPdf.disabled = false;
      btnZip.disabled = false;
      if (btnOpenSample) btnOpenSample.style.display = 'none';
      if (inputEnd && !inputEnd.value && count > 0) {
        inputEnd.placeholder = String(count);
      }
    } else {
      setStatus('check', 'Open "Read sample" on book first', 'Sample closed');
      btnPdf.disabled = true;
      btnZip.disabled = true;
      if (btnOpenSample) btnOpenSample.style.display = 'flex';
    }
  }

  await scanTab();

  // ── Trigger Actions in Tab ────────────────────────────────
  async function triggerAction(actionType) {
    const s = parseInt(inputStart.value, 10);
    const endVal = parseInt(inputEnd.value, 10);
    const start = (!isNaN(s) && s >= 1) ? s : undefined;
    const end = (!isNaN(endVal) && endVal >= 1) ? endVal : undefined;

    // Show progress UI in popup
    progressBox.style.display = 'block';
    progressFill.style.width = '15%';

    if (actionType === 'pdf') {
      progressText.textContent = 'Generating PDF…';
      btnPdf.disabled = true;
    } else if (actionType === 'zip') {
      progressText.textContent = 'Packaging PNG ZIP…';
      btnZip.disabled = true;
    } else if (actionType === 'scroll') {
      progressText.textContent = 'Auto-scrolling pages…';
      btnScroll.disabled = true;
    } else if (actionType === 'covers') {
      progressText.textContent = 'Downloading covers…';
      if (btnCovers) btnCovers.disabled = true;
    } else if (actionType === 'search-covers') {
      progressText.textContent = 'Auto-scrolling & packaging search covers…';
      if (btnSearchCovers) btnSearchCovers.disabled = true;
      if (btnCovers) btnCovers.disabled = true;
    }

    let messageType = 'KDP_TRIGGER_PDF';
    if (actionType === 'zip') messageType = 'KDP_TRIGGER_ZIP';
    if (actionType === 'scroll') messageType = 'KDP_TRIGGER_SCROLL';
    if (actionType === 'covers') messageType = 'KDP_TRIGGER_COVERS';
    if (actionType === 'search-covers') messageType = 'KDP_TRIGGER_SEARCH_COVERS';

    // 1. Try sending direct message to all frames
    chrome.tabs.sendMessage(activeTabId, {
      type: messageType,
      start,
      end
    }, async () => {
      // 2. Also execute via scripting directly in all frames as bulletproof fallback
      try {
        await chrome.scripting.executeScript({
          target: { tabId: activeTabId, allFrames: true },
          func: (type, startRange, endRange) => {
            if (type === 'pdf' && typeof window.kdpExportPDF === 'function') {
              window.kdpExportPDF(startRange, endRange);
            } else if (type === 'zip' && typeof window.kdpExportZIP === 'function') {
              window.kdpExportZIP(startRange, endRange);
            } else if (type === 'covers' && typeof window.kdpExportCovers === 'function') {
              window.kdpExportCovers();
            } else if (type === 'search-covers' && typeof window.kdpExportSearchCovers === 'function') {
              window.kdpExportSearchCovers();
            } else if (type === 'scroll' && typeof window.kdpAutoScroll === 'function') {
              window.kdpAutoScroll();
            }
          },
          args: [actionType, start, end]
        });
      } catch (e) {
        console.warn('Script execution fallback:', e);
      }
    });

    // Animate progress simulation in popup
    let p = 25;
    const interval = setInterval(() => {
      if (p < 85) {
        p += 10;
        progressFill.style.width = p + '%';
      }
    }, 450);

    // Listen for real Chrome download creation
    const onDownloadCreated = (item) => {
      clearInterval(interval);
      progressFill.style.width = '100%';
      const clean = (item.filename || '').split(/[\\/]/).pop() || 'Sample file';
      progressText.textContent = `✅ Saved: ${clean}`;
      setTimeout(() => {
        setButtonsEnabled(true);
        scanTab();
      }, 2500);
    };

    if (chrome.downloads && chrome.downloads.onCreated) {
      chrome.downloads.onCreated.addListener(onDownloadCreated);
      setTimeout(() => {
        chrome.downloads.onCreated.removeListener(onDownloadCreated);
      }, 45000);
    }

    setTimeout(() => {
      clearInterval(interval);
      if (progressFill.style.width !== '100%') {
        progressFill.style.width = '95%';
        progressText.textContent = 'Processing pages… Check Downloads folder shortly.';
        setTimeout(() => {
          setButtonsEnabled(true);
          scanTab();
        }, 3500);
      }
    }, 10000);
  }

  // ── Event Handlers ────────────────────────────────────────
  btnPdf.addEventListener('click', () => triggerAction('pdf'));
  btnZip.addEventListener('click', () => triggerAction('zip'));
  btnScroll.addEventListener('click', () => triggerAction('scroll'));
  if (btnCovers) btnCovers.addEventListener('click', () => triggerAction('covers'));
  if (btnSearchCovers) btnSearchCovers.addEventListener('click', () => triggerAction('search-covers'));

  if (btnToggle) {
    btnToggle.addEventListener('click', () => {
      chrome.tabs.sendMessage(activeTabId, { type: 'KDP_TOGGLE_TOOLBAR' });
    });
  }

  if (btnOpenSample) {
    btnOpenSample.addEventListener('click', async () => {
      chrome.tabs.sendMessage(activeTabId, { type: 'KDP_OPEN_SAMPLE' }, async () => {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTabId },
            func: () => {
              if (typeof window.kdpOpenSample === 'function') {
                window.kdpOpenSample();
              }
            }
          });
        } catch (_) {}
      });
      setStatus('check', 'Opening sample… Please wait…', 'Opening…');
      setTimeout(scanTab, 2000);
      setTimeout(scanTab, 4000);
    });
  }

  // Also make the preview toolbar buttons fully clickable!
  if (demoBtnPdf) demoBtnPdf.addEventListener('click', () => triggerAction('pdf'));
  if (demoBtnZip) demoBtnZip.addEventListener('click', () => triggerAction('zip'));

})();
