"""
PyMuPDF Shape Extractor for Symbex — v2
Extracts all individual shapes from engineering PDFs using:
  1. Raster images via page.get_images() for high-quality XObject extraction
  2. Vector drawings via page.get_drawings() grouped by proximity
  3. Text labels matched to nearest shape by proximity
Outputs a .symbex.json project file + individual PNGs for verification.
"""
import fitz  # PyMuPDF
import json
import base64
import os
import re
import sys
import uuid
from datetime import datetime


def group_drawing_rects(rects, threshold=15):
    """
    Groups drawing bounding boxes by proximity.
    Uses a smaller threshold to avoid merging distinct shapes.
    """
    groups = []
    for r in rects:
        rect = fitz.Rect(r)
        # Skip zero-width lines (they are connectors/leader lines between shapes)
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

    # Iteratively merge groups that became overlapping after expansion
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


def extract_pdf_symbols(pdf_path, output_json_path):
    print(f"Opening PDF: {pdf_path}")
    doc = fitz.open(pdf_path)
    pdf_name = os.path.basename(pdf_path)

    # Create debug output directory for individual PNGs
    debug_dir = os.path.join(os.path.dirname(output_json_path) or ".", "extracted_shapes")
    os.makedirs(debug_dir, exist_ok=True)

    symbols = []
    label_pattern = re.compile(r'^(Shape[-\s]?\d+|[A-Z]+-\d+)$', re.IGNORECASE)

    for page_num, page in enumerate(doc, start=1):
        print(f"\n{'='*60}")
        print(f"Processing Page {page_num}  (size: {page.rect.width:.0f} x {page.rect.height:.0f})")
        print(f"{'='*60}")

        page_w = page.rect.width
        page_h = page.rect.height

        # ────────────────────────────────────────────────────────
        # STEP 1: Extract raster images directly via XObject refs
        # ────────────────────────────────────────────────────────
        image_list = page.get_images(full=True)
        image_rects = []  # Track raster image bounding boxes to exclude from drawings
        image_info_list = page.get_image_info()

        print(f"\n  Raster images (XObject): {len(image_list)}")

        for img_idx, img_tuple in enumerate(image_list):
            xref = img_tuple[0]
            # Find the on-page bounding box from image_info
            matching_info = [
                info for info in image_info_list
                if info.get("xref", -1) == xref or img_idx < len(image_info_list)
            ]

            if img_idx < len(image_info_list):
                bbox = fitz.Rect(image_info_list[img_idx]["bbox"])
            else:
                continue

            # Skip page-sized images (backgrounds)
            if bbox.width > page_w * 0.8 and bbox.height > page_h * 0.8:
                print(f"    [img {img_idx}] SKIPPED (page background) {bbox}")
                continue

            image_rects.append(bbox)

            # Extract the actual image bytes via xref
            try:
                base_image = doc.extract_image(xref)
                img_bytes = base_image["image"]
                img_ext = base_image["ext"]

                # If the image is JPEG etc., convert to PNG with transparency
                # by rendering the clipped region instead
                matrix = fitz.Matrix(3.0, 3.0)
                padding = 2
                clip = fitz.Rect(
                    bbox.x0 - padding, bbox.y0 - padding,
                    bbox.x1 + padding, bbox.y1 + padding
                ) & page.rect
                pix = page.get_pixmap(matrix=matrix, clip=clip, alpha=True)
                png_bytes = pix.tobytes("png")

                # Save debug PNG
                debug_filename = f"page{page_num}_img{img_idx}.png"
                debug_path = os.path.join(debug_dir, debug_filename)
                with open(debug_path, "wb") as f:
                    f.write(png_bytes)

                base64_data = base64.b64encode(png_bytes).decode('utf-8')
                data_url = f"data:image/png;base64,{base64_data}"

                print(f"    [img {img_idx}] bbox=({bbox.x0:.0f}, {bbox.y0:.0f}, "
                      f"{bbox.x1:.0f}, {bbox.y1:.0f})  "
                      f"size={bbox.width:.0f}x{bbox.height:.0f}  "
                      f"saved={debug_filename}")

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

            except Exception as e:
                print(f"    [img {img_idx}] FAILED: {e}")

        # ────────────────────────────────────────────────────────
        # STEP 2: Extract vector drawings, excluding regions
        #         already covered by raster images
        # ────────────────────────────────────────────────────────
        drawings = page.get_drawings()
        print(f"\n  Vector drawings: {len(drawings)}")

        drawing_rects = []
        for d in drawings:
            r = fitz.Rect(d["rect"])

            # Skip page-sized borders/backgrounds
            if r.width > page_w * 0.8 and r.height > page_h * 0.8:
                continue

            # Skip zero-area lines (width=0 or height=0)
            # These are typically connector lines between shapes
            if r.width < 1 or r.height < 1:
                continue

            # Skip drawings that fall inside an already-extracted raster image
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

        # Group drawing primitives into distinct shapes
        grouped = group_drawing_rects(drawing_rects, threshold=12)
        print(f"  Grouped into {len(grouped)} distinct vector shapes")

        for idx, rect in enumerate(grouped):
            # Skip anything too small (noise/artifacts)
            if rect.width < 15 or rect.height < 15:
                print(f"    [vec {idx}] SKIPPED (too small) "
                      f"size={rect.width:.0f}x{rect.height:.0f}")
                continue

            # Crop with padding
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

            # Save debug PNG
            debug_filename = f"page{page_num}_vec{idx}.png"
            debug_path = os.path.join(debug_dir, debug_filename)
            with open(debug_path, "wb") as f:
                f.write(png_bytes)

            base64_data = base64.b64encode(png_bytes).decode('utf-8')
            data_url = f"data:image/png;base64,{base64_data}"

            print(f"    [vec {idx}] rect=({rect.x0:.0f}, {rect.y0:.0f}, "
                  f"{rect.x1:.0f}, {rect.y1:.0f})  "
                  f"size={rect.width:.0f}x{rect.height:.0f}  "
                  f"saved={debug_filename}")

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

        # ────────────────────────────────────────────────────────
        # STEP 3: Extract text labels and map to nearest symbol
        # ────────────────────────────────────────────────────────
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
                            "rect": r
                        })

        print(f"\n  Text spans found: {len(text_items)}")

        # Assign labels to symbols on this page
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
                print(f"    '{sym['name']}' -> label matched (dist={best_dist:.0f})")

            if best_annotation:
                sym["properties"] = [{
                    "key": "label",
                    "value": best_annotation,
                    "type": "text"
                }]

    # ────────────────────────────────────────────────────────
    # Build project state
    # ────────────────────────────────────────────────────────
    project_state = {
        "version": "1.0.0",
        "projectName": f"Extracted from {pdf_name}",
        "pdfName": pdf_name,
        "canvasState": {
            "zoom": 1.0,
            "panX": 0.0,
            "panY": 0.0,
            "gridEnabled": True
        },
        "symbols": symbols,
        "savedAt": datetime.now().isoformat()
    }

    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(project_state, f, indent=2, ensure_ascii=False)

    print(f"\n{'='*60}")
    print(f"EXTRACTION COMPLETE")
    print(f"{'='*60}")
    print(f"  Total symbols extracted: {len(symbols)}")
    print(f"  Project file: {output_json_path}")
    print(f"  Debug PNGs:   {debug_dir}/")
    print(f"\nImport the .symbex.json file into the web app to view all shapes.")


if __name__ == "__main__":
    pdf_file = "Code Breaker.pdf"
    output_file = "Code_Breaker_Extracted.symbex.json"

    if len(sys.argv) > 1:
        pdf_file = sys.argv[1]
    if len(sys.argv) > 2:
        output_file = sys.argv[2]

    if not os.path.exists(pdf_file):
        print(f"Error: File '{pdf_file}' not found.")
        sys.exit(1)

    extract_pdf_symbols(pdf_file, output_file)
