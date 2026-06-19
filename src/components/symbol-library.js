/**
 * Symbol library component — left sidebar with thumbnails, search, and selection.
 */

import { $, createElement } from '../utils/dom-helpers.js';
import { debounce } from '../utils/debounce.js';
import { store } from '../core/state-store.js';
import { canvasManager } from '../core/canvas-manager.js';

export function initSymbolLibrary() {
  const listEl = $('#symbol-list');
  const countEl = $('#symbol-count');
  const searchInput = $('#symbol-search');

  let currentFilter = '';

  // ── Render symbol list ────────────────────────────────────
  function render() {
    const symbols = store.getAllSymbols();
    const selectedIds = store.selectedIds;

    // Filter
    let filtered = symbols;
    if (currentFilter) {
      const q = currentFilter.toLowerCase();
      filtered = symbols.filter(sym => {
        const nameMatch = sym.name.toLowerCase().includes(q);
        const propMatch = (sym.properties || []).some(p =>
          p.key.toLowerCase().includes(q) || String(p.value).toLowerCase().includes(q)
        );
        return nameMatch || propMatch;
      });
    }

    // Update count
    countEl.textContent = filtered.length;

    // Empty state
    if (filtered.length === 0) {
      listEl.innerHTML = `
        <div class="sidebar__empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          <p>${symbols.length === 0 ? 'Upload a PDF to extract symbols' : 'No symbols match your search'}</p>
        </div>
      `;
      return;
    }

    // Build cards
    listEl.innerHTML = '';
    for (const sym of filtered) {
      const isActive = selectedIds.has(sym.id);
      const propCount = (sym.properties || []).length;

      const card = createElement('div', {
        className: `symbol-card ${isActive ? 'active' : ''}`,
        dataset: { id: sym.id },
        onClick: (e) => {
          const addToSelection = e.shiftKey || e.ctrlKey;
          store.select(sym.id, addToSelection);
          canvasManager.selectById(sym.id);
        },
      }, [
        createElement('div', { className: 'symbol-card__thumb' }, [
          sym.imageDataUrl
            ? createElement('img', { src: sym.imageDataUrl, alt: sym.name })
            : null,
        ]),
        createElement('div', { className: 'symbol-card__info' }, [
          createElement('div', { className: 'symbol-card__name', textContent: sym.name }),
          createElement('div', {
            className: 'symbol-card__meta',
            textContent: `Page ${sym.source?.pageNumber || '?'} • ${sym.source?.originalWidth || 0}×${sym.source?.originalHeight || 0}`,
          }),
        ]),
        propCount > 0
          ? createElement('span', {
              className: 'symbol-card__props-badge',
              textContent: `${propCount}`,
              title: `${propCount} properties`,
            })
          : null,
      ].filter(Boolean));

      listEl.appendChild(card);
    }
  }

  // ── Search ────────────────────────────────────────────────
  const debouncedRender = debounce(render, 200);

  searchInput.addEventListener('input', () => {
    currentFilter = searchInput.value.trim();
    debouncedRender();
  });

  // ── Store event listeners ─────────────────────────────────
  store.on('symbols:changed', render);
  store.on('selection:changed', render);

  // Initial render
  render();
}
