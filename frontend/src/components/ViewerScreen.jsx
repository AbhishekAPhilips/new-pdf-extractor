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
          const viewport = page.getViewport({ scale: 1.5, rotation: page.rotate });
          const canvas = canvasRef.current;
          if (!canvas) return;
          const context = canvas.getContext('2d');
          canvas.height = viewport.height;
          canvas.width = viewport.width;
          const renderContext = { canvasContext: context, viewport: viewport };
          renderTask.current = page.render(renderContext);
          await renderTask.current.promise;
          renderTask.current = null;
        } catch (error) {
          if (error.name !== 'RenderingCancelledException') {
            console.error("Error rendering PDF:", error);
          }
        }
      };
      fileReader.readAsArrayBuffer(file);
    };

    renderPdf();
    
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
    console.log("Original BBox:", bbox);
    console.log("Created Highlight Box:", scaledBbox);
    setHighlightBox(scaledBbox);
  };

  return (
    <div className="viewer-container">
      <div className="left-panel">
        <h2>Extracted Content</h2>

        {extractedData && extractedData.map((item, index) => {
          if (item.type === 'table') {
            return (
              <div key={`item-${index}`} className="table-container">
                <div className="table-header">
                  <span>Table</span>
                  {item.bbox && (
                    <button className="locate-button" onClick={() => handleLocate(item.bbox)}>
                        Locate Table
                    </button>
                  )}
                </div>
                {item.rows.map((row, rowIndex) => (
                  <div key={`row-${rowIndex}`} className="sub-table">
                    <div className="sub-table-header">
                      <span>Row {rowIndex + 1}</span>
                      {row.bbox && (
                           <button className="locate-button" onClick={() => handleLocate(row.bbox)}>
                               Locate Row
                           </button>
                      )}
                    </div>
                    {row.fields.map((field, fieldIndex) => (
                      <div key={`field-${fieldIndex}`} className="data-item sub-table-item">
                        <div className="data-text">{field.text}</div>
                        {field.bbox && (
                            <button className="locate-button" onClick={() => handleLocate(field.bbox)}>
                                Locate
                            </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          } else {
            return (
              <div key={`item-${index}`} className="data-item">
                <div className="data-text">{item.text}</div>
                <button className="locate-button" onClick={() => handleLocate(item.bbox)}>
                  Locate
                </button>
              </div>
            );
          }
        })}
        
        {(!extractedData || extractedData.length === 0) && (
            <p>No content was extracted from the document.</p>
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