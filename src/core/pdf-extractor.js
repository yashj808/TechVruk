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
    onProgress(Math.round(progress * 0.4)); // 0–40%: page loading and rendering

    // ── Render Page for Visual Shape Detection ────────────────
    const scale = 2.0;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    // Detect and extract shapes from the rendered canvas
    const detected = extractShapesFromPageCanvas(canvas, pageNum, scale);
    
    // Adjust index offset for globally unique indexing in page assignments
    detected.forEach((img, i) => {
      img.index = extractedImages.length;
      extractedImages.push(img);
    });

    // ── Extract page text items (for label detection) ────────
    try {
      const textContent = await page.getTextContent();
      const vp1 = page.getViewport({ scale: 1 });
      const textItems = textContent.items.map(item => ({
        text: item.str,
        x: item.transform[4],
        y: vp1.height - item.transform[5], // flip Y
        width: item.width,
        height: item.height,
        pageNumber: pageNum,
      }));
      pageTexts.push(...textItems);
    } catch (err) {
      console.warn('Text extraction failed for page', pageNum, err);
    }

    onProgress(40 + Math.round((pageNum / totalPages) * 60));
  }

  // If no shapes were detected visually, fallback to XObject images
  if (extractedImages.length === 0) {
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const ops = await page.getOperatorList();
      const imageRefs = new Set();
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (
          ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject ||
          ops.fnArray[i] === pdfjsLib.OPS.paintJpegXObject ||
          ops.fnArray[i] === pdfjsLib.OPS.paintImageMaskXObject
        ) {
          const imgName = ops.argsArray[i][0];
          imageRefs.add(imgName);
        }
      }

      for (const imgName of imageRefs) {
        try {
          const imgData = await new Promise((resolve, reject) => {
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
          console.warn(`Fallback extraction failed for XObject ${imgName}:`, err);
        }
      }
    }
  }

  // Final fallback: render full pages if still nothing found
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
 * Detects distinct non-white shapes/symbols from the rendered PDF page canvas.
 * Returns an array of cropped image objects with transparent background.
 */
function extractShapesFromPageCanvas(canvas, pageNum, scale = 2.0) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const px = imageData.data;

  // 1. Scan for active non-white pixels
  const points = [];
  const step = 2; // Performance optimization: scan every 2nd pixel
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      const r = px[idx];
      const g = px[idx+1];
      const b = px[idx+2];
      const a = px[idx+3];

      // Pixel is active if it's opaque and not pure/near white
      if ((r < 240 || g < 240 || b < 240) && a > 10) {
        points.push({ x, y });
      }
    }
  }

  // 2. Group points into boxes based on proximity
  const boxes = [];
  const maxDistance = 30; // Max grouping distance (pixels)

  for (const pt of points) {
    let foundBox = null;
    for (const box of boxes) {
      const dx = Math.max(0, box.minX - pt.x, pt.x - box.maxX);
      const dy = Math.max(0, box.minY - pt.y, pt.y - box.maxY);
      if (dx < maxDistance && dy < maxDistance) {
        foundBox = box;
        break;
      }
    }

    if (foundBox) {
      foundBox.minX = Math.min(foundBox.minX, pt.x);
      foundBox.maxX = Math.max(foundBox.maxX, pt.x);
      foundBox.minY = Math.min(foundBox.minY, pt.y);
      foundBox.maxY = Math.max(foundBox.maxY, pt.y);
    } else {
      boxes.push({ minX: pt.x, maxX: pt.x, minY: pt.y, maxY: pt.y });
    }
  }

  // 3. Merge overlapping or very close boxes
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const b1 = boxes[i];
        const b2 = boxes[j];

        const xOverlap = (b1.minX - maxDistance <= b2.maxX && b1.maxX + maxDistance >= b2.minX);
        const yOverlap = (b1.minY - maxDistance <= b2.maxY && b1.maxY + maxDistance >= b2.minY);

        if (xOverlap && yOverlap) {
          b1.minX = Math.min(b1.minX, b2.minX);
          b1.maxX = Math.max(b1.maxX, b2.maxX);
          b1.minY = Math.min(b1.minY, b2.minY);
          b1.maxY = Math.max(b1.maxY, b2.maxY);
          boxes.splice(j, 1);
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }

  // 4. Crop regions, filter background, and yield symbols
  const shapes = [];
  const minSize = 25; // Ignore small noise/dots
  const padding = 8;

  boxes.forEach((box, i) => {
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;

    // Filter out boxes that are too small or encompass the entire page border
    if (w >= minSize && h >= minSize && w < width * 0.95 && h < height * 0.95) {
      const rx = Math.max(0, box.minX - padding);
      const ry = Math.max(0, box.minY - padding);
      const rw = Math.min(width - rx, w + padding * 2);
      const rh = Math.min(height - ry, h + padding * 2);

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = rw;
      cropCanvas.height = rh;
      const cropCtx = cropCanvas.getContext('2d');
      cropCtx.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);

      // Make background transparent (clipart filter)
      const cropImgData = cropCtx.getImageData(0, 0, rw, rh);
      const cPx = cropImgData.data;
      for (let k = 0; k < cPx.length; k += 4) {
        if (cPx[k] > 240 && cPx[k+1] > 240 && cPx[k+2] > 240) {
          cPx[k+3] = 0; // Alpha transparent
        }
      }
      cropCtx.putImageData(cropImgData, 0, 0);

      shapes.push({
        dataUrl: cropCanvas.toDataURL('image/png'),
        width: rw,
        height: rh,
        pageNumber: pageNum,
        xObjectRef: `detected_${pageNum}_${i}`,
        x: rx / scale, // Normalize coordinates to scale 1.0 for label matching
        y: ry / scale,
      });
    }
  });

  return shapes;
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
