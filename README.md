# KDP Samples & Covers Exporter 📖✨

A powerful Google Chrome extension (Manifest V3) to download and export Amazon KDP book preview samples ("Read sample" / "Look Inside") and book covers in high resolution.

Exports inside book sample pages directly into merged **PDF** or **PNG (ZIP)** archives, and downloads full HD book covers with one click.

---

## ✨ Features

- 🔍 **Bulk Search Results Covers Downloader:** Search for any KDP niche or keyword on Amazon (e.g., *"crime stories"*), and with one click, the tool smoothly auto-scrolls down the search page to load all lazy-loaded book covers, extracts them in original **Full HD**, and packages them into a single clean ZIP (`Covers-Search-[keyword].zip`). Ideal for KDP research and cover design analysis!
- 📖 **Inside Book Sample PDF Export:** Merges all rendered Kindle preview pages into a single high-quality PDF document.
- 📦 **Sample Pages as PNG ZIP:** Downloads each preview page as a standalone image packaged in a clean `.zip` archive.
- 🖼️ **Full HD Book Covers:** Extracts high-resolution front covers and image gallery shots from Amazon book product pages.
- ⏬ **Auto-Scroll ("Load All"):** Automatically scrolls through the preview scroller smoothly to lazy-load all pages before exporting.
- 🎯 **Page Range Selection:** Select specific page ranges (e.g., pages 1 to 15) or export all detected pages.
- 🖱️ **Floating Draggable Toolbar:**
  - Injected directly into the Amazon preview screen.
  - Can be dragged anywhere (`⠿`), minimized, or hidden (`✕`).
  - Small unobtrusive corner pill (`📖 Export Book`) to reopen anytime.
- ⚡ **Direct Chrome Native Downloads:** Routes all exports through the `chrome.downloads` API directly into your `Downloads` folder, bypassing `iframe` sandbox restrictions.

---

## 🚀 Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/oflamoha2005-arch/download-KDP-samples-covers.git
   ```
2. Open Google Chrome and navigate to:
   ```text
   chrome://extensions/
   ```
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** and select this directory (the folder containing `manifest.json`).
5. The **KDP Samples Exporter** extension is now installed and ready to use!

---

## 📖 How to Use

1. **Open an Amazon Book Page:** Go to any book page on Amazon (e.g., `amazon.com`, `amazon.co.uk`, etc.).
2. **Open the Preview:** Click **"Read sample"** or click on the book cover to open the Kindle preview.
3. **Use the Floating Toolbar:**
   - Click **`⏬ Load All`** to automatically scroll down and render all sample pages.
   - Click **`📖 Sample PDF`** to generate and download the merged PDF.
   - Click **`📦 Sample PNG`** to download all pages inside a ZIP.
   - Click **`🖼️ Covers`** to download the high-resolution front/back covers.
4. **Popup Menu:** You can also click the extension icon in the Chrome toolbar to access the full control panel, set page ranges, or toggle the on-page toolbar.

---

## 🛠️ Tech Stack & Architecture

- **Manifest V3** with Background Service Worker (`background/service_worker.js`)
- **Content Scripts** injected into Amazon pages and Kindle reader subframes (`content/amazon_page.js`)
- **Canvas Image Extraction** to bypass `blob:` URL CORS restrictions
- **jsPDF** (`lib/jspdf.umd.min.js`) for in-browser client-side PDF generation
- **Pure JavaScript ZIP generator** (`SimpleZip`) for zero-dependency compression
- **Chrome Downloads API** for guaranteed file saving

---

## 📄 License

MIT License — feel free to use and modify for your personal and commercial projects.

