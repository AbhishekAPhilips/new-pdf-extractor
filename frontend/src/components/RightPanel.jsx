import React, { useEffect } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';

function RightPanel({ 
  pdfDoc,
  currentPage, 
  numPages, 
  handlePrevPage, 
  handleNextPage, 
  zoom, 
  setZoom, 
  canvasRef, 
  pageRef,
  renderTask,
  highlightBox,
  setHighlightBox
}) {

  useEffect(() => {
    if (!pdfDoc || !currentPage) return;
    const renderPage = async () => {
      if (renderTask.current) {
        renderTask.current.cancel();
      }
      setHighlightBox(null);
      try {
        const page = await pdfDoc.getPage(currentPage);
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
  }, [pdfDoc, currentPage, zoom, canvasRef, pageRef, renderTask, setHighlightBox]);

  const handleZoomIn = () => setZoom(prevZoom => prevZoom + 0.25);
  const handleZoomOut = () => setZoom(prevZoom => Math.max(0.25, prevZoom - 0.25));

  return (
    <div className="right-panel">
      <div className="page-controls">
        <button onClick={handlePrevPage} disabled={currentPage <= 1}>Previous</button>
        <span>Page {currentPage} of {numPages}</span>
        <button onClick={handleNextPage} disabled={currentPage >= numPages}>Next</button>
        <div className="zoom-controls">
          <button onClick={handleZoomOut} className="zoom-button" title="Zoom Out"><ZoomOut size={20} strokeWidth={2.5} /></button>
          <span>{Math.round(zoom * 100)}%</span>
          <button onClick={handleZoomIn} className="zoom-button" title="Zoom In"><ZoomIn size={20} strokeWidth={2.5} /></button>
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
  );
}

export default RightPanel;