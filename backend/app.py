import os
import pdfplumber
from flask import Flask, request, jsonify
from flask_cors import CORS

# --- INITIALIZATION ---
app = Flask(__name__)
CORS(app)

# --- API ENDPOINT ---
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
            page = pdf.pages[0]
            
            # --- NEW "NATURAL READING ORDER" LOGIC ---

            # 1. Extract all words with their coordinates.
            words = page.extract_words(x_tolerance=2, y_tolerance=2, use_text_flow=True)

            # 2. Group words into lines based on vertical position.
            lines = {}
            for word in words:
                # Group words by their vertical midpoint
                line_key = round(word['top'])
                if not line_key in lines:
                    lines[line_key] = []
                lines[line_key].append(word)

            # 3. Process each line to create text blocks based on horizontal gaps.
            all_blocks = []
            for line_key in sorted(lines.keys()):
                line_words = sorted(lines[line_key], key=lambda w: w['x0']) # Sort words on the line
                
                if not line_words:
                    continue

                # Calculate the average width of a space character on this line
                space_width_threshold = 5 # Default threshold
                if len(line_words) > 1:
                    gaps = [line_words[i]['x0'] - line_words[i-1]['x1'] for i in range(1, len(line_words))]
                    if gaps:
                        # A reasonable threshold for a column break is 2x the median gap
                        space_width_threshold = sorted(gaps)[len(gaps)//2] * 2
                        space_width_threshold = max(5, space_width_threshold) # Ensure a minimum gap

                # Group words on the same line into blocks
                current_block = [line_words[0]]
                for i in range(1, len(line_words)):
                    prev_word = line_words[i-1]
                    current_word = line_words[i]
                    # If the gap is too large, start a new block
                    if (current_word['x0'] - prev_word['x1']) > space_width_threshold:
                        all_blocks.append(current_block)
                        current_block = [current_word]
                    else:
                        current_block.append(current_word)
                all_blocks.append(current_block)

            # 4. Format the final data for the frontend
            for block in all_blocks:
                if not block: continue
                
                block_text = ' '.join(w['text'] for w in block)
                
                x0 = min(w['x0'] for w in block)
                top = min(w['top'] for w in block)
                x1 = max(w['x1'] for w in block)
                bottom = max(w['bottom'] for w in block)
                
                final_data.append({
                    "text": block_text,
                    "bbox": [x0, top, x1, bottom]
                })
        
        print(f"Extracted {len(final_data)} text blocks in natural reading order.")
        return jsonify({"extracted_data": final_data})

    except Exception as e:
        print(f"An error occurred: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

if __name__ == "__main__":
    app.run(debug=True, port=5000)