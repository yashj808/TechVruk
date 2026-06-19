/**
 * Toolbar component — wires up toolbar button events.
 */

import { $ } from '../utils/dom-helpers.js';
import { store } from '../core/state-store.js';
import { canvasManager } from '../core/canvas-manager.js';
import { exportAsJSON, exportAsZIP, exportAsCSV } from '../core/export-manager.js';

export function initToolbar() {
  // ── Upload button ─────────────────────────────────────────
  $('#btn-upload').addEventListener('click', () => {
    const overlay = $('#upload-overlay');
    overlay.classList.remove('hidden');
  });

  // ── Undo / Redo ───────────────────────────────────────────
  $('#btn-undo').addEventListener('click', () => store.emit('action:undo'));
  $('#btn-redo').addEventListener('click', () => store.emit('action:redo'));

  store.on('history:changed', ({ canUndo, canRedo }) => {
    $('#btn-undo').disabled = !canUndo;
    $('#btn-redo').disabled = !canRedo;
  });

  // ── Zoom ──────────────────────────────────────────────────
  $('#btn-zoom-in').addEventListener('click', () => canvasManager.zoomIn());
  $('#btn-zoom-out').addEventListener('click', () => canvasManager.zoomOut());
  $('#btn-fit').addEventListener('click', () => canvasManager.fitToView());

  store.on('zoom:changed', (percent) => {
    $('#zoom-level').textContent = `${percent}%`;
  });

  // ── Grid Toggle ───────────────────────────────────────────
  const gridBtn = $('#btn-grid');
  const canvasArea = $('#canvas-area');

  // Initial state
  if (store.canvasState.gridEnabled) {
    canvasArea.classList.add('show-grid');
    gridBtn.classList.add('active');
  }

  gridBtn.addEventListener('click', () => {
    const enabled = canvasArea.classList.toggle('show-grid');
    gridBtn.classList.toggle('active', enabled);
    store.updateCanvasState({ gridEnabled: enabled });
  });

  // ── Delete ────────────────────────────────────────────────
  const deleteBtn = $('#btn-delete');
  deleteBtn.addEventListener('click', () => canvasManager.deleteSelected());

  store.on('selection:changed', (ids) => {
    deleteBtn.disabled = ids.length === 0;
  });

  // ── Export Dropdown ───────────────────────────────────────
  const exportBtn = $('#btn-export');
  const exportDropdown = $('#export-dropdown');

  exportBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = exportDropdown.hasAttribute('hidden');
    exportDropdown.toggleAttribute('hidden', !isHidden);
  });

  // Close dropdown on click outside
  document.addEventListener('click', () => {
    exportDropdown.setAttribute('hidden', '');
  });

  $('#btn-export-json').addEventListener('click', () => {
    exportAsJSON();
    exportDropdown.setAttribute('hidden', '');
  });

  $('#btn-export-zip').addEventListener('click', () => {
    exportAsZIP();
    exportDropdown.setAttribute('hidden', '');
  });

  $('#btn-export-csv').addEventListener('click', () => {
    exportAsCSV();
    exportDropdown.setAttribute('hidden', '');
  });

  // ── Theme Toggle ──────────────────────────────────────────
  const themeBtn = $('#btn-theme');
  themeBtn.addEventListener('click', () => {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    localStorage.setItem('symbex_theme', next);
  });

  // Restore saved theme
  const savedTheme = localStorage.getItem('symbex_theme');
  if (savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  }
}
