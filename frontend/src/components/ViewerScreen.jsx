import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

function ViewerScreen({ file, extractedData }) {
  const canvasRef = useRef(null);
  const pdfPageRef = useRef(null);
  const [highlightBox, setHighlightBox] = useState(null);
  const renderTask = useRef(null); 

  useEffect(() => {
    if (!file) return;

    const renderPdf = async () => {
      if (renderTask.current) {
        renderTask.current.cancel();
      }

      const fileReader = new FileReader();
      fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          const page = await pdf.getPage(1);
          pdfPageRef.current = page;

          // --- FIX 2: Apply page rotation for correct display ---
          const viewport = page.getViewport({ scale: 1.5, rotation: page.rotate });
          
          const canvas = canvasRef.current;
          if (!canvas) return;
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;

          const renderContext = {
            canvasContext: context,
            viewport: viewport,
          };
          
          // Store the new render task
          renderTask.current = page.render(renderContext);
          await renderTask.current.promise;
          renderTask.current = null; // Clear the task when done

        } catch (error) {
          if (error.name !== 'RenderingCancelledException') {
            console.error("Error rendering PDF:", error);
          }
        }
      };
      fileReader.readAsArrayBuffer(file);
    };

    renderPdf();
    
    // Cleanup function to cancel render task if the component unmounts
    return () => {
        if (renderTask.current) {
            renderTask.current.cancel();
        }
    };
  }, [file]);

  const handleLocate = (bbox) => {
    const page = pdfPageRef.current;
    const canvas = canvasRef.current;
    if (!bbox || !page || !canvas) return;

    const viewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = canvas.width / viewport.width;

    const scaledBbox = {
      left: bbox[0] * scale,
      top: bbox[1] * scale,
      width: (bbox[2] - bbox[0]) * scale,
      height: (bbox[3] - bbox[1]) * scale,
    };
    
    console.log("Highlighting at:", scaledBbox);
    setHighlightBox(scaledBbox);
  };

  return (
    <div className="viewer-container">
      <div className="left-panel">
        <h2>Extracted Text Blocks</h2>
        {extractedData && extractedData.length > 0 ? (
          extractedData.map((item, index) => (
            <div key={index} className="data-item">
              <div className="data-text">{item.text}</div>
              <button className="locate-button" onClick={() => handleLocate(item.bbox)}>
                Locate
              </button>
            </div>
          ))
        ) : (
          <p>No text was extracted from the document.</p>
        )}
      </div>
      <div className="right-panel">
        <div className="pdf-canvas-container">
          <canvas ref={canvasRef}></canvas>
          {highlightBox && (
            <div
              className="highlight-box"
              style={{
                left: `${highlightBox.left}px`,
                top: `${highlightBox.top}px`,
                width: `${highlightBox.width}px`,
                height: `${highlightBox.height}px`,
              }}
            ></div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ViewerScreen;