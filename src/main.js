/**
 * Symbex — PDF Symbol Extractor & Property Editor
 * Main entry point. Initialises all modules and components.
 */

import { canvasManager } from './core/canvas-manager.js';
import { store } from './core/state-store.js';
import { initToolbar } from './components/toolbar.js';
import { initUploadZone } from './components/upload-zone.js';
import { initSymbolLibrary } from './components/symbol-library.js';
import { initPropertyPanel } from './components/property-panel.js';
import { initStatusBar } from './components/status-bar.js';

// ── Boot ────────────────────────────────────────────────────

function init() {
  // 1. Initialise canvas
  canvasManager.init('fabric-canvas');

  // 2. Initialise UI components
  initToolbar();
  initUploadZone();
  initSymbolLibrary();
  initPropertyPanel();
  initStatusBar();

  // 3. Try loading saved project
  const loaded = store.loadFromStorage();
  if (loaded) {
    // Re-add symbols to canvas from store
    const symbols = store.getAllSymbols();
    if (symbols.length > 0) {
      // Hide upload overlay if we have saved data
      const overlay = document.getElementById('upload-overlay');
      overlay.classList.add('hidden');
      canvasManager.addSymbols(symbols);
    }
  }

  console.log('%c✦ Symbex ready', 'color: #cba6f7; font-weight: bold; font-size: 14px;');
}

// Wait for DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
