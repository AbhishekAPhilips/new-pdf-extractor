import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

function ViewerScreen({ file, extractedData }) {
  const canvasRef = useRef(null);
  const [highlightBox, setHighlightBox] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [activeElement, setActiveElement] = useState(null);
  const [zoom, setZoom] = useState(1.5);
  const [searchTerm, setSearchTerm] = useState('');

  const pdfDocRef = useRef(null);
  const renderTask = useRef(null);
  const pageRef = useRef(null);
  
  const tableRefs = useRef({});
  const lastScrollPositions = useRef({});

  useEffect(() => {
    if (extractedData) {
      console.log('Full data received from backend (flat list):', extractedData);
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
          console.log(pdf)
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
        const viewport = page.getViewport({ scale: zoom, rotation: page.rotate });
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
  }, [pdfDocRef.current, currentPage, zoom]);

  useLayoutEffect(() => {
    Object.keys(lastScrollPositions.current).forEach(tableIndex => {
        const tableElement = tableRefs.current[tableIndex];
        const scrollLeft = lastScrollPositions.current[tableIndex];
        if (tableElement && tableElement.scrollLeft !== scrollLeft) {
            tableElement.scrollLeft = scrollLeft;
        }
    });
  }, [activeElement]);

  const handleLocate = (item, elementId) => {
    const match = elementId.match(/^t(\d+)/);
    if (match) {
        const tableIndex = match[1];
        const tableElement = tableRefs.current[tableIndex];
        if (tableElement) {
            lastScrollPositions.current[tableIndex] = tableElement.scrollLeft;
        }
    }
    setActiveElement(elementId);
    const page = pageRef.current;
    const canvas = canvasRef.current;
    if (!item || !page || !canvas) return;
    console.log('Backend item data:', item);
    const defaultViewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = canvas.width / defaultViewport.width;
    const scaledBbox = {
      left: item.left * scale,
      top: item.top * scale,
      width: item.width * scale,
      height: item.height * scale,
    };
    console.log('Scaled bbox for frontend (pixels):', scaledBbox);
    setHighlightBox(scaledBbox);
  };

  const handlePrevPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));
  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, numPages));
  
  const handleZoomIn = () => setZoom(prevZoom => prevZoom + 0.25);
  const handleZoomOut = () => setZoom(prevZoom => Math.max(0.25, prevZoom - 0.25));

  const pageData = extractedData ? extractedData.filter(item => item.pageIndex === currentPage - 1) : [];

  const filteredData = searchTerm.trim() === '' 
    ? pageData
    : pageData.map(item => {
        const lowerCaseSearchTerm = searchTerm.toLowerCase();
        if (item.type === 'table') {
          const headerRow = item.rows[0];
          const matchingRows = item.rows.slice(1).filter(row => 
            row.fields.some(field => 
              field.text.toLowerCase().includes(lowerCaseSearchTerm)
            )
          );

          if (matchingRows.length > 0) {
            return { ...item, rows: [headerRow, ...matchingRows] };
          }
          return null;
        }
        
        if (item.text.toLowerCase().includes(lowerCaseSearchTerm)) {
          return item;
        }
        
        return null;
      }).filter(Boolean); 

  const PlusCircleIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );

  const ZoomInIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      <line x1="11" y1="8" x2="11" y2="14"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  );

  const ZoomOutIcon = () => (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      <line x1="8" y1="11" x2="14" y2="11"></line>
    </svg>
  );

  const SearchIcon = () => (
    <svg className="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );

  const AlignedTable = ({ tableData, tableIndex }) => {
    if (!tableData || !tableData.rows || tableData.rows.length === 0) return null;

    const templateRow = tableData.rows.reduce((acc, row) => (row.fields.length > acc.fields.length ? row : acc), { fields: [] });
    if (templateRow.fields.length === 0) return null;

    const columnBoundaries = templateRow.fields.map(field => ({
      start: field.left,
      end: field.left + field.width,
    }));

    const alignRow = (row) => {
      const alignedFields = Array(columnBoundaries.length).fill(null);
      row.fields.forEach(field => {
        if (field.left === undefined) return;
        const fieldMidpoint = field.left + (field.width / 2);
        let bestMatchIndex = -1;
        let smallestDistance = Infinity;
        columnBoundaries.forEach((boundary, index) => {
          const distance = Math.abs(fieldMidpoint - (boundary.start + boundary.end) / 2);
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
    const alignedBodyRows = tableData.rows.slice(1).map(row => ({ ...row, alignedFields: alignRow(row) }));

    return (
      <div className="table-wrapper" ref={el => tableRefs.current[tableIndex] = el}>
        <div className="table-main-header">
          <span>Table</span>
          {tableData.left !== undefined && (
            <button className="icon-locate-button" onClick={() => handleLocate(tableData, `t-${tableIndex}`)} title="Locate Table">
              <PlusCircleIcon />
            </button>
          )}
        </div>
        <table className="extracted-table">
          <thead>
            <tr>
              <th className="row-locate-header" />
              {alignedHeaderFields.map((header, hIndex) => (
                <th key={`header-${hIndex}`} onClick={() => header && handleLocate(header, `t${tableIndex}-h-${hIndex}`)} className={activeElement === `t${tableIndex}-h-${hIndex}` ? 'active-cell' : ''}>
                  {header ? header.text : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alignedBodyRows.map((row, rIndex) => (
              <tr key={`row-${rIndex}`}>
                <td className="row-locate-cell">
                  <button className="icon-locate-button" onClick={() => handleLocate(row, `t${tableIndex}-r${rIndex}`)} title="Locate Row">
                    <PlusCircleIcon />
                  </button>
                </td>
                {row.alignedFields.map((field, fIndex) => (
                  <td 
                    key={`field-${fIndex}`} 
                    onClick={() => field && handleLocate(field, `t${tableIndex}-r${rIndex}-c${fIndex}`)} 
                    className={activeElement === `t${tableIndex}-r${rIndex}-c${fIndex}` ? 'active-cell' : ''}
                    style={{ whiteSpace: 'pre-wrap' }}
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
        <div className="search-container">
          <SearchIcon />
          <input 
            type="text"
            placeholder="Search this page..."
            className="search-input"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {filteredData.length > 0 ? filteredData.map((item, index) => {
          if (item.type === 'table') {
            return <AlignedTable key={`item-${index}`} tableData={item} tableIndex={index} />;
          }
          return (
            <div key={`item-${index}`} className={`data-item ${activeElement === `d-${index}` ? 'active-cell' : ''}`}>
              <div className="data-text">{item.text}</div>
              {item.left !== undefined && (
                <button className="icon-locate-button" onClick={() => handleLocate(item, `d-${index}`)} title="Locate">
                  <PlusCircleIcon />
                </button>
              )}
            </div>
          );
        }) : <p>No results found for "{searchTerm}".</p>}
      </div>
      
      <div className="right-panel">
        <div className="page-controls">
          <button onClick={handlePrevPage} disabled={currentPage <= 1}>Previous</button>
          <span>Page {currentPage} of {numPages}</span>
          <button onClick={handleNextPage} disabled={currentPage >= numPages}>Next</button>
          <div className="zoom-controls">
            <button onClick={handleZoomOut} className="zoom-button" title="Zoom Out"><ZoomOutIcon /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button onClick={handleZoomIn} className="zoom-button" title="Zoom In"><ZoomInIcon /></button>
          </div>
        </div>
        <div className="pdf-canvas-container">
          <canvas ref={canvasRef} />
          {highlightBox && (
            <div className="highlight-box" style={{
              left: `${highlightBox.left}px`,
              top: `${highlightBox.top}px`,
              width: `${highlightBox.width}px`,
              height: `${highlightBox.height}px`,
            }} />
          )}
        </div>
      </div>
    </div>
  );
}

export default ViewerScreen;
