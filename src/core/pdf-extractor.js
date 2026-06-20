/**
 * PDF image extraction using PDF.js.
 * Extracts embedded XObject images and page text labels.
 */

// Lazy-load PDF.js and initialize worker only when needed
let _pdfjsLib = null;
async function getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  _pdfjsLib = await import('pdfjs-dist');
  // set worker source to the bundled worker (module worker)
  _pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
  return _pdfjsLib;
}

/**
 * Extract images from a PDF file.
 * @param {File} file - The PDF file
 * @param {function} onProgress - Progress callback (0-100)
 * @returns {Promise<{ images: Array, pageTexts: Array }>}
 */
export async function extractImagesFromPDF(file, onProgress = () => {}) {
  const pdfjsLib = await getPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const totalPages = pdf.numPages;
  const extractedImages = [];
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const progress = (pageNum / totalPages) * 100;
    onProgress(Math.round(progress * 0.5)); // 0–50%: page processing

    // ── Extract embedded XObject images ──────────────────────
    const ops = await page.getOperatorList();
    const pageResources = page.commonObjs;

    // Collect unique image references
    const imageRefs = new Set();
    for (let i = 0; i < ops.fnArray.length; i++) {
      if (
        ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject ||
        ops.fnArray[i] === pdfjsLib.OPS.paintJpegXObject
      ) {
        const imgName = ops.argsArray[i][0];
        imageRefs.add(imgName);
      }
    }

    // Extract each image
    let imgIndex = 0;
    for (const imgName of imageRefs) {
      try {
        const imgData = await new Promise((resolve, reject) => {
          // Try page objs first, then common objs
          page.objs.get(imgName, (data) => {
            if (data) resolve(data);
            else reject(new Error('No image data'));
          });
        }).catch(() => {
          return new Promise((resolve, reject) => {
            page.commonObjs.get(imgName, (data) => {
              if (data) resolve(data);
              else reject(new Error('No image data in commonObjs'));
            });
          });
        });

        const dataUrl = imageDataToDataURL(imgData);
        if (dataUrl) {
          extractedImages.push({
            dataUrl,
            width: imgData.width,
            height: imgData.height,
            pageNumber: pageNum,
            xObjectRef: imgName,
            index: extractedImages.length,
          });
        }
      } catch (err) {
        console.warn(`Could not extract image ${imgName} from page ${pageNum}:`, err);
      }
      imgIndex++;
    }

    // ── Extract page text items (for label detection) ────────
    try {
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const textItems = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: viewport.height - item.transform[5], // flip Y
        width: item.width,
        height: item.height,
        pageNumber: pageNum,
      }));
      pageTexts.push(...textItems);
    } catch (err) {
      console.warn('Text extraction failed for page', pageNum, err);
    }

    onProgress(50 + Math.round((pageNum / totalPages) * 50));
  }

  // If no images extracted, try rendering pages as fallback
  if (extractedImages.length === 0) {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      extractedImages.push({
        dataUrl: canvas.toDataURL('image/png'),
        width: viewport.width,
        height: viewport.height,
        pageNumber: pageNum,
        xObjectRef: `page_${pageNum}`,
        index: extractedImages.length,
        isPageRender: true,
      });
    }
  }

  return { images: extractedImages, pageTexts, totalPages, pdfName: file.name };
}

/**
 * Convert PDF.js image data object to a data URL, with white background made transparent.
 */
function imageDataToDataURL(imgData) {
  try {
    let width, height, data;

    // Helper to process canvas and remove white background
    const processCanvas = (canvas, ctx) => {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        // If pixel is white or very close to white, make it transparent
        if (px[i] > 240 && px[i+1] > 240 && px[i+2] > 240) {
          px[i+3] = 0; // Alpha to 0
        }
      }
      ctx.putImageData(imageData, 0, 0);
      return canvas.toDataURL('image/png');
    };

    if (imgData instanceof ImageBitmap) {
      // Handle ImageBitmap objects
      const canvas = document.createElement('canvas');
      canvas.width = imgData.width;
      canvas.height = imgData.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgData, 0, 0);
      return processCanvas(canvas, ctx);
    }

    if (imgData.bitmap) {
      // Handle objects with bitmap property
      const canvas = document.createElement('canvas');
      canvas.width = imgData.width;
      canvas.height = imgData.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(imgData.bitmap, 0, 0);
      return processCanvas(canvas, ctx);
    }

    if (imgData.data) {
      width = imgData.width;
      height = imgData.height;
      data = imgData.data;
    } else {
      return null;
    }

    if (!width || !height || !data) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // PDF.js gives us raw RGBA or RGB data
    let imageData;
    if (data.length === width * height * 4) {
      // RGBA
      imageData = new ImageData(new Uint8ClampedArray(data), width, height);
    } else if (data.length === width * height * 3) {
      // RGB → RGBA
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
        rgba[j] = data[i];
        rgba[j + 1] = data[i + 1];
        rgba[j + 2] = data[i + 2];
        rgba[j + 3] = 255;
      }
      imageData = new ImageData(rgba, width, height);
    } else if (data.length === width * height) {
      // Grayscale → RGBA
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i++) {
        rgba[i * 4] = data[i];
        rgba[i * 4 + 1] = data[i];
        rgba[i * 4 + 2] = data[i];
        rgba[i * 4 + 3] = 255;
      }
      imageData = new ImageData(rgba, width, height);
    } else {
      // Try as RGBA anyway
      try {
        imageData = new ImageData(new Uint8ClampedArray(data.buffer || data), width, height);
      } catch {
        return null;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    return processCanvas(canvas, ctx);
  } catch (err) {
    console.warn('imageDataToDataURL failed:', err);
    return null;
  }
}

/**
 * Match text labels to extracted images based on proximity.
 * Labels like "Shape-1" get matched to the nearest image above them.
 */
export function matchLabelsToImages(images, textItems) {
  const labelPattern = /^(Shape[-\s]?\d+|[A-Z]+-\d+)$/i;
  const labels = textItems.filter(t => t.text.trim().length > 0);

  const assignments = new Map(); // imageIndex → { name, labels }

  for (const image of images) {
    // Find text items that could be labels for this image
    const nearbyLabels = labels.filter(label => {
      return label.pageNumber === image.pageNumber;
    });

    // Find the best matching label (usually directly below the image)
    let bestLabel = null;
    let bestScore = Infinity;

    for (const label of nearbyLabels) {
      // Simple proximity heuristic — labels are usually below shapes
      const dist = Math.abs(label.x - image.x || 0) + Math.abs(label.y - image.y || 0);
      if (dist < bestScore && labelPattern.test(label.text.trim())) {
        bestScore = dist;
        bestLabel = label;
      }
    }

    // Also collect non-label text (like "PV-1000") that could be annotations
    const annotations = nearbyLabels
      .filter(l => !labelPattern.test(l.text.trim()) && l.text.trim().length >= 2)
      .map(l => l.text.trim());

    assignments.set(image.index, {
      name: bestLabel ? bestLabel.text.trim() : `Symbol-${image.index + 1}`,
      annotations: [...new Set(annotations)],
    });
  }

  return assignments;
}
