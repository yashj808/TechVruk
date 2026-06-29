import fitz  # PyMuPDF
import json
import base64
import os
import re
import sys
import uuid
from datetime import datetime

def group_rects(rects, threshold=20):
    """
    Groups a list of fitz.Rect objects by proximity.
    Combines overlapping or close bounding boxes.
    """
    grouped = []
    for r in rects:
        rect = fitz.Rect(r)
        
        # Don't group extremely small or invalid rects
        if rect.is_empty or rect.width < 5 or rect.height < 5:
            continue
            
        merged = False
        for i, group in enumerate(grouped):
            # Inflate the group bounds to check proximity
            expanded = fitz.Rect(group.x0 - threshold, group.y0 - threshold, group.x1 + threshold, group.y1 + threshold)
            if expanded.intersects(rect):
                grouped[i] = group | rect
                merged = True
                break
                
        if not merged:
            grouped.append(rect)
            
    # Iteratively merge groups that now overlap
    still_merging = True
    while still_merging:
        still_merging = False
        for i in range(len(grouped)):
            for j in range(i + 1, len(grouped)):
                r1 = grouped[i]
                r2 = grouped[j]
                expanded1 = fitz.Rect(r1.x0 - threshold, r1.y0 - threshold, r1.x1 + threshold, r1.y1 + threshold)
                if expanded1.intersects(r2):
                    grouped[i] = r1 | r2
                    grouped.pop(j)
                    still_merging = True
                    break
            if still_merging:
                break
                
    return grouped

def extract_pdf_symbols(pdf_path, output_json_path):
    print(f"Opening PDF: {pdf_path}")
    doc = fitz.open(pdf_path)
    pdf_name = os.path.basename(pdf_path)
    
    symbols = []
    
    label_pattern = re.compile(r'^(Shape[-\s]?\d+|[A-Z]+-\d+)$', re.IGNORECASE)

    for page_num, page in enumerate(doc, start=1):
        print(f"Processing Page {page_num}...")
        
        # 1. Collect all vector drawing bounding boxes (filter out page-sized backgrounds)
        drawings = page.get_drawings()
        print(f"Total drawings found: {len(drawings)}")
        rects = []
        for draw in drawings:
            r = fitz.Rect(draw["rect"])
            if r.width < page.rect.width * 0.85 and r.height < page.rect.height * 0.85:
                rects.append(r)
        
        # 2. Collect all raster image bounding boxes
        image_info = page.get_image_info()
        print(f"Total images found: {len(image_info)}")
        for img in image_info:
            r = fitz.Rect(img["bbox"])
            if r.width < page.rect.width * 0.85 and r.height < page.rect.height * 0.85:
                rects.append(r)
        
        # 3. Group drawing components by proximity
        grouped_rects = group_rects(rects, threshold=20)
        print(f"All raw rects: {rects}")
        print(f"Found {len(grouped_rects)} distinct shapes visually.")
        
        # 4. Extract text blocks for proximity label mapping
        text_blocks = page.get_text("blocks")
        text_items = []
        for block in text_blocks:
            x0, y0, x1, y1, text, block_no, block_type = block
            clean_text = text.strip()
            if clean_text:
                text_items.append({
                    "text": clean_text,
                    "rect": fitz.Rect(x0, y0, x1, y1)
                })
                
        # 5. Crop each shape, render with transparency, and map labels
        for idx, rect in enumerate(grouped_rects):
            # Skip if box takes up the whole page (e.g. background/border)
            if rect.width > page.rect.width * 0.95 and rect.height > page.rect.height * 0.95:
                continue
                
            # Add padding
            padding = 4
            padded_rect = fitz.Rect(rect.x0 - padding, rect.y0 - padding, rect.x1 + padding, rect.y1 + padding)
            # Clip to page boundaries
            padded_rect = padded_rect & page.rect
            
            if padded_rect.is_empty or padded_rect.width < 10 or padded_rect.height < 10:
                continue
                
            # Render region to transparent high-res PNG (3.0 zoom factor)
            matrix = fitz.Matrix(3.0, 3.0)
            pix = page.get_pixmap(matrix=matrix, clip=padded_rect, alpha=True)
            png_bytes = pix.tobytes("png")
            
            # Base64 encode for embedded JSON compatibility
            base64_data = base64.b64encode(png_bytes).decode('utf-8')
            image_data_url = f"data:image/png;base64,{base64_data}"
            
            # Map nearest label
            best_label = None
            best_dist = float('inf')
            annotations = []
            
            # Center of current shape
            shape_center = rect.br + rect.tl
            shape_center = shape_center / 2
            
            for item in text_items:
                item_center = item["rect"].br + item["rect"].tl
                item_center = item_center / 2
                
                # Proximity distance
                dist = shape_center.distance_to(item_center)
                
                if label_pattern.match(item["text"]):
                    if dist < best_dist:
                        best_dist = dist
                        best_label = item["text"]
                else:
                    if dist < 120 and len(item["text"]) >= 2:
                        annotations.append(item["text"])
            
            symbol_name = best_label if best_label else f"Symbol-{len(symbols) + 1}"
            
            properties = []
            if annotations:
                # Add closest annotations as custom properties
                properties.append({
                    "key": "label",
                    "value": annotations[0],
                    "type": "text"
                })
                
            symbols.append({
                "id": f"sym_{uuid.uuid4().hex[:8]}",
                "name": symbol_name,
                "source": {
                    "pdfName": pdf_name,
                    "pageNumber": page_num,
                    "xObjectRef": f"pymupdf_{page_num}_{idx}",
                    "originalWidth": round(padded_rect.width),
                    "originalHeight": round(padded_rect.height)
                },
                "canvas": {
                    "x": round(padded_rect.x0),
                    "y": round(padded_rect.y0),
                    "width": round(padded_rect.width),
                    "height": round(padded_rect.height),
                    "rotation": 0,
                    "scaleX": 1.0,
                    "scaleY": 1.0
                },
                "imageDataUrl": image_data_url,
                "properties": properties,
                "createdAt": datetime.now().isoformat(),
                "updatedAt": datetime.now().isoformat()
            })
            
    # Build complete Symbex project state
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
    
    # Save file
    with open(output_json_path, 'w', encoding='utf-8') as f:
        json.dump(project_state, f, indent=2, ensure_ascii=False)
        
    print(f"Successfully extracted {len(symbols)} symbols!")
    print(f"Project saved to: {output_json_path}")
    print("You can now import this file directly into the Symbex web application.")

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
