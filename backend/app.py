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
            all_elements.append({
                "type": "text", 
                "text": block_text, 
                "left": x0, 
                "top": top, 
                "width": x1 - x0, 
                "height": bottom - top
            })

def process_header_row(line_blocks):
    row_content = []
    for block_words in line_blocks:
        if not block_words: continue
        block_text = ' '.join(w['text'] for w in block_words)
        if block_text.strip():
            x0 = min(w['x0'] for w in block_words)
            top = min(w['top'] for w in block_words)
            x1 = max(w['x1'] for w in block_words)
            bottom = max(w['bottom'] for w in block_words)
            row_content.append({
                "text": block_text, 
                "left": x0, 
                "top": top, 
                "width": x1 - x0, 
                "height": bottom - top
            })
    
    if not row_content: return None

    row_x0 = min(item['left'] for item in row_content)
    row_top = min(item['top'] for item in row_content)
    row_x1 = max(item['left'] + item['width'] for item in row_content)
    row_bottom = max(item['top'] + item['height'] for item in row_content)
    return {
        "left": row_x0,
        "top": row_top,
        "width": row_x1 - row_x0,
        "height": row_bottom - row_top,
        "fields": row_content
    }

def process_data_row_with_boundaries(line_words, column_boundaries, dividers):
    if not column_boundaries:
        return None

    cells_words = [[] for _ in column_boundaries]

    if line_words:
        for word in line_words:
            word_midpoint = (word['x0'] + word['x1']) / 2
            
            cell_index = 0
            for divider in dividers:
                if word_midpoint > divider:
                    cell_index += 1
                else:
                    break
            
            if cell_index < len(cells_words):
                cells_words[cell_index].append(word)

    row_content = []
    line_top = min(w['top'] for w in line_words) if line_words else 0
    line_bottom = max(w['bottom'] for w in line_words) if line_words else 0
    line_height = line_bottom - line_top

    for i, cell_words in enumerate(cells_words):
        if cell_words:
            cell_words.sort(key=lambda w: w['x0'])
            text = ' '.join(w['text'] for w in cell_words)
            x0 = min(w['x0'] for w in cell_words)
            top = min(w['top'] for w in cell_words)
            x1 = max(w['x1'] for w in cell_words)
            bottom = max(w['bottom'] for w in cell_words)
            
            row_content.append({
                "text": text,
                "left": x0,
                "top": top,
                "width": x1 - x0,
                "height": bottom - top
            })
        else:
            boundary = column_boundaries[i]
            row_content.append({
                "text": "",
                "left": boundary['x0'],
                "top": line_top,
                "width": boundary['x1'] - boundary['x0'],
                "height": line_height
            })

    if not any(field['text'] for field in row_content):
        return None

    row_x0 = min(item['left'] for item in row_content)
    row_top = min(item['top'] for item in row_content)
    row_x1 = max(item['left'] + item['width'] for item in row_content)
    row_bottom = max(item['top'] + item['height'] for item in row_content)

    return {
        "left": row_x0,
        "top": row_top,
        "width": row_x1 - row_x0,
        "height": row_bottom - row_top,
        "fields": row_content
    }


def merge_shipment_rows(rows):
    if not rows:
        return []

    merged_rows = []
    for row in rows:
        is_primary_row = len(row['fields']) > 2 or (len(row['fields']) > 0 and row['fields'][0]['text'].strip() != "")
        is_continuation_row = not is_primary_row and merged_rows

        if is_continuation_row:
            last_row = merged_rows[-1]
            
            for i, field in enumerate(row['fields']):
                if field['text'].strip() and i < len(last_row['fields']):
                    target_field = last_row['fields'][i]
                    
                    continuation_text = field['text']
                    
                    if target_field['text'].strip():
                        target_field['text'] += f"\n{continuation_text}"
                    else:
                        target_field['text'] = continuation_text

                    original_field_right = target_field['left'] + target_field['width']
                    continuation_right = field['left'] + field['width']
                    
                    target_field['left'] = min(target_field['left'], field['left'])
                    target_field['width'] = max(original_field_right, continuation_right) - target_field['left']
                    target_field['height'] = (field['top'] + field['height']) - target_field['top']

            last_row['height'] = max(last_row['top'] + last_row['height'], row['top'] + row['height']) - last_row['top']
            last_row['left'] = min(f['left'] for f in last_row['fields'])
            last_row_right = max(f['left'] + f['width'] for f in last_row['fields'])
            last_row['width'] = last_row_right - last_row['left']
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
    words = [word for word in page.extract_words(x_tolerance=1, y_tolerance=1) if word.get('upright', True)]
    
    lines = defaultdict(list)
    for word in words:
        lines[int(word['top'])].append(word)

    sorted_lines = [sorted(lines[key], key=lambda w: w['x0']) for key in sorted(lines.keys())]

    current_table = None
    column_boundaries = []
    dividers = []

    for line_words in sorted_lines:
        line_text = ' '.join(w['text'] for w in line_words).lower()
        
        matched_header_key = None
        for header_key, keywords in TABLE_HEADERS.items():
            if sum(1 for keyword in keywords if keyword in line_text) >= 3:
                matched_header_key = header_key
                break
        
        is_stopper = any(stopper in line_text for stopper in TABLE_STOPPERS)

        if current_table and (matched_header_key or is_stopper):
            if current_table.get("name") == "shipment_details":
                current_table["rows"] = merge_shipment_rows(current_table["rows"])
            
            if current_table["rows"]:
                table_left = min(r['left'] for r in current_table['rows'])
                table_top = min(r['top'] for r in current_table['rows'])
                table_right = max(r['left'] + r['width'] for r in current_table['rows'])
                table_bottom = max(r['top'] + r['height'] for r in current_table['rows'])
                
                current_table['left'] = table_left
                current_table['top'] = table_top
                current_table['width'] = table_right - table_left
                current_table['height'] = table_bottom - table_top
                
                all_page_elements.append(current_table)
            current_table = None
            column_boundaries = []
            dividers = []

        if matched_header_key and current_table is None:
            current_table = {"type": "table", "name": matched_header_key, "rows": []}
            header_blocks = get_blocks_from_line(line_words, page.width)
            column_boundaries = [{'x0': min(w['x0'] for w in b), 'x1': max(w['x1'] for w in b)} for b in header_blocks]
            
            dividers = []
            for i in range(len(column_boundaries) - 1):
                gap_midpoint = (column_boundaries[i]['x1'] + column_boundaries[i+1]['x0']) / 2
                dividers.append(gap_midpoint)

            row_data = process_header_row(header_blocks)
            if row_data:
                current_table["rows"].append(row_data)
        elif current_table and not is_stopper:
            row_data = process_data_row_with_boundaries(line_words, column_boundaries, dividers)
            if row_data:
                current_table["rows"].append(row_data)
        else:
            line_blocks = get_blocks_from_line(line_words, page.width)
            process_line_as_simple_text(line_blocks, all_page_elements)

    if current_table and current_table['rows']:
        if current_table.get("name") == "shipment_details":
            current_table["rows"] = merge_shipment_rows(current_table["rows"])
        
        table_left = min(r['left'] for r in current_table['rows'])
        table_top = min(r['top'] for r in current_table['rows'])
        table_right = max(r['left'] + r['width'] for r in current_table['rows'])
        table_bottom = max(r['top'] + r['height'] for r in current_table['rows'])

        current_table['left'] = table_left
        current_table['top'] = table_top
        current_table['width'] = table_right - table_left
        current_table['height'] = table_bottom - table_top

        all_page_elements.append(current_table)
        
    all_page_elements.sort(key=lambda item: item.get('top', 0))
    return all_page_elements

@app.route("/api/process-invoice", methods=["POST"])
def process_invoice():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    temp_pdf_path = "temp_invoice.pdf"
    file.save(temp_pdf_path)

    try:
        final_data = []
        with pdfplumber.open(temp_pdf_path) as pdf:
            for i, page in enumerate(pdf.pages):
                page_elements = process_page_sequentially(page)
                for element in page_elements:
                    element['pageIndex'] = i
                    final_data.append(element)
        
        return jsonify({"extracted_data": final_data})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
