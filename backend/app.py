import os
import pdfplumber
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import defaultdict

app = Flask(__name__)
CORS(app)

def get_blocks_from_line(line_words, page_width):
    if not line_words: return []
    gap_threshold = page_width * 0.01 
    blocks, current_block = [], [line_words[0]]
    for i in range(1, len(line_words)):
        prev_word, current_word = line_words[i-1], line_words[i]
        if (current_word['x0'] - prev_word['x1']) > gap_threshold:
            blocks.append(current_block)
            current_block = [current_word]
        else:
            current_block.append(current_word)
    blocks.append(current_block)
    return blocks

def process_line_as_simple_text(line_blocks, all_elements):
    final_blocks = []
    i = 0
    while i < len(line_blocks):
        current_block = line_blocks[i]
        current_text = ' '.join(w['text'] for w in current_block)
        if current_text.strip().endswith(':') and (i + 1) < len(line_blocks):
            next_block = line_blocks[i+1]
            next_text = ' '.join(w['text'] for w in next_block)
            if not next_text.strip().endswith(':'):
                merged_words = current_block + next_block
                final_blocks.append(merged_words)
                i += 2
                continue
        final_blocks.append(current_block)
        i += 1

    for block_words in final_blocks:
        if not block_words: continue
        block_text = ' '.join(w['text'] for w in block_words)
        if block_text.strip():
            x0 = min(w['x0'] for w in block_words)
            top = min(w['top'] for w in block_words)
            x1 = max(w['x1'] for w in block_words)
            bottom = max(w['bottom'] for w in block_words)
            all_elements.append({"type": "text", "text": block_text, "bbox": [x0, top, x1, bottom]})

def process_line_as_table_row(line_blocks):
    row_content = []
    for block_words in line_blocks:
        if not block_words: continue
        block_text = ' '.join(w['text'] for w in block_words)
        if block_text.strip():
            x0 = min(w['x0'] for w in block_words)
            top = min(w['top'] for w in block_words)
            x1 = max(w['x1'] for w in block_words)
            bottom = max(w['bottom'] for w in block_words)
            row_content.append({"text": block_text, "bbox": [x0, top, x1, bottom]})
    
    if not row_content: return None

    row_x0 = min(item['bbox'][0] for item in row_content)
    row_top = min(item['bbox'][1] for item in row_content)
    row_x1 = max(item['bbox'][2] for item in row_content)
    row_bottom = max(item['bbox'][3] for item in row_content)
    return {
        "bbox": [row_x0, row_top, row_x1, row_bottom],
        "fields": row_content
    }

def merge_shipment_rows(rows):
    if not rows:
        return []

    merged_rows = []
    for row in rows:
        is_primary_row = len(row['fields']) > 2 or (len(row['fields']) > 0 and row['fields'][0]['bbox'][0] < 150)
        is_continuation_row = not is_primary_row and merged_rows

        if is_continuation_row:
            last_row = merged_rows[-1]
            continuation_text = ' '.join(f['text'] for f in row['fields'])
            
            continuation_start_x = row['fields'][0]['bbox'][0]
            target_field_index = -1

            for i, field in enumerate(last_row['fields']):
                if field['bbox'][0] <= continuation_start_x < field['bbox'][2]:
                    target_field_index = i
                    break
            
            if target_field_index == -1:
                max_width = -1
                for i, field in enumerate(last_row['fields']):
                    width = field['bbox'][2] - field['bbox'][0]
                    if width > max_width:
                        max_width = width
                        target_field_index = i
            
            if target_field_index != -1:
                target_field = last_row['fields'][target_field_index]
                target_field['text'] += f"\n{continuation_text}"
                
                new_bbox = [
                    min(target_field['bbox'][0], row['bbox'][0]),
                    target_field['bbox'][1],
                    max(target_field['bbox'][2], row['bbox'][2]),
                    row['bbox'][3]
                ]
                target_field['bbox'] = new_bbox
                
                last_row['bbox'][3] = max(last_row['bbox'][3], row['bbox'][3])
                last_row['bbox'][0] = min(f['bbox'][0] for f in last_row['fields'])
                last_row['bbox'][2] = max(f['bbox'][2] for f in last_row['fields'])
            else:
                merged_rows.append(row)
        else:
            merged_rows.append(row)
    
    return merged_rows

def process_page_sequentially(page):
    TABLE_HEADERS = {
        "shipment_details": ["marks", "numbers", "pieces", "packages", "description", "goods", "weight", "volume"],
        "charges": ["charge", "description", "base", "amount", "rate", "exchange", "invoice", "tax", "code"],
        "tax_summary": ["tax code", "remark", "net amount", "tax amount", "total amount"]
    }
    TABLE_STOPPERS = ["bank information", "co. reg. no.", "total net amount non taxable"]

    all_page_elements = []
    words = [word for word in page.extract_words() if word.get('upright', True)]
    
    lines = defaultdict(list)
    for word in words:
        lines[int(word['top'])].append(word)

    sorted_lines = [sorted(lines[key], key=lambda w: w['x0']) for key in sorted(lines.keys())]

    current_table = None

    for line_words in sorted_lines:
        line_text = ' '.join(w['text'] for w in line_words).lower()
        line_blocks = get_blocks_from_line(line_words, page.width)
        
        matched_header_key = None
        for header_key, keywords in TABLE_HEADERS.items():
            if sum(1 for keyword in keywords if keyword in line_text) >= 4:
                matched_header_key = header_key
                break
        
        is_stopper = any(stopper in line_text for stopper in TABLE_STOPPERS)

        if current_table and (matched_header_key or is_stopper):
            if current_table.get("name") == "shipment_details":
                current_table["rows"] = merge_shipment_rows(current_table["rows"])
            
            if current_table["rows"]:
                current_table['bbox'] = [
                    min(r['bbox'][0] for r in current_table['rows']),
                    min(r['bbox'][1] for r in current_table['rows']),
                    max(r['bbox'][2] for r in current_table['rows']),
                    max(r['bbox'][3] for r in current_table['rows'])
                ]
                all_page_elements.append(current_table)
            current_table = None

        if matched_header_key and current_table is None:
            current_table = {"type": "table", "name": matched_header_key, "rows": []}
            row_data = process_line_as_table_row(line_blocks)
            if row_data:
                current_table["rows"].append(row_data)
        elif current_table and not is_stopper:
            row_data = process_line_as_table_row(line_blocks)
            if row_data:
                current_table["rows"].append(row_data)
        else:
            process_line_as_simple_text(line_blocks, all_page_elements)

    if current_table and current_table['rows']:
        if current_table.get("name") == "shipment_details":
            current_table["rows"] = merge_shipment_rows(current_table["rows"])
        
        current_table['bbox'] = [
            min(r['bbox'][0] for r in current_table['rows']),
            min(r['bbox'][1] for r in current_table['rows']),
            max(r['bbox'][2] for r in current_table['rows']),
            max(r['bbox'][3] for r in current_table['rows'])
        ]
        all_page_elements.append(current_table)
        
    all_page_elements.sort(key=lambda item: item.get('bbox', [0,0,0,0])[1])
    return all_page_elements

@app.route("/api/process-invoice", methods=["POST"])
def process_invoice():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    temp_pdf_path = "temp_invoice.pdf"
    file.save(temp_pdf_path)

    try:
        all_pages_data = {}
        with pdfplumber.open(temp_pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                page_number = i + 1
                all_pages_data[page_number] = process_page_sequentially(page)
        
        return jsonify({"extracted_data": all_pages_data})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

if __name__ == "__main__":
    app.run(debug=True, port=5000)