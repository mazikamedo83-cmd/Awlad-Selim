import { isNativeCapacitor, saveAndShareDocument } from '../../services/native';

/**
 * Helper to export tabular data to CSV with UTF-8 BOM for perfect Excel compatibility with Arabic text
 */
export function exportToExcel(filename: string, headers: string[], rows: (string | number | boolean)[][]) {
  const processCell = (cell: string | number | boolean): string => {
    if (cell === null || cell === undefined) return '""';
    const cellStr = cell.toString().replace(/"/g, '""');
    return `"${cellStr}"`;
  };

  const csvRows: string[] = [];
  // Header row
  csvRows.push(headers.map(processCell).join(','));

  // Data rows
  for (const row of rows) {
    csvRows.push(row.map(processCell).join(','));
  }

  // Prepend UTF-8 BOM so Excel opens Arabic correctly
  const csvContent = '\uFEFF' + csvRows.join('\r\n');
  const cleanFilename = filename.endsWith('.csv') ? filename : `${filename}.csv`;

  if (isNativeCapacitor()) {
    saveAndShareDocument({
      filename: cleanFilename,
      content: csvContent,
      mimeType: 'text/csv;charset=utf-8;',
      title: cleanFilename,
    }).catch(() => {});
    return;
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', cleanFilename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
