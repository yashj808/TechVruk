/**
 * Export manager — handles JSON, ZIP, and CSV export of symbols + properties.
 */

import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { store } from './state-store.js';

/**
 * Export project as JSON file.
 */
export function exportAsJSON() {
  const data = store.serialize();
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const name = sanitizeFilename(store.projectName || 'symbex_export');
  saveAs(blob, `${name}.symbex.json`);
}

/**
 * Export project as ZIP (JSON + individual images).
 */
export async function exportAsZIP() {
  const zip = new JSZip();
  const data = store.serialize();

  // Remove image data from JSON (images go in separate files)
  const jsonData = {
    ...data,
    symbols: data.symbols.map(sym => ({
      ...sym,
      imageDataUrl: undefined,
      imageFile: `images/${sanitizeFilename(sym.name)}.png`,
    })),
  };

  zip.file('project.json', JSON.stringify(jsonData, null, 2));

  // Add images
  const imagesFolder = zip.folder('images');
  for (const sym of data.symbols) {
    if (sym.imageDataUrl) {
      const imgData = sym.imageDataUrl.split(',')[1];
      if (imgData) {
        const filename = sanitizeFilename(sym.name) + '.png';
        imagesFolder.file(filename, imgData, { base64: true });
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const name = sanitizeFilename(store.projectName || 'symbex_export');
  saveAs(blob, `${name}.zip`);
}

/**
 * Export symbol properties as CSV.
 */
export function exportAsCSV() {
  const symbols = store.getAllSymbols();
  if (symbols.length === 0) return;

  // Collect all unique property keys
  const allKeys = new Set();
  for (const sym of symbols) {
    if (sym.properties) {
      for (const prop of sym.properties) {
        allKeys.add(prop.key);
      }
    }
  }

  const propKeys = [...allKeys];
  const headers = ['Name', 'ID', 'Page', 'X', 'Y', 'Width', 'Height', 'Rotation', ...propKeys];

  const rows = symbols.map(sym => {
    const row = [
      sym.name,
      sym.id,
      sym.source?.pageNumber || '',
      sym.canvas?.x || '',
      sym.canvas?.y || '',
      sym.canvas?.width || '',
      sym.canvas?.height || '',
      sym.canvas?.rotation || 0,
    ];

    // Add custom property values
    for (const key of propKeys) {
      const prop = (sym.properties || []).find(p => p.key === key);
      row.push(prop ? prop.value : '');
    }

    return row;
  });

  const csv = [
    headers.map(escapeCSV).join(','),
    ...rows.map(r => r.map(escapeCSV).join(',')),
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const name = sanitizeFilename(store.projectName || 'symbex_export');
  saveAs(blob, `${name}.csv`);
}

/**
 * Copy a single symbol's data as JSON to clipboard.
 */
export async function copySymbolToClipboard(symbolId) {
  const sym = store.getSymbol(symbolId);
  if (!sym) return false;

  const data = { ...sym };
  delete data.imageDataUrl; // Don't include large base64 in clipboard

  try {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Import a project file.
 */
export function importProject(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        resolve(data);
      } catch (err) {
        reject(new Error('Invalid project file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

// ── Helpers ────────────────────────────────────────────────

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').substring(0, 64);
}

function escapeCSV(val) {
  const str = String(val ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
