import React, { useState } from 'react';
import UploadScreen from './components/UploadScreen';
import ViewerScreen from './components/ViewerScreen';

function App() {
  const [view, setView] = useState('upload'); // 'upload' or 'viewer'
  const [file, setFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);

  const handleUploadSuccess = (uploadedFile, data) => {
    setFile(uploadedFile);
    setExtractedData(data);
    setView('viewer');
  };

  return (
    <div className="App">
      {view === 'upload' ? (
        <UploadScreen onUploadSuccess={handleUploadSuccess} />
      ) : (
        <ViewerScreen file={file} extractedData={extractedData} />
      )}
    </div>
  );
}

export default App;