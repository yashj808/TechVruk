# Symbex — PDF Symbol Extractor & Property Editor

**Symbex** is a modern, fully client-side web application designed to extract embedded raster images and custom page regions from PDF documents, render them as transparent clipart on an interactive canvas, and allow users to attach custom structured key-value properties.

Developed by **Yash Jogdand** ([yashjogdandyj@gmail.com](mailto:yashjogdandyj@gmail.com)).

---

## 🚀 Core Features

* **PDF Auto-Extraction**: Automatically extracts embedded `XObject` images from uploaded PDF files.
* **Clipart Background Filter**: Processed on the fly to remove solid white backgrounds, yielding clean, transparent clipart-style elements.
* **Extract Page Region**: If elements are drawn using PDF vector graphics instead of embedded images, users can render a page and manually drag a selection box to crop any area as a custom transparent symbol.
* **Interactive Workspace**: Powered by Fabric.js with support for dragging, scaling, rotating, zoom/pan controls, multi-selection, alignment grids, and fit-to-view options.
* **Rich Property Panel**: Real-time two-way synchronization of coordinates and sizes without cursor focus loss. Supports custom properties with type-aware inputs (Text, Number, Boolean, Color).
* **Multi-Format Exporting**:
  * **JSON**: Full project state (`.symbex.json`).
  * **ZIP**: Clipart images (PNG format) bundled with project metadata.
  * **CSV**: Structured spreadsheet of symbols, dimensions, and custom key-value attributes.
* **Persistence & Theme**: Debounced auto-save to `localStorage` and support for dark/light mode configurations.

---

## 📁 Project Structure

```text
f:\TechVruk\
├── index.html                    # App shell and layout container
├── package.json                  # Project scripts and library dependencies
├── vite.config.js                # Vite development server configuration
├── public/
│   └── favicon.svg               # Application icon asset
└── src/
    ├── main.js                   # Application bootstrap entry point
    ├── styles/                   # Styling system
    │   ├── index.css             # Theme variables, utility styles, and toast alerts
    │   ├── toolbar.css           # Brand heading and operation toolbar layout
    │   ├── canvas.css            # Interactive workspace and status bar indicators
    │   ├── sidebar.css           # Left/right sidebar panel styles
    │   └── upload.css            # Drag-and-drop overlay and region extraction modal
    ├── core/                     # Core logic
    │   ├── state-store.js        # Reactive event store, undo/redo, and persistence
    │   ├── pdf-extractor.js      # PDF.js scanning and image pixel processors
    │   ├── canvas-manager.js     # Fabric.js mouse event bindings, zoom, and selections
    │   └── export-manager.js     # Multi-format project encoders (JSON, ZIP, CSV)
    ├── components/               # UI components
    │   ├── toolbar.js            # Button event listeners
    │   ├── upload-zone.js        # File drag drop pipeline handlers
    │   ├── symbol-library.js     # Left sidebar thumbnail list and search
    │   ├── property-panel.js     # Right sidebar properties CRUD
    │   ├── extract-modal.js      # Custom region cropper modal
    │   └── status-bar.js         # Bottom status bar updater
    └── utils/                    # Shared utilities
        ├── dom-helpers.js        # Custom element creation and toast notifications
        ├── id-generator.js       # UUID/Id creation utilities
        └── debounce.js           # Debouncing utility for state updates
```

---

## 🛠️ How to Run & Deploy

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your system.

### 1. Install Dependencies
Run this command from the project root directory:
```bash
npm install
```

### 2. Start Dev Server
To start the Vite hot-reloading development server:
```bash
npm run dev
```
By default, the application will be hosted at **[http://localhost:3000/](http://localhost:3000/)**.

### 3. Build for Production
To bundle the client-side application for deployment:
```bash
npm run build
```
The optimized bundle will be created in the `dist/` directory.

---

## 👥 Authorship

* **Author**: Yash Jogdand
* **Email**: [yashjogdandyj@gmail.com](mailto:yashjogdandyj@gmail.com)
* **Organization**: TechVruk
