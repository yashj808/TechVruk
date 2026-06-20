/**
 * Property panel component — right sidebar for viewing and editing
 * symbol properties, transforms, and custom key-value pairs.
 */

import { $, createElement, showToast } from '../utils/dom-helpers.js';
import { store } from '../core/state-store.js';
import { copySymbolToClipboard } from '../core/export-manager.js';

export function initPropertyPanel() {
  const contentEl = $('#property-content');

  function render() {
    const selected = store.getSelectedSymbols();

    if (selected.length === 0) {
      contentEl.innerHTML = `
        <div class="sidebar__empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
            <path d="M12 20h9"/>
            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
          </svg>
          <p>Select a symbol to edit properties</p>
        </div>
      `;
      return;
    }

    if (selected.length > 1) {
      contentEl.innerHTML = `
        <div class="sidebar__empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.3">
            <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
            <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
          </svg>
          <p>${selected.length} symbols selected</p>
        </div>
      `;
      return;
    }

    const sym = selected[0];
    contentEl.innerHTML = '';

    // ── Preview ─────────────────────────────────────────────
    const preview = createElement('div', { className: 'prop-preview' }, [
      sym.imageDataUrl
        ? createElement('img', { src: sym.imageDataUrl, alt: sym.name })
        : null,
    ].filter(Boolean));
    contentEl.appendChild(preview);

    // ── Identity Section ────────────────────────────────────
    const identitySection = createElement('div', { className: 'prop-section' }, [
      createElement('div', { className: 'prop-section__title', textContent: 'Identity' }),
      createField('Name', sym.name, (val) => {
        store.updateSymbol(sym.id, { name: val });
      }),
      createReadonlyField('Source', `${sym.source?.pdfName || 'Unknown'}, Page ${sym.source?.pageNumber || '?'}`),
      createReadonlyField('Original Size', `${sym.source?.originalWidth || 0} × ${sym.source?.originalHeight || 0}`),
    ]);
    contentEl.appendChild(identitySection);

    // ── Transform Section ───────────────────────────────────
    const canvas = sym.canvas || {};
    const transformSection = createElement('div', { className: 'prop-section' }, [
      createElement('div', { className: 'prop-section__title', textContent: 'Transform' }),
      createElement('div', { className: 'prop-field__row' }, [
        createNumberField('X', canvas.x || 0, (val) => {
          const currentCanvas = store.getSymbol(sym.id).canvas || {};
          store.updateSymbol(sym.id, { canvas: { ...currentCanvas, x: val } });
        }),
        createNumberField('Y', canvas.y || 0, (val) => {
          const currentCanvas = store.getSymbol(sym.id).canvas || {};
          store.updateSymbol(sym.id, { canvas: { ...currentCanvas, y: val } });
        }),
      ]),
      createElement('div', { className: 'prop-field__row' }, [
        createNumberField('W', canvas.width || 0, (val) => {
          const currentCanvas = store.getSymbol(sym.id).canvas || {};
          store.updateSymbol(sym.id, { canvas: { ...currentCanvas, width: val } });
        }),
        createNumberField('H', canvas.height || 0, (val) => {
          const currentCanvas = store.getSymbol(sym.id).canvas || {};
          store.updateSymbol(sym.id, { canvas: { ...currentCanvas, height: val } });
        }),
      ]),
      createNumberField('Rotation', canvas.rotation || 0, (val) => {
        const currentCanvas = store.getSymbol(sym.id).canvas || {};
        store.updateSymbol(sym.id, { canvas: { ...currentCanvas, rotation: val } });
      }, '°'),
    ]);
    contentEl.appendChild(transformSection);

    // ── Custom Properties Section ───────────────────────────
    const propsSection = createElement('div', { className: 'prop-section' });
    propsSection.appendChild(
      createElement('div', { className: 'prop-section__title', textContent: 'Custom Properties' })
    );

    const properties = sym.properties || [];
    properties.forEach((prop, index) => {
      const row = createPropertyRow(sym.id, prop, index);
      propsSection.appendChild(row);
    });

    // Add property button
    const addBtn = createElement('button', {
      className: 'prop-add-btn',
      innerHTML: `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add Property
      `,
      onClick: () => {
        store.addProperty(sym.id, {
          key: '',
          value: '',
          type: 'text',
        });
      },
    });
    propsSection.appendChild(addBtn);

    contentEl.appendChild(propsSection);

    // ── Actions ─────────────────────────────────────────────
    const actionsSection = createElement('div', { className: 'prop-section' }, [
      createElement('div', { className: 'prop-section__title', textContent: 'Actions' }),
      createElement('button', {
        className: 'prop-add-btn',
        innerHTML: `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          Copy as JSON
        `,
        onClick: async () => {
          const ok = await copySymbolToClipboard(sym.id);
          showToast(ok ? 'Copied to clipboard' : 'Failed to copy', ok ? 'success' : 'error');
        },
      }),
    ]);
    contentEl.appendChild(actionsSection);
  }

  // ── Field builders ────────────────────────────────────────

  function createField(label, value, onChange) {
    return createElement('div', { className: 'prop-field' }, [
      createElement('label', { className: 'prop-field__label', textContent: label }),
      createElement('input', {
        className: 'prop-field__input',
        type: 'text',
        value: value || '',
        onInput: (e) => onChange(e.target.value),
      }),
    ]);
  }

  function createReadonlyField(label, value) {
    return createElement('div', { className: 'prop-field' }, [
      createElement('label', { className: 'prop-field__label', textContent: label }),
      createElement('span', {
        className: 'prop-field__input',
        textContent: value,
        style: { opacity: '0.7', userSelect: 'text', cursor: 'default' },
      }),
    ]);
  }

  function createNumberField(label, value, onChange, suffix = '') {
    return createElement('div', { className: 'prop-field' }, [
      createElement('label', { className: 'prop-field__label', textContent: label + suffix }),
      createElement('input', {
        className: 'prop-field__input',
        type: 'number',
        value: Math.round(value),
        onInput: (e) => onChange(parseFloat(e.target.value) || 0),
      }),
    ]);
  }

  function createPropertyRow(symbolId, prop, index) {
    const row = createElement('div', { className: 'prop-custom-row' });

    // Key input
    const keyInput = createElement('div', { className: 'prop-custom-row__key' }, [
      createElement('input', {
        type: 'text',
        placeholder: 'Key',
        value: prop.key || '',
        onInput: (e) => {
          store.updateProperty(symbolId, index, { key: e.target.value });
        },
      }),
    ]);

    // Value input based on type
    const valueContainer = createElement('div', { className: 'prop-custom-row__value' });

    if (prop.type === 'boolean') {
      const toggle = createElement('div', {
        className: `prop-toggle ${prop.value ? 'active' : ''}`,
        onClick: () => {
          store.updateProperty(symbolId, index, { value: !prop.value });
        },
      });
      valueContainer.appendChild(toggle);
    } else if (prop.type === 'color') {
      const colorWrap = createElement('div', { className: 'prop-color-input' }, [
        createElement('div', { className: 'prop-color-swatch' }, [
          createElement('input', {
            type: 'color',
            value: prop.value || '#cba6f7',
            onInput: (e) => {
              store.updateProperty(symbolId, index, { value: e.target.value });
            },
          }),
        ]),
        createElement('input', {
          type: 'text',
          value: prop.value || '#cba6f7',
          onInput: (e) => {
            store.updateProperty(symbolId, index, { value: e.target.value });
          },
        }),
      ]);
      valueContainer.appendChild(colorWrap);
    } else {
      const valInput = createElement('input', {
        type: prop.type === 'number' ? 'number' : 'text',
        placeholder: 'Value',
        value: prop.value ?? '',
        onInput: (e) => {
          const val = prop.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
          store.updateProperty(symbolId, index, { value: val });
        },
      });
      valueContainer.appendChild(valInput);
    }

    // Type selector
    const typeSelect = createElement('select', {
      className: 'prop-type-select',
      title: 'Property type',
      onInput: (e) => {
        const newType = e.target.value;
        let newValue = prop.value;
        if (newType === 'boolean') newValue = !!prop.value;
        else if (newType === 'number') newValue = parseFloat(prop.value) || 0;
        else if (newType === 'color') newValue = prop.value || '#cba6f7';
        else newValue = String(prop.value ?? '');
        store.updateProperty(symbolId, index, { type: newType, value: newValue });
      },
    }, [
      createElement('option', { value: 'text', textContent: 'Text' }),
      createElement('option', { value: 'number', textContent: 'Num' }),
      createElement('option', { value: 'boolean', textContent: 'Bool' }),
      createElement('option', { value: 'color', textContent: 'Color' }),
    ]);
    typeSelect.value = prop.type || 'text';

    // Delete button
    const deleteBtn = createElement('button', {
      className: 'prop-custom-row__delete',
      title: 'Delete property',
      innerHTML: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
      onClick: () => {
        store.removeProperty(symbolId, index);
      },
    });

    row.append(keyInput, valueContainer, typeSelect, deleteBtn);
    return row;
  }

  // ── Store event listeners ─────────────────────────────────
  store.on('selection:changed', render);
  store.on('symbol:updated', () => {
    // Re-render if the updated symbol is currently selected
    const selected = store.getSelectedSymbols();
    if (selected.length === 1) {
      // Don't steal focus if user is actively typing in an input or select
      if (contentEl.contains(document.activeElement)) {
        const tag = document.activeElement.tagName;
        if (tag === 'INPUT' || tag === 'SELECT') {
          return;
        }
      }
      render();
    }
  });

  // Initial render
  render();
}
