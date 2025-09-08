import React, { useState } from 'react';
import { PlusCircle, Search } from 'lucide-react';

const AlignedTable = ({ tableData, tableIndex, handleLocate, activeElement, tableRefs }) => {
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
            <PlusCircle size={16} strokeWidth={2.5} />
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
            <tr key={`row-${rIndex}`} className={activeElement === `t${tableIndex}-r${rIndex}` ? 'active-row' : ''}>
              <td className="row-locate-cell">
                <button className="icon-locate-button" onClick={() => handleLocate(row, `t${tableIndex}-r${rIndex}`)} title="Locate Row">
                  <PlusCircle size={16} strokeWidth={2.5} />
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

function LeftPanel({ currentPage, pageData, activeElement, handleLocate, tableRefs }) {
  const [searchTerm, setSearchTerm] = useState('');

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

  return (
    <div className="left-panel">
      <h2>Extracted Content (Page {currentPage})</h2>
      <div className="search-container">
        <Search className="search-icon" size={20} strokeWidth={2} />
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
          return (
            <AlignedTable 
              key={`item-${index}`} 
              tableData={item} 
              tableIndex={index} 
              handleLocate={handleLocate}
              activeElement={activeElement}
              tableRefs={tableRefs}
            />
          );
        }
        return (
          <div key={`item-${index}`} className={`data-item ${activeElement === `d-${index}` ? 'active-cell' : ''}`}>
            <div className="data-text">{item.text}</div>
            {item.left !== undefined && (
              <button className="icon-locate-button" onClick={() => handleLocate(item, `d-${index}`)} title="Locate">
                <PlusCircle size={16} strokeWidth={2.5} />
              </button>
            )}
          </div>
        );
      }) : <p>No results found for "{searchTerm}".</p>}
    </div>
  );
}

export default LeftPanel;