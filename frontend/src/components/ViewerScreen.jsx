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
    setHighlightBox(scaledBbox);
  };

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, numPages));
  };
  
  const pageData = extractedData ? (extractedData[currentPage] || []) : [];

  const LocateIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <line x1="12" y1="21" x2="12" y2="15"></line>
      <line x1="12" y1="9" x2="12" y2="3"></line>
      <line x1="21" y1="12" x2="15" y2="12"></line>
      <line x1="9" y1="12" x2="3" y2="12"></line>
    </svg>
  );

  const AlignedTable = ({ tableData }) => {
    if (!tableData || !tableData.rows || tableData.rows.length === 0) {
      return null;
    }

    const templateRow = tableData.rows.reduce(
        (acc, row) => (row.fields.length > acc.fields.length ? row : acc),
        { fields: [] }
    );

    if (templateRow.fields.length === 0) {
        return null;
    }

    const columnBoundaries = templateRow.fields.map(field => ({
      start: field.bbox[0],
      end: field.bbox[2],
    }));

    const alignRow = (row) => {
      const alignedFields = Array(columnBoundaries.length).fill(null);
      row.fields.forEach(field => {
        const fieldMidpoint = (field.bbox[0] + field.bbox[2]) / 2;
        let bestMatchIndex = -1;
        let smallestDistance = Infinity;

        columnBoundaries.forEach((boundary, index) => {
          const boundaryMidpoint = (boundary.start + boundary.end) / 2;
          const distance = Math.abs(fieldMidpoint - boundaryMidpoint);
          
          if (distance < smallestDistance) {
            smallestDistance = distance;
            bestMatchIndex = index;
          }
        });

        if (bestMatchIndex !== -1) {
            alignedFields[bestMatchIndex] = field;
        }
      });
      return alignedFields;
    };

    const alignedHeaderFields = alignRow(tableData.rows[0]);
    const alignedBodyRows = tableData.rows.slice(1).map(row => ({
      ...row,
      alignedFields: alignRow(row)
    }));

    return (
      <div className="table-wrapper">
        <table className="extracted-table">
          <thead>
            <tr>
              {alignedHeaderFields.map((header, hIndex) => (
                <th key={`header-${hIndex}`}>
                  {header ? header.text : ''}
                  {header && header.bbox && (
                    <button className="locate-icon-button" onClick={() => handleLocate(header.bbox)}>
                      <LocateIcon />
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alignedBodyRows.map((row, rIndex) => (
              <tr key={`row-${rIndex}`}>
                {row.alignedFields.map((field, fIndex) => (
                  <td key={`field-${fIndex}`}>
                    {field ? field.text : ''}
                    {field && field.bbox && (
                      <button className="locate-icon-button" onClick={() => handleLocate(field.bbox)}>
                        <LocateIcon />
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="viewer-container">
      <div className="left-panel">
        <h2>Extracted Content (Page {currentPage})</h2>

        {pageData.length > 0 ? pageData.map((item, index) => {
          if (item.type === 'table') {
            return <AlignedTable key={`item-${index}`} tableData={item} />;
          } else {
            return (
              <div key={`item-${index}`} className="data-item">
                <div className="data-text">{item.text}</div>
                {item.bbox && (
                  <button className="locate-button" onClick={() => handleLocate(item.bbox)}>
                    Locate
                  </button>
                )}
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