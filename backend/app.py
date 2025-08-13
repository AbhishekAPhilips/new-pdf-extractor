import os
import pdfplumber
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

def get_blocks_from_line(line_words, page_width):
    if not line_words: return []
    gap_threshold = page_width * 0.02 
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

@app.route("/api/process-invoice", methods=["POST"])
def process_invoice():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    temp_pdf_path = "temp_invoice.pdf"
    file.save(temp_pdf_path)

    try:
        all_page_elements = []
        with pdfplumber.open(temp_pdf_path) as pdf:
            page = pdf.pages[0]

            table_objects = page.find_tables()
            if table_objects:
                for table in table_objects:
                    table_page = page.crop(table.bbox)
                    table_words = table_page.extract_words(use_text_flow=True)
                    
                    table_lines = {}
                    for word in table_words:
                        line_key = int(word['top'])
                        if line_key not in table_lines: table_lines[line_key] = []
                        table_lines[line_key].append(word)

                    processed_rows = []
                    for key in sorted(table_lines.keys()):
                        line_words = sorted(table_lines[key], key=lambda w: w['x0'])
                        row_blocks_words = get_blocks_from_line(line_words, table_page.width)
                        
                        row_content = []
                        for block_words in row_blocks_words:
                            if not block_words: continue
                            block_text = ' '.join(w['text'] for w in block_words)
                            if block_text.strip():
                                x0 = min(w['x0'] for w in block_words)
                                top = min(w['top'] for w in block_words)
                                x1 = max(w['x1'] for w in block_words)
                                bottom = max(w['bottom'] for w in block_words)
                                row_content.append({"text": block_text, "bbox": [x0, top, x1, bottom]})
                        
                        if row_content:
                            row_x0 = min(item['bbox'][0] for item in row_content)
                            row_top = min(item['bbox'][1] for item in row_content)
                            row_x1 = max(item['bbox'][2] for item in row_content)
                            row_bottom = max(item['bbox'][3] for item in row_content)
                            processed_rows.append({
                                "bbox": [row_x0, row_top, row_x1, row_bottom],
                                "fields": row_content
                            })

                    all_page_elements.append({
                        "type": "table",
                        "bbox": list(table.bbox),
                        "rows": processed_rows
                    })

            table_chars = []
            for table_obj in table_objects:
                table_area = page.crop(table_obj.bbox)
                table_chars.extend(table_area.chars)
            
            all_page_words = page.extract_words()
            word_bbox_tuples = [(word, (word['x0'], word['top'], word['x1'], word['bottom'])) for word in all_page_words]
            non_table_words = [word for word, bbox in word_bbox_tuples if not any(char in table_chars for char in page.crop(bbox).chars)]
            
            lines = {}
            for word in non_table_words:
                line_key = int(word['top'])
                if line_key not in lines: lines[line_key] = []
                lines[line_key].append(word)

            initial_formatted_blocks = []
            for key in sorted(lines.keys()):
                line_words = sorted(lines[key], key=lambda w: w['x0'])
                line_blocks = get_blocks_from_line(line_words, page.width)
                initial_formatted_blocks.extend(line_blocks)
            
            initial_formatted_blocks.sort(key=lambda block: min(w['top'] for w in block))

            final_blocks = []
            i = 0
            while i < len(initial_formatted_blocks):
                current_block = initial_formatted_blocks[i]
                current_text = ' '.join(w['text'] for w in current_block)
                if current_text.strip().endswith(':') and (i + 1) < len(initial_formatted_blocks):
                    next_block = initial_formatted_blocks[i+1]
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
                    all_page_elements.append({"type": "text", "text": block_text, "bbox": [x0, top, x1, bottom]})

            all_page_elements.sort(key=lambda item: item['bbox'][1])

        print(f"Extracted and sorted {len(all_page_elements)} page elements.")
        return jsonify({"extracted_data": all_page_elements})

    except Exception as e:
        print(f"A detailed error occurred:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

if __name__ == "__main__":
    app.run(debug=True, port=5000)
