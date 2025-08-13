import React, { useState, useRef } from 'react';

function UploadScreen({ onUploadSuccess }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleFileChange = (event) => {
    setSelectedFile(event.target.files[0]);
    setError('');
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file first.');
      return;
    }

    setIsLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await fetch('http://127.0.0.1:5000/api/process-invoice', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || `Server error: ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      
      onUploadSuccess(selectedFile, data);

    } catch (err) {
      setError(err.message || 'An unknown error occurred.');
    } finally {
      setIsLoading(false);
    }
  };

  const onBoxClick = () => {
    fileInputRef.current.click();
  };

  return (
    <div className="upload-container">
      <h1>Invoice Extractor</h1>
      <p>Upload a PDF to extract its content.</p>
      <div className="upload-box" onClick={onBoxClick}>
        <input
          type="file"
          accept=".pdf"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <p>{selectedFile ? selectedFile.name : 'Click to select a PDF file'}</p>
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button 
        className="upload-button" 
        onClick={handleUpload} 
        disabled={!selectedFile || isLoading}
      >
        {isLoading ? 'Processing...' : 'Extract Data'}
      </button>
      {isLoading && <p className="loading-text">This may take a minute...</p>}
    </div>
  );
}

export default UploadScreen;
