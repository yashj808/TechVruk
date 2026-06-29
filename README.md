# Symbex — PDF Symbol Extractor & Property Editor

**Symbex** is a web application that extracts all visual elements — both embedded raster images and vector-drawn engineering symbols — from PDF documents, renders them as transparent clipart on an interactive canvas, and lets users attach structured properties to each symbol.

Developed by **Yash Jogdand** ([yashjogdandyj@gmail.com](mailto:yashjogdandyj@gmail.com)).

---

## 🚀 Core Features

* **Full Shape Extraction**: Extracts both raster images (XObject) and vector-drawn shapes (paths, curves, fills) using a local PyMuPDF server. Falls back to client-side PDF.js when the server is unavailable.
* **Transparent Clipart**: White backgrounds are automatically removed from all extracted shapes, producing clean transparent PNGs.
* **Extract Page Region**: Manually drag a selection box on a rendered PDF page to crop any area as a custom symbol.
* **Interactive Workspace**: Powered by Fabric.js — drag, scale, rotate, zoom/pan, multi-select, alignment grids, and fit-to-view.
* **Property Panel**: Two-way synchronized coordinate/size editing with custom properties (Text, Number, Boolean, Color).
* **Multi-Format Export**:
  * **JSON** — Full project state (`.symbex.json`)
  * **ZIP** — PNG images bundled with project metadata
  * **CSV** — Spreadsheet of symbols, dimensions, and custom attributes
* **Persistence & Theme**: Auto-save to `localStorage`, dark/light mode toggle.

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | Vite + Vanilla JS | Dev server, bundling, HMR |
| Canvas | Fabric.js | Interactive symbol manipulation |
| Client PDF | PDF.js | Fallback raster image extraction |
| Server PDF | PyMuPDF (`fitz`) | Native vector + raster extraction |
| Local API | Flask + Flask-CORS | Bridge between browser and PyMuPDF |
| Styling | Vanilla CSS | Dark theme, glassmorphism, animations |

---

## 📁 Project Structure

```
├── index.html                 # App shell and layout
├── vite.config.js             # Vite dev server config
├── package.json               # Node dependencies and scripts
├── server.py                  # Local PyMuPDF extraction server (Flask)
├── extract.py                 # Standalone CLI extraction script
├── vercel.json                # Vercel deployment config
├── public/
│   └── favicon.svg            # App icon
└── src/
    ├── main.js                # App bootstrap
    ├── styles/
    │   ├── index.css          # Theme variables, utilities, toasts
    │   ├── toolbar.css        # Toolbar layout
    │   ├── canvas.css         # Canvas workspace and status bar
    │   ├── sidebar.css        # Left/right sidebar panels
    │   └── upload.css         # Upload overlay and extract modal
    ├── core/
    │   ├── pdf-extractor.js   # PyMuPDF server-first, PDF.js fallback
    │   ├── state-store.js     # Reactive store, undo/redo, persistence
    │   ├── canvas-manager.js  # Fabric.js bindings, zoom, selection
    │   └── export-manager.js  # JSON, ZIP, CSV export encoders
    ├── components/
    │   ├── toolbar.js         # Toolbar button handlers
    │   ├── upload-zone.js     # File drag-drop and import pipeline
    │   ├── symbol-library.js  # Left sidebar symbol list and search
    │   ├── property-panel.js  # Right sidebar property CRUD
    │   ├── extract-modal.js   # Manual region cropper modal
    │   └── status-bar.js      # Bottom status bar
    └── utils/
        ├── dom-helpers.js     # DOM utilities, toast notifications
        ├── id-generator.js    # UUID generation
        └── debounce.js        # Debounce utility
```

---

## 🏃 How to Run

### Prerequisites

* [Node.js](https://nodejs.org/) (v18+)
* [Python](https://python.org/) (v3.10+)

### 1. Install Dependencies

```bash
# JavaScript dependencies
npm install

# Python dependencies
pip install pymupdf flask flask-cors
```

### 2. Start Both Servers

Open **two terminals**:

```bash
# Terminal 1 — PyMuPDF extraction server
python server.py
# Runs on http://localhost:5050

# Terminal 2 — Vite dev server
npm run dev
# Runs on http://localhost:3000
```

### 3. Use the App

1. Open **http://localhost:3000** in your browser
2. Upload a PDF — the app sends it to the PyMuPDF server for full extraction
3. All shapes (raster + vector) appear on the canvas with transparent backgrounds
4. Edit properties, export as JSON/ZIP/CSV

### Without Python Server

If the Python server is not running, the app still works — it falls back to client-side PDF.js extraction (raster images only).

### Standalone CLI Extraction

```bash
python extract.py "MyFile.pdf" "output.symbex.json"
```

This generates a `.symbex.json` project file that you can import into the web app.

### Build for Production

```bash
npm run build
```

Output goes to `dist/`.

---

## 🔬 How Extraction Works

```
PDF Upload → Browser
    ↓
POST to localhost:5050/extract
    ↓
PyMuPDF (fitz):
  ├── page.get_images()    → 5 raster XObject images
  ├── page.get_drawings()  → 28 vector path commands
  ├── Group by proximity   → 13 distinct vector shapes
  ├── Render at 3× with alpha channel
  └── White → transparent pixel conversion
    ↓
JSON response with 18 base64 PNG data URLs
    ↓
Fabric.js canvas renders all symbols
```

---

## 👥 Author

* **Yash Jogdand**
* **Email**: [yashjogdandyj@gmail.com](mailto:yashjogdandyj@gmail.com)
* **Organization**: TechVruk
