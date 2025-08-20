import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

function ViewerScreen({ file, extractedData }) {
  const canvasRef = useRef(null);
  const [highlightBox, setHighlightBox] = useState(null);
  
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);

  const pdfDocRef = useRef(null);
  const renderTask = useRef(null);
  const pageRef = useRef(null);

  useEffect(() => {
    if (!file) return;

    const loadPdf = async () => {
      const fileReader = new FileReader();
      fileReader.onload = async function () {
        const typedarray = new Uint8Array(this.result);
        try {
          const pdf = await pdfjsLib.getDocument(typedarray).promise;
          pdfDocRef.current = pdf;
          setNumPages(pdf.numPages);
          setCurrentPage(1);
        } catch (error) {
          console.error("Error loading PDF:", error);
        }
      };
      fileReader.readAsArrayBuffer(file);
    };

    loadPdf();
  }, [file]);

  useEffect(() => {
    if (!pdfDocRef.current || !currentPage) return;

    const renderPage = async () => {
      if (renderTask.current) {
        renderTask.current.cancel();
      }
      setHighlightBox(null);

      try {
        const page = await pdfDocRef.current.getPage(currentPage);
        pageRef.current = page;

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
          console.error("Error rendering page:", error);
        }
      }
    };

    renderPage();
    
    return () => {
      if (renderTask.current) {
        renderTask.current.cancel();
      }
    };
  }, [pdfDocRef.current, currentPage]);


  const handleLocate = (bbox) => {
    const page = pageRef.current;
    const canvas = canvasRef.current;
    if (!bbox || !page || !canvas) return;

    const defaultViewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = canvas.width / defaultViewport.width;
    
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

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, numPages));
  };
  
  const pageData = extractedData ? (extractedData[currentPage] || []) : [];

  return (
    <div className="viewer-container">
      <div className="left-panel">
        <h2>Extracted Content (Page {currentPage})</h2>

        {pageData.length > 0 ? pageData.map((item, index) => {
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
        }) : <p>No content was extracted for this page.</p>}
      </div>
      
      <div className="right-panel">
        <div className="page-controls">
          <button onClick={handlePrevPage} disabled={currentPage <= 1}>
            Previous
          </button>
          <span>Page {currentPage} of {numPages}</span>
          <button onClick={handleNextPage} disabled={currentPage >= numPages}>
            Next
          </button>
        </div>

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