import os
import pdfplumber
import traceback
from flask import Flask, request, jsonify
from flask_cors import CORS

# Initialize the Flask web application and enable Cross-Origin Resource Sharing (CORS)
app = Flask(__name__)
CORS(app)

# This function takes a single line of words and splits it into multiple text blocks
# if it detects a large horizontal gap between words, which typically indicates a column.
def get_blocks_from_line(line_words, page_width):
    if not line_words: return []
    # A gap of 2% of the page width is a reasonable threshold for a column break.
    gap_threshold = page_width * 0.02
    blocks, current_block = [], [line_words[0]]
    for i in range(1, len(line_words)):
        prev_word, current_word = line_words[i-1], line_words[i]
        # If the gap between words is larger than the threshold, start a new block.
        if (current_word['x0'] - prev_word['x1']) > gap_threshold:
            blocks.append(current_block)
            current_block = [current_word]
        else:
            current_block.append(current_word)
    blocks.append(current_block)
    return blocks

# This is the main API endpoint that the frontend calls.
# It accepts a POST request with the uploaded PDF file.
@app.route("/api/process-invoice", methods=["POST"])
def process_invoice():
    # Handle the file upload and save it temporarily.
    if 'file' not in request.files:
        return jsonify({"error": "No file uploaded"}), 400

    file = request.files['file']
    temp_pdf_path = "temp_invoice.pdf"
    file.save(temp_pdf_path)

    try:
        initial_formatted_blocks = []
        with pdfplumber.open(temp_pdf_path) as pdf:
            page = pdf.pages[0]

            # Extract all words from the page. This will only get horizontal words by default.
            all_words = page.extract_words(x_tolerance=2, y_tolerance=2, use_text_flow=True)

            # Group horizontal words into lines.
            lines = {}
            for word in all_words:
                line_key = int(word['top'])
                if line_key not in lines: lines[line_key] = []
                lines[line_key].append(word)

            # Process each line to create initial text blocks, respecting columns.
            for key in sorted(lines.keys()):
                line_words = sorted(lines[key], key=lambda w: w['x0'])
                line_blocks = get_blocks_from_line(line_words, page.width)
                initial_formatted_blocks.extend(line_blocks)

            # Sort all blocks by their top position for a natural reading order.
            initial_formatted_blocks.sort(key=lambda block: min(w['top'] for w in block))

            # Post-processing step to intelligently merge "label: value" pairs.
            final_blocks = []
            i = 0
            while i < len(initial_formatted_blocks):
                current_block = initial_formatted_blocks[i]
                current_text = ' '.join(w['text'] for w in current_block)

                # If a block is a label (ends with ':') and has a value next to it...
                if current_text.strip().endswith(':') and (i + 1) < len(initial_formatted_blocks):
                    next_block = initial_formatted_blocks[i+1]
                    next_text = ' '.join(w['text'] for w in next_block)

                    # ...and the next block is a value (doesn't end with ':')...
                    if not next_text.strip().endswith(':'):
                        # ...then merge them into a single block.
                        merged_words = current_block + next_block
                        final_blocks.append(merged_words)
                        i += 2 # Skip both blocks.
                        continue

                # Otherwise, add the block as is.
                final_blocks.append(current_block)
                i += 1

            # Format the final list of blocks into the JSON structure for the frontend.
            final_data = []
            for block_words in final_blocks:
                if not block_words: continue
                block_text = ' '.join(w['text'] for w in block_words)

                # Filter out any blocks that are empty.
                if block_text.strip():
                    # Calculate a single bounding box for the entire block.
                    x0 = min(w['x0'] for w in block_words)
                    top = min(w['top'] for w in block_words)
                    x1 = max(w['x1'] for w in block_words)
                    bottom = max(w['bottom'] for w in block_words)
                    final_data.append({
                        "text": block_text,
                        "bbox": [x0, top, x1, bottom]
                    })

        print(f"Extracted and cleaned {len(final_data)} final text blocks.")
        # Send the final data back to the frontend.
        return jsonify({"extracted_data": final_data})

    except Exception as e:
        # Handle any errors that occur during processing.
        print(f"A detailed error occurred:")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        # Clean up by deleting the temporary PDF file.
        if os.path.exists(temp_pdf_path):
            os.remove(temp_pdf_path)

# This block runs the Flask development server when the script is executed.
if __name__ == "__main__":
    app.run(debug=True, port=5000)