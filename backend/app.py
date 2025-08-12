import os
import pdfplumber
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- INITIALIZATION ---
app = Flask(__name__)
CORS(app)

# --- HELPER FUNCTIONS ---
def get_blocks_from_line(line_words, page_width):
    """Splits a single line of words into multiple blocks based on horizontal gaps."""
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

def build_words_from_chars(chars):
    """Manually builds word objects from a list of character objects."""
    words = []
    if not chars: return words
    current_word_chars = [chars[0]]
    for char in chars[1:]:
        last_char = current_word_chars[-1]
        if (char['x0'] - last_char['x1'] < 2 and 
            abs(char['top'] - last_char['top']) < 2 and
            char['writing_mode'] == last_char['writing_mode']):
            current_word_chars.append(char)
        else:
            text = "".join(c['text'] for c in current_word_chars)
            words.append({
                "text": text,
                "x0": min(c['x0'] for c in current_word_chars),
                "top": min(c['top'] for c in current_word_chars),
                "x1": max(c['x1'] for c in current_word_chars),
                "bottom": max(c['bottom'] for c in current_word_chars),
                "writing_mode": current_word_chars[0]['writing_mode']
            })
            current_word_chars = [char]
    text = "".join(c['text'] for c in current_word_chars)
    words.append({
        "text": text,
        "x0": min(c['x0'] for c in current_word_chars),
        "top": min(c['top'] for c in current_word_chars),
        "x1": max(c['x1'] for c in current_word_chars),
        "bottom": max(c['bottom'] for c in current_word_chars),
        "writing_mode": current_word_chars[0]['writing_mode']
    })
    return words

# --- API ENDPOINT ---
@app.route("/api/process-invoice", methods=["POST"])
def process_invoice():
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    temp_pdf_path = "temp_invoice.pdf"
    file.save(temp_pdf_path)

    try:
        initial_formatted_blocks = []
        with pdfplumber.open(temp_pdf_path) as pdf:
            page = pdf.pages[0]
            
            chars = page.chars
            for char in chars:
                if "writing_mode" not in char:
                    char["writing_mode"] = "lr"
            all_words = build_words_from_chars(chars)
            horizontal_words = [w for w in all_words if w["writing_mode"] == "lr"]
            vertical_words = [w for w in all_words if w["writing_mode"] == "tb"]

            lines = {}
            for word in horizontal_words:
                line_key = int(word['top'])
                if line_key not in lines: lines[line_key] = []
                lines[line_key].append(word)

            horizontal_blocks = []
            for key in sorted(lines.keys()):
                line_words = sorted(lines[key], key=lambda w: w['x0'])
                line_blocks = get_blocks_from_line(line_words, page.width)
                horizontal_blocks.extend(line_blocks)
            
            initial_formatted_blocks.extend(horizontal_blocks)
            if vertical_words:
                vertical_words.sort(key=lambda w: w['top'])
                initial_formatted_blocks.append(vertical_words)
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

            final_data = []
            for block_words in final_blocks:
                if not block_words: continue
                block_text = ' '.join(w['text'] for w in block_words)
                
                # --- THIS IS THE FIX ---
                # Only add the block if its text is not empty after stripping whitespace.
                if block_text.strip():
                    x0 = min(w['x0'] for w in block_words)
                    top = min(w['top'] for w in block_words)
                    x1 = max(w['x1'] for w in block_words)
                    bottom = max(w['bottom'] for w in block_words)
                    final_data.append({
                        "text": block_text,
                        "bbox": [x0, top, x1, bottom]
                    })
        
        print(f"Extracted and cleaned {len(final_data)} final text blocks.")
        return jsonify({"extracted_data": final_data})

    except Exception as e:
        print(f"A detailed error occurred:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

if __name__ == "__main__":
    app.run(debug=True, port=5000)