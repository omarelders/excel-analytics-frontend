import React, { useState, useEffect, useMemo } from 'react';
import { GripVertical } from 'lucide-react';
import './ExportModal.css';

export default function ExportModal({ isOpen, onClose, onExport, columns }) {
  const [selectedColumns, setSelectedColumns] = useState(new Set());
  const [selectAll, setSelectAll] = useState(true);
  const [exportLimit, setExportLimit] = useState('');
  
  // Custom ordering state
  const [localColumns, setLocalColumns] = useState([]);
  const [draggedIdx, setDraggedIdx] = useState(null);

  // Initialize all columns as selected when modal opens
  useEffect(() => {
    if (isOpen && columns?.length) {
      setSelectedColumns(new Set(columns.map(col => col.key)));
      setSelectAll(true);
      setExportLimit('');
      setLocalColumns([...columns]);
    }
  }, [isOpen, columns]);

  // Handle Drag & Drop
  const onDragStart = (e, index) => {
    setDraggedIdx(index);
    // Required for Firefox
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      // Workaround for some browsers requiring data to be set
      e.dataTransfer.setData('text/html', e.target.parentNode);
    }
  };

  const onDragOver = (e, index) => {
    e.preventDefault(); // Necessary to allow dropping
    if (draggedIdx === null || draggedIdx === index) return;

    const newCols = [...localColumns];
    const draggedItem = newCols[draggedIdx];
    newCols.splice(draggedIdx, 1);
    newCols.splice(index, 0, draggedItem);
    
    setLocalColumns(newCols);
    setDraggedIdx(index);
  };

  const onDragEnd = () => {
    setDraggedIdx(null);
  };

  const handleToggleColumn = (key) => {
    const newKeys = new Set(selectedColumns);
    if (newKeys.has(key)) {
      newKeys.delete(key);
      setSelectAll(false);
    } else {
      newKeys.add(key);
      if (newKeys.size === Math.max(1, columns.length)) {
        setSelectAll(true);
      }
    }
    setSelectedColumns(newKeys);
  };

  const handleToggleAll = () => {
    if (selectAll) {
      setSelectedColumns(new Set());
      setSelectAll(false);
    } else {
      setSelectedColumns(new Set(columns.map(col => col.key)));
      setSelectAll(true);
    }
  };

  const handleExport = () => {
    const limitNum = exportLimit ? parseInt(exportLimit, 10) : null;
    onExport(Array.from(selectedColumns), limitNum);
  };

  if (!isOpen) return null;

  return (
    <div className="export-modal-overlay" onClick={onClose}>
      <div className="export-modal" onClick={e => e.stopPropagation()}>
        <div className="export-modal-header">
          <h3>تحميل ملف اكسيل</h3>
        </div>

        <div className="export-modal-content">
          <div className="export-search-container">
            <div className="export-limit-container">
              <label>عدد السجلات (اختياري)</label>
              <input 
                type="number" 
                placeholder="الكل" 
                min="1"
                value={exportLimit}
                onChange={(e) => setExportLimit(e.target.value)}
              />
            </div>
            
            <div className="export-checkbox-container">
              <label htmlFor="selectAllExport" className="select-all-label">تحديد الكل</label>
              <input 
                id="selectAllExport"
                type="checkbox" 
                className="export-checkbox"
                checked={selectAll}
                onChange={handleToggleAll}
                title="تحديد الكل / إلغاء تحديد الكل"
              />
            </div>
          </div>

          <div className="export-columns-list">
            {localColumns.map((col, idx) => (
              <div 
                key={col.key} 
                className={`export-column-item ${draggedIdx === idx ? 'dragging' : ''}`}
                draggable={true}
                onDragStart={(e) => onDragStart(e, idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
              >
                <GripVertical 
                  size={16} 
                  className="drag-handle" 
                  title="اسحب لإعادة الترتيب"
                />
                <span className="column-label">{col.label}</span>
                <input 
                  type="checkbox" 
                  className="export-checkbox"
                  checked={selectedColumns.has(col.key)}
                  onChange={() => handleToggleColumn(col.key)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="export-modal-footer">
          <button className="export-save-btn" onClick={handleExport} disabled={selectedColumns.size === 0}>
            حفظ
          </button>
          <button className="export-cancel-btn" onClick={onClose}>
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}
