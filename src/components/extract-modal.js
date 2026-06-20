/**
 * Extract modal component — handles custom page region selection,
 * rendering PDF pages, crop overlay dragging, and creating cropped symbols.
 */

import { FabricImage } from 'fabric';

// Lazy-load pdfjs when opening the modal to avoid large initial bundle
let _pdfjsModal = null;
async function getPdfJsForModal() {
  if (_pdfjsModal) return _pdfjsModal;
  _pdfjsModal = await import('pdfjs-dist');
  _pdfjsModal.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
  return _pdfjsModal;
}
import { $, createElement, showToast } from '../utils/dom-helpers.js';
import { store } from '../core/state-store.js';
import { canvasManager } from '../core/canvas-manager.js';
import { generateId } from '../utils/id-generator.js';

export function initExtractModal() {
  const modal = $('#extract-modal');
  const openBtn = $('#btn-extract-region');
  const closeBtn = $('#extract-modal-close');
  const cancelBtn = $('#btn-extract-cancel');
  const confirmBtn = $('#btn-extract-confirm');
  const pageSelect = $('#extract-page-select');
  const pdfCanvas = $('#extract-pdf-canvas');
  const cropOverlay = $('#extract-crop-overlay');
  const container = $('#extract-canvas-container');

  if (!modal || !openBtn) return;

  let pdfDoc = null;
  let currentPageNum = 1;
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let cropRect = { left: 0, top: 0, width: 0, height: 0 };
  let scale = 1.5; // Render scale for selection canvas

  // ── Open Modal ────────────────────────────────────────────
  openBtn.addEventListener('click', async () => {
    if (!store.pdfFile) {
      showToast('No PDF loaded', 'error');
      return;
    }

    try {
      showToast('Loading page preview...', 'info');
      const pdfjsLib = await getPdfJsForModal();
      const arrayBuffer = await store.pdfFile.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      // Populate page select dropdown
      pageSelect.innerHTML = '';
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        pageSelect.appendChild(createElement('option', { value: i, textContent: `Page ${i}` }));
      }

      currentPageNum = 1;
      pageSelect.value = currentPageNum;
      
      modal.classList.remove('hidden');
      resetCrop();
      await renderPage(currentPageNum);
    } catch (err) {
      console.error('Failed to load PDF preview:', err);
      showToast('Could not load PDF preview', 'error');
    }
  });

  // ── Close Modal ───────────────────────────────────────────
  const closeModal = () => {
    modal.classList.add('hidden');
    pdfDoc = null;
    resetCrop();
  };

  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  // ── Page Change ───────────────────────────────────────────
  pageSelect.addEventListener('change', async (e) => {
    currentPageNum = parseInt(e.target.value) || 1;
    resetCrop();
    await renderPage(currentPageNum);
  });

  // ── Render PDF Page ───────────────────────────────────────
  async function renderPage(pageNum) {
    if (!pdfDoc) return;
    try {
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      
      pdfCanvas.width = viewport.width;
      pdfCanvas.height = viewport.height;

      const ctx = pdfCanvas.getContext('2d');
      await page.render({
        canvasContext: ctx,
        viewport: viewport
      }).promise;
    } catch (err) {
      console.error('Page render failed:', err);
      showToast('Page render failed', 'error');
    }
  }

  // ── Drag Selection Overlay ────────────────────────────────
  container.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; // Left click only
    const rect = pdfCanvas.getBoundingClientRect();
    
    // Check if click is within the canvas
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x < 0 || x > rect.width || y < 0 || y > rect.height) return;

    isDragging = true;
    startX = x;
    startY = y;

    cropRect = { left: startX, top: startY, width: 0, height: 0 };
    updateCropOverlay();
    cropOverlay.classList.remove('hidden');
    confirmBtn.disabled = true;
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = pdfCanvas.getBoundingClientRect();
    
    // Clamp to canvas boundaries
    const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    cropRect.left = Math.min(startX, currentX);
    cropRect.top = Math.min(startY, currentY);
    cropRect.width = Math.abs(startX - currentX);
    cropRect.height = Math.abs(startY - currentY);

    updateCropOverlay();
  });

  document.addEventListener('mouseup', () => {
    if (!isDragging) return;
    isDragging = false;

    // Only enable confirm button if selection is reasonable
    if (cropRect.width > 10 && cropRect.height > 10) {
      confirmBtn.disabled = false;
    } else {
      cropOverlay.classList.add('hidden');
      confirmBtn.disabled = true;
    }
  });

  function resetCrop() {
    cropRect = { left: 0, top: 0, width: 0, height: 0 };
    cropOverlay.classList.add('hidden');
    confirmBtn.disabled = true;
  }

  function updateCropOverlay() {
    cropOverlay.style.left = `${cropRect.left}px`;
    cropOverlay.style.top = `${cropRect.top}px`;
    cropOverlay.style.width = `${cropRect.width}px`;
    cropOverlay.style.height = `${cropRect.height}px`;
  }

  // ── Extract Selection & Create Symbol ─────────────────────
  confirmBtn.addEventListener('click', async () => {
    if (cropRect.width <= 10 || cropRect.height <= 10) return;

    try {
      showToast('Extracting shape...', 'info');

      // Create a temporary canvas to hold the cropped region
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = cropRect.width;
      cropCanvas.height = cropRect.height;
      const cropCtx = cropCanvas.getContext('2d');

      // Draw the cropped region from the rendered PDF page canvas
      cropCtx.drawImage(
        pdfCanvas,
        cropRect.left, cropRect.top, cropRect.width, cropRect.height, // source
        0, 0, cropRect.width, cropRect.height // dest
      );

      // Filter background to make transparent (clipart style)
      const imgData = cropCtx.getImageData(0, 0, cropCanvas.width, cropCanvas.height);
      const px = imgData.data;
      for (let i = 0; i < px.length; i += 4) {
        // If pixel is white or very close to white, make it transparent
        if (px[i] > 240 && px[i+1] > 240 && px[i+2] > 240) {
          px[i+3] = 0; // Alpha to 0
        }
      }
      cropCtx.putImageData(imgData, 0, 0);

      const dataUrl = cropCanvas.toDataURL('image/png');
      const symbolId = generateId('sym');

      // Get target canvas center coordinates for default placement
      const fabricCanvas = canvasManager.canvas;
      const center = fabricCanvas.getCenterPoint();

      // Create new symbol object
      const newSymbol = {
        id: symbolId,
        name: `Custom-${store.getAllSymbols().length + 1}`,
        source: {
          pdfName: store.pdfName,
          pageNumber: currentPageNum,
          xObjectRef: `custom_${Date.now()}`,
          originalWidth: Math.round(cropRect.width / scale),
          originalHeight: Math.round(cropRect.height / scale),
        },
        canvas: {
          x: Math.round(center.x - cropRect.width / 2),
          y: Math.round(center.y - cropRect.height / 2),
          width: cropRect.width,
          height: cropRect.height,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
        },
        imageDataUrl: dataUrl,
        properties: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Add to store
      store.addSymbol(newSymbol);

      // Add image to Fabric canvas
      const img = await FabricImage.fromURL(dataUrl, {}, {
        crossOrigin: 'anonymous',
      });
      img.set({
        left: newSymbol.canvas.x,
        top: newSymbol.canvas.y,
        borderColor: '#cba6f7',
        cornerColor: '#cba6f7',
        cornerStrokeColor: '#1e1e2e',
        cornerSize: 8,
        cornerStyle: 'circle',
        transparentCorners: false,
        padding: 4,
      });
      img._symbolId = symbolId;
      canvasManager.objectMap.set(symbolId, img);
      fabricCanvas.add(img);
      fabricCanvas.setActiveObject(img);
      fabricCanvas.requestRenderAll();

      showToast('Custom symbol added to canvas!', 'success');
      closeModal();
    } catch (err) {
      console.error('Extraction failed:', err);
      showToast('Failed to crop custom symbol', 'error');
    }
  });
}
