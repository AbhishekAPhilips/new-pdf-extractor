import React, { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

function ViewerScreen({ file, extractedData }) {
  const canvasRef = useRef(null);
  const [highlightBox, setHighlightBox] = useState(null);

  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [activeElement, setActiveElement] = useState(null);

  const pdfDocRef = useRef(null);
  const renderTask = useRef(null);
  const pageRef = useRef(null);

  // NEW: Log the entire data structure when it's received from the backend
  useEffect(() => {
    if (extractedData) {
      console.log('Full data received from backend:', extractedData);
    }
  }, [extractedData]);

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


  const handleLocate = (bbox, elementId) => {
    setActiveElement(elementId);
    const page = pageRef.current;
    const canvas = canvasRef.current;
    if (!bbox || !page || !canvas) return;

    // Log for data coming from the backend
    console.log('Backend bbox (left, top, width, height):', bbox);

    const defaultViewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = canvas.width / defaultViewport.width;

    // The bbox array is now [left, top, width, height]
    // The calculation is a direct scaling of each value
    const scaledBbox = {
      left: bbox[0] * scale,
      top: bbox[1] * scale,
      width: bbox[2] * scale,
      height: bbox[3] * scale,
    };

    // Log for the scaled data before displaying the highlight
    console.log('Scaled bbox for frontend (pixels):', scaledBbox);
    
    setHighlightBox(scaledBbox);
  };

  const handlePrevPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const handleNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, numPages));
  };
  
  const pageData = extractedData ? (extractedData[currentPage] || []) : [];

  const PlusCircleIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="16"></line>
      <line x1="8" y1="12" x2="16" y2="12"></line>
    </svg>
  );

  const AlignedTable = ({ tableData, tableIndex }) => {
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
      end: field.bbox[0] + field.bbox[2], // end is now left + width
    }));

    const alignRow = (row) => {
      const alignedFields = Array(columnBoundaries.length).fill(null);
      row.fields.forEach(field => {
        if (!field.bbox) return;
        const fieldMidpoint = field.bbox[0] + (field.bbox[2] / 2); // midpoint is now left + (width / 2)
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

        if (bestMatchIndex !== -1 && !alignedFields[bestMatchIndex]) {
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
        <div className="table-main-header">
          <span>Table</span>
          {tableData.bbox && (
            <button className="icon-locate-button" onClick={() => handleLocate(tableData.bbox, `t-${tableIndex}`)} title="Locate Table">
              <PlusCircleIcon />
            </button>
          )}
        </div>
        <table className="extracted-table">
          <thead>
            <tr>
              <th className="row-locate-header"></th>
              {alignedHeaderFields.map((header, hIndex) => (
                <th 
                  key={`header-${hIndex}`} 
                  onClick={() => header && handleLocate(header.bbox, `t${tableIndex}-h-${hIndex}`)}
                  className={activeElement === `t${tableIndex}-h-${hIndex}` ? 'active-cell' : ''}
                >
                  {header ? header.text : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alignedBodyRows.map((row, rIndex) => (
              <tr key={`row-${rIndex}`}>
                <td className="row-locate-cell">
                  <button 
                    className="icon-locate-button" 
                    onClick={() => handleLocate(row.bbox, `t${tableIndex}-r${rIndex}`)}
                    title="Locate Row"
                  >
                    <PlusCircleIcon />
                  </button>
                </td>
                {row.alignedFields.map((field, fIndex) => (
                  <td 
                    key={`field-${fIndex}`}
                    onClick={() => field && handleLocate(field.bbox, `t${tableIndex}-r${rIndex}-c${fIndex}`)}
                    className={activeElement === `t${tableIndex}-r${rIndex}-c${fIndex}` ? 'active-cell' : ''}
                  >
                    {field ? field.text : ''}
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
            return <AlignedTable key={`item-${index}`} tableData={item} tableIndex={index} />;
          } else {
            return (
              <div 
                key={`item-${index}`} 
                className={`data-item ${activeElement === `d-${index}` ? 'active-cell' : ''}`}
              >
                <div className="data-text">
                  {item.text}
                </div>
                {item.bbox && (
                  <button className="icon-locate-button" onClick={() => handleLocate(item.bbox, `d-${index}`)} title="Locate">
                    <PlusCircleIcon />
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