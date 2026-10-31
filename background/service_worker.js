/**
 * KDP Samples Exporter — Background Service Worker
 * Handles download coordination via chrome.downloads API and CORS image fetching.
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log('[KDP Exporter] Extension installed / updated (v7.2.0)');
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ── Native File Download via chrome.downloads API ────────
  if (message.type === 'DOWNLOAD') {
    let rawFilename = message.filename || 'Amazon_Book_Sample.pdf';
    
    // Strict Windows filesystem sanitization:
    // Remove characters disallowed on Windows: < > : " / \ | ? * and ASCII 0-31
    let cleanName = rawFilename
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanName) cleanName = 'Amazon_Book_Sample.pdf';
    // Limit filename length to prevent Windows MAX_PATH errors
    const ext = cleanName.endsWith('.zip') ? '.zip' : '.pdf';
    const base = cleanName.replace(/\.(pdf|zip)$/i, '').slice(0, 75).trim();
    cleanName = `${base}${ext}`;

    console.log('[KDP Background] Triggering download:', cleanName, 'URL length:', message.url ? message.url.length : 0);

    try {
      chrome.downloads.download({
        url: message.url,
        filename: cleanName,
        saveAs: false,
        conflictAction: 'uniquify'
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.warn('[KDP Background] Primary download failed:', chrome.runtime.lastError.message);
          
          // Retry with guaranteed safe filename
          const safeFallbackName = `Amazon_Sample_${Date.now()}${ext}`;
          chrome.downloads.download({
            url: message.url,
            filename: safeFallbackName,
            saveAs: false,
            conflictAction: 'uniquify'
          }, (retryId) => {
            if (chrome.runtime.lastError) {
              console.error('[KDP Background] Fallback download also failed:', chrome.runtime.lastError.message);
              sendResponse({ error: chrome.runtime.lastError.message });
            } else {
              console.log('[KDP Background] Fallback download succeeded, ID:', retryId);
              sendResponse({ downloadId: retryId, filename: safeFallbackName });
            }
          });
        } else {
          console.log('[KDP Background] Download started successfully! Download ID:', downloadId);
          sendResponse({ downloadId, filename: cleanName });
        }
      });
    } catch (err) {
      console.error('[KDP Background] Exception in chrome.downloads.download:', err);
      sendResponse({ error: err.message });
    }
    return true; // Keep message channel open for async response
  }

  if (message.type === 'GET_TAB_ID') {
    sendResponse({ tabId: sender.tab?.id });
    return false;
  }

  // ── Background Fetch with Chunked Base64 Conversion ─────
  if (message.type === 'FETCH_IMAGE') {
    fetch(message.url)
      .then(r => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      })
      .then(async (blob) => {
        const buffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        // Fast chunked base64 conversion to avoid stack overflow or memory freeze
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        const base64 = btoa(binary);
        const mime = blob.type || (message.url.includes('.png') ? 'image/png' : 'image/jpeg');
        const dataUrl = `data:${mime};base64,${base64}`;
        sendResponse({ dataUrl, mimeType: mime });
      })
      .catch(e => {
        console.error('[KDP Background] Fetch image error:', e);
        sendResponse({ error: e.message });
      });
    return true; // keep channel open for async response
  }
});
