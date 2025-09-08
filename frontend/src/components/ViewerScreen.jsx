import React, { useEffect, useRef, useState, useLayoutEffect } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import LeftPanel from './LeftPanel';
import RightPanel from './RightPanel';

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.mjs`;

function ViewerScreen({ file, extractedData }) {
  const canvasRef = useRef(null);
  const pageRef = useRef(null);
  const pdfDocRef = useRef(null);
  const renderTask = useRef(null);
  const tableRefs = useRef({});
  const lastScrollPositions = useRef({});

  const [highlightBox, setHighlightBox] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [activeElement, setActiveElement] = useState(null);
  const [zoom, setZoom] = useState(1.5);

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
          console.log("pdf:",pdf);
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
    const defaultViewport = page.getViewport({ scale: 1, rotation: page.rotate });
    const scale = canvas.width / defaultViewport.width;
    const scaledBbox = {
      left: item.left * scale,
      top: item.top * scale,
      width: item.width * scale,
      height: item.height * scale,
    };
    setHighlightBox(scaledBbox);
  };

  const handlePrevPage = () => setCurrentPage(prev => Math.max(prev - 1, 1));
  const handleNextPage = () => setCurrentPage(prev => Math.min(prev + 1, numPages));

  const pageData = extractedData ? extractedData.filter(item => item.pageIndex === currentPage - 1) : [];

  return (
    <div className="viewer-container">
      <LeftPanel
        currentPage={currentPage}
        pageData={pageData}
        activeElement={activeElement}
        handleLocate={handleLocate}
        tableRefs={tableRefs}
      />
      <RightPanel
        pdfDoc={pdfDocRef.current}
        currentPage={currentPage}
        numPages={numPages}
        handlePrevPage={handlePrevPage}
        handleNextPage={handleNextPage}
        zoom={zoom}
        setZoom={setZoom}
        canvasRef={canvasRef}
        pageRef={pageRef}
        renderTask={renderTask}
        highlightBox={highlightBox}
        setHighlightBox={setHighlightBox}
      />
    </div>
  );
}

export default ViewerScreen;