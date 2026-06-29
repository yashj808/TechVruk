"""
Symbex Local Extraction Server
Runs on http://localhost:5050/extract
Accepts PDF uploads, extracts all shapes using PyMuPDF, returns JSON.
"""
import fitz  # PyMuPDF
import json
import base64
import os
import re
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


def group_drawing_rects(rects, threshold=15):
    """Group drawing bounding boxes by proximity."""
    groups = []
    for r in rects:
        rect = fitz.Rect(r)
        if rect.width < 3 and rect.height < 3:
            continue

        merged = False
        for i, group in enumerate(groups):
            expanded = fitz.Rect(
                group.x0 - threshold, group.y0 - threshold,
                group.x1 + threshold, group.y1 + threshold
            )
            if expanded.intersects(rect):
                groups[i] = group | rect
                merged = True
                break

        if not merged:
            groups.append(rect)

    changed = True
    while changed:
        changed = False
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                r1 = groups[i]
                r2 = groups[j]
                exp1 = fitz.Rect(
                    r1.x0 - threshold, r1.y0 - threshold,
                    r1.x1 + threshold, r1.y1 + threshold
                )
                if exp1.intersects(r2):
                    groups[i] = r1 | r2
                    groups.pop(j)
                    changed = True
                    break
            if changed:
                break

    return groups


def extract_symbols_from_bytes(pdf_bytes, pdf_name="upload.pdf"):
    """Extract all shapes from PDF bytes using PyMuPDF."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    symbols = []
    label_pattern = re.compile(r'^(Shape[-\s]?\d+|[A-Z]+-\d+)$', re.IGNORECASE)

    for page_num, page in enumerate(doc, start=1):
        page_w = page.rect.width
        page_h = page.rect.height

        # ── Raster images ──────────────────────────────────────
        image_list = page.get_images(full=True)
        image_info_list = page.get_image_info()
        image_rects = []

        for img_idx, img_tuple in enumerate(image_list):
            xref = img_tuple[0]
            if img_idx >= len(image_info_list):
                continue

            bbox = fitz.Rect(image_info_list[img_idx]["bbox"])
            if bbox.width > page_w * 0.8 and bbox.height > page_h * 0.8:
                continue

            image_rects.append(bbox)

            try:
                matrix = fitz.Matrix(3.0, 3.0)
                padding = 2
                clip = fitz.Rect(
                    bbox.x0 - padding, bbox.y0 - padding,
                    bbox.x1 + padding, bbox.y1 + padding
                ) & page.rect
                pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=True)
                png_bytes = pix.tobytes("png")

                base64_data = base64.b64encode(png_bytes).decode('utf-8')
                data_url = f"data:image/png;base64,{base64_data}"

                symbols.append({
                    "id": f"sym_{uuid.uuid4().hex[:8]}",
                    "name": f"Symbol-{len(symbols) + 1}",
                    "source": {
                        "pdfName": pdf_name,
                        "pageNumber": page_num,
                        "xObjectRef": f"xref_{xref}",
                        "originalWidth": round(bbox.width),
                        "originalHeight": round(bbox.height),
                        "type": "raster"
                    },
                    "canvas": {
                        "x": round(bbox.x0),
                        "y": round(bbox.y0),
                        "width": round(bbox.width),
                        "height": round(bbox.height),
                        "rotation": 0,
                        "scaleX": 1.0,
                        "scaleY": 1.0
                    },
                    "imageDataUrl": data_url,
                    "properties": [],
                    "createdAt": datetime.now().isoformat(),
                    "updatedAt": datetime.now().isoformat()
                })
            except Exception:
                pass

        # ── Vector drawings ────────────────────────────────────
        drawings = page.get_drawings()
        drawing_rects = []
        for d in drawings:
            r = fitz.Rect(d["rect"])
            if r.width > page_w * 0.8 and r.height > page_h * 0.8:
                continue
            if r.width < 1 or r.height < 1:
                continue

            overlaps_image = False
            for img_rect in image_rects:
                expanded_img = fitz.Rect(
                    img_rect.x0 - 5, img_rect.y0 - 5,
                    img_rect.x1 + 5, img_rect.y1 + 5
                )
                if expanded_img.contains(r):
                    overlaps_image = True
                    break
            if overlaps_image:
                continue

            drawing_rects.append(r)

        grouped = group_drawing_rects(drawing_rects, threshold=12)

        for idx, rect in enumerate(grouped):
            if rect.width < 15 or rect.height < 15:
                continue

            padding = 4
            clip = fitz.Rect(
                rect.x0 - padding, rect.y0 - padding,
                rect.x1 + padding, rect.y1 + padding
            ) & page.rect

            if clip.is_empty or clip.width < 10 or clip.height < 10:
                continue

            matrix = fitz.Matrix(3.0, 3.0)
            pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=True)
            png_bytes = pix.tobytes("png")

            base64_data = base64.b64encode(png_bytes).decode('utf-8')
            data_url = f"data:image/png;base64,{base64_data}"

            symbols.append({
                "id": f"sym_{uuid.uuid4().hex[:8]}",
                "name": f"Symbol-{len(symbols) + 1}",
                "source": {
                    "pdfName": pdf_name,
                    "pageNumber": page_num,
                    "xObjectRef": f"pymupdf_vec_{page_num}_{idx}",
                    "originalWidth": round(clip.width),
                    "originalHeight": round(clip.height),
                    "type": "vector"
                },
                "canvas": {
                    "x": round(clip.x0),
                    "y": round(clip.y0),
                    "width": round(clip.width),
                    "height": round(clip.height),
                    "rotation": 0,
                    "scaleX": 1.0,
                    "scaleY": 1.0
                },
                "imageDataUrl": data_url,
                "properties": [],
                "createdAt": datetime.now().isoformat(),
                "updatedAt": datetime.now().isoformat()
            })

        # ── Label mapping ──────────────────────────────────────
        text_dict = page.get_text("dict")
        text_items = []
        for block in text_dict["blocks"]:
            if block["type"] != 0:
                continue
            for line in block["lines"]:
                for span in line["spans"]:
                    text = span["text"].strip()
                    if text:
                        r = fitz.Rect(span["bbox"])
                        text_items.append({
                            "text": text,
                            "cx": (r.x0 + r.x1) / 2,
                            "cy": (r.y0 + r.y1) / 2,
                        })

        page_symbols = [s for s in symbols if s["source"]["pageNumber"] == page_num]
        used_labels = set()

        for sym in page_symbols:
            c = sym["canvas"]
            sym_cx = c["x"] + c["width"] / 2
            sym_cy = c["y"] + c["height"] / 2

            best_label = None
            best_dist = float('inf')
            best_annotation = None
            best_ann_dist = float('inf')

            for item in text_items:
                dist = ((sym_cx - item["cx"]) ** 2 + (sym_cy - item["cy"]) ** 2) ** 0.5

                if label_pattern.match(item["text"]):
                    if dist < best_dist and item["text"] not in used_labels:
                        best_dist = dist
                        best_label = item["text"]
                else:
                    if dist < best_ann_dist and dist < 100:
                        best_ann_dist = dist
                        best_annotation = item["text"]

            if best_label:
                sym["name"] = best_label
                used_labels.add(best_label)

            if best_annotation:
                sym["properties"] = [{
                    "key": "label",
                    "value": best_annotation,
                    "type": "text"
                }]

    doc.close()
    return symbols


@app.route("/extract", methods=["POST"])
def extract():
    """Accept a PDF file upload and return extracted symbols as JSON."""
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files["file"]
    pdf_bytes = file.read()
    pdf_name = file.filename or "upload.pdf"

    print(f"Received PDF: {pdf_name} ({len(pdf_bytes)} bytes)")

    try:
        symbols = extract_symbols_from_bytes(pdf_bytes, pdf_name)
        print(f"Extracted {len(symbols)} symbols")
        return jsonify({
            "success": True,
            "symbols": symbols,
            "pdfName": pdf_name,
            "totalSymbols": len(symbols)
        })
    except Exception as e:
        print(f"Extraction error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "engine": "PyMuPDF"})


if __name__ == "__main__":
    print("=" * 50)
    print("Symbex Extraction Server (PyMuPDF)")
    print("Listening on http://localhost:5050")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5050, debug=False)
