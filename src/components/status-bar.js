/**
 * Status bar component — shows symbol count, selection, zoom, and auto-save status.
 */

import { $ } from '../utils/dom-helpers.js';
import { store } from '../core/state-store.js';

export function initStatusBar() {
  const symbolsEl = $('#status-symbols');
  const selectedEl = $('#status-selected');
  const zoomEl = $('#status-zoom');
  const autosaveEl = $('#status-autosave');

  store.on('symbols:changed', (symbols) => {
    symbolsEl.textContent = `${symbols.length} symbol${symbols.length !== 1 ? 's' : ''}`;
  });

  store.on('selection:changed', (ids) => {
    selectedEl.textContent = `${ids.length} selected`;
  });

  store.on('zoom:changed', (percent) => {
    zoomEl.textContent = `Zoom: ${percent}%`;
  });

  store.on('project:saved', () => {
    autosaveEl.classList.add('visible');
    setTimeout(() => autosaveEl.classList.remove('visible'), 2000);
  });
}
