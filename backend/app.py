import os
import pdfplumber
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# --- HELPER FUNCTIONS ---

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

# --- MAIN PAGE PROCESSING LOGIC ---

def process_page_sequentially(page):
    TABLE_HEADERS = {
        "shipment_details": ["marks", "numbers", "pieces", "packages", "description", "goods", "weight", "volume"],
        "charges": ["charge", "description", "base", "amount", "rate", "exchange", "invoice", "tax", "code"],
        "tax_summary": ["tax code", "remark", "net amount", "tax amount", "total amount"]
    }
    TABLE_STOPPERS = ["bank information", "co. reg. no.", "total net amount non taxable"]

    all_page_elements = []
    words = [word for word in page.extract_words() if word.get('upright', True)]
    
    lines = {}
    for word in words:
        line_key = int(word['top'])
        if line_key not in lines: lines[line_key] = []
        lines[line_key].append(word)

    sorted_lines = [sorted(lines[key], key=lambda w: w['x0']) for key in sorted(lines.keys())]

    current_table = None
    last_row_bottom = 0

    for line_words in sorted_lines:
        line_text = ' '.join(w['text'] for w in line_words).lower()
        line_blocks = get_blocks_from_line(line_words, page.width)
        current_row_top = min(w['top'] for w in line_words) if line_words else 0

        end_table = False
        if current_table:
            if any(stopper in line_text for stopper in TABLE_STOPPERS):
                end_table = True
            
            # Use a vertical gap to detect the end of a table
            if (current_row_top - last_row_bottom) > 15: # A gap of 15 points
                end_table = True

        if end_table:
            table_x0 = min(r['bbox'][0] for r in current_table['rows'])
            table_top = min(r['bbox'][1] for r in current_table['rows'])
            table_x1 = max(r['bbox'][2] for r in current_table['rows'])
            table_bottom = max(r['bbox'][3] for r in current_table['rows'])
            current_table['bbox'] = [table_x0, table_top, table_x1, table_bottom]
            all_page_elements.append(current_table)
            current_table = None

        if current_table:
            row_data = process_line_as_table_row(line_blocks)
            if row_data:
                first_field_x0 = row_data["fields"][0]["bbox"][0] if row_data["fields"] else 0
                # If a line starts far to the right, merge it with the previous row's description
                if current_table["name"] == "shipment_details" and first_field_x0 > 200 and current_table["rows"]:
                    last_row = current_table["rows"][-1]
                    # Find the description field to merge into (usually the 4th one)
                    desc_field_index = 3 
                    if len(last_row["fields"]) > desc_field_index:
                        merged_text = ' '.join(f["text"] for f in row_data["fields"])
                        last_row["fields"][desc_field_index]["text"] += f" {merged_text}"
                        # Update bbox of the last row to include the new line
                        last_row["bbox"][3] = row_data["bbox"][3]
                        last_row_bottom = row_data["bbox"][3]
                else:
                    current_table["rows"].append(row_data)
                    last_row_bottom = row_data["bbox"][3]
            continue

        matched_header = None
        for header_key, keywords in TABLE_HEADERS.items():
            if sum(1 for keyword in keywords if keyword in line_text) >= 5:
                matched_header = header_key
                break
        
        if matched_header:
            current_table = {"type": "table", "name": matched_header, "rows": []}
            row_data = process_line_as_table_row(line_blocks)
            if row_data:
                current_table["rows"].append(row_data)
                last_row_bottom = row_data["bbox"][3]
        else:
            process_line_as_simple_text(line_blocks, all_page_elements)

    if current_table and current_table['rows']:
        table_x0 = min(r['bbox'][0] for r in current_table['rows'])
        table_top = min(r['bbox'][1] for r in current_table['rows'])
        table_x1 = max(r['bbox'][2] for r in current_table['rows'])
        table_bottom = max(r['bbox'][3] for r in current_table['rows'])
        current_table['bbox'] = [table_x0, table_top, table_x1, table_bottom]
        all_page_elements.append(current_table)
        
    all_page_elements.sort(key=lambda item: item['bbox'][1])
    return all_page_elements

# --- FLASK ROUTE ---

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