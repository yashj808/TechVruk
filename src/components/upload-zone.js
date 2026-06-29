/**
 * Upload zone component — handles drag-and-drop and file picker for PDF upload.
 */

import { $, showToast } from '../utils/dom-helpers.js';
import { generateId } from '../utils/id-generator.js';
import { extractImagesFromPDF, matchLabelsToImages } from '../core/pdf-extractor.js';
import { store } from '../core/state-store.js';
import { canvasManager } from '../core/canvas-manager.js';

export function initUploadZone() {
  const overlay = $('#upload-overlay');
  const zone = $('#upload-zone');
  const fileInput = $('#file-input');
  const progressEl = $('#upload-progress');
  const progressFill = $('#progress-fill');
  const progressText = $('#progress-text');

  // ── Click to open file picker ─────────────────────────────
  zone.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    if (progressEl && !progressEl.hidden) return; // Don't open picker during extraction
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });

  // ── Drag and Drop ─────────────────────────────────────────
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => {
    zone.classList.remove('dragover');
  });

  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  });

  // Global drag-over to show overlay if hidden
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (overlay.classList.contains('hidden')) {
      // Only show if dragging a file
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        overlay.classList.remove('hidden');
      }
    }
  });

  // ── Handle File Processing ────────────────────────────────
  async function handleFile(file) {
    const isJson = file.name.endsWith('.json') || file.name.endsWith('.symbex.json');
    if (!isJson && file.type !== 'application/pdf') {
      showToast('Please upload a PDF or Symbex JSON file', 'error');
      return;
    }

    if (isJson) {
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const success = store.deserialize(data);
        if (success) {
          canvasManager.clear();
          await canvasManager.addSymbols(store.getAllSymbols());
          overlay.classList.add('hidden');
          showToast(`Loaded project: ${data.projectName || 'Untitled'}`, 'success');
        } else {
          showToast('Invalid project file format', 'error');
        }
      } catch (err) {
        console.error('Project load failed:', err);
        showToast('Failed to parse project file', 'error');
      }
      return;
    }

    // Show progress
    progressEl.hidden = false;
    progressFill.style.width = '0%';
    progressText.textContent = 'Parsing PDF...';

    try {
      const result = await extractImagesFromPDF(file, (progress) => {
        progressFill.style.width = `${progress}%`;
        if (progress < 50) {
          progressText.textContent = `Scanning pages... ${progress * 2}%`;
        } else {
          progressText.textContent = `Extracting images... ${progress}%`;
        }
      });

      if (result.images.length === 0) {
        progressText.textContent = 'No images found in PDF';
        showToast('No images could be extracted from this PDF', 'warning');
        setTimeout(() => {
          progressEl.hidden = true;
        }, 2000);
        return;
      }

      // Match labels to images
      const labelMap = matchLabelsToImages(result.images, result.pageTexts);

      // Clear existing data
      store.clearAll();
      canvasManager.clear();

      // Create symbol objects
      store.pdfName = result.pdfName;
      store.pdfFile = file;
      const extractBtn = $('#btn-extract-region');
      if (extractBtn) extractBtn.disabled = false;
      
      const symbols = result.images.map((img, i) => {
        const labelData = labelMap.get(img.index) || {};
        const name = labelData.name || `Symbol-${i + 1}`;
        const annotations = labelData.annotations || [];

        // Build initial properties from annotations
        const properties = [];
        if (annotations.length > 0) {
          properties.push({
            key: 'label',
            value: annotations[0],
            type: 'text',
          });
        }

        return {
          id: generateId('sym'),
          name,
          source: {
            pdfName: result.pdfName,
            pageNumber: img.pageNumber,
            xObjectRef: img.xObjectRef,
            originalWidth: img.width,
            originalHeight: img.height,
          },
          canvas: { x: 0, y: 0, width: img.width, height: img.height, rotation: 0, scaleX: 1, scaleY: 1 },
          imageDataUrl: img.dataUrl,
          properties,
          groupId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      });

      // Add to store
      store.addSymbols(symbols);

      // Add to canvas
      await canvasManager.addSymbols(symbols);

      // Update progress
      progressFill.style.width = '100%';
      progressText.textContent = `Found ${symbols.length} symbol${symbols.length !== 1 ? 's' : ''} on ${result.totalPages} page${result.totalPages !== 1 ? 's' : ''}`;

      showToast(`Extracted ${symbols.length} symbols from ${result.pdfName}`, 'success');

      // Hide overlay after brief delay
      setTimeout(() => {
        overlay.classList.add('hidden');
        progressEl.hidden = true;
      }, 1500);

    } catch (err) {
      console.error('PDF extraction failed:', err);
      progressText.textContent = 'Extraction failed';
      showToast(`Failed to extract images: ${err.message}`, 'error');
      setTimeout(() => {
        progressEl.hidden = true;
      }, 2000);
    }

    // Reset file input
    fileInput.value = '';
  }
}
