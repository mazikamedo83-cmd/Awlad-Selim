import { isNativeCapacitor, saveAndShareDocument } from '../../services/native';

// Arabic RTL Print-to-PDF Engine using a hidden iframe on Desktop/Web
// and native Filesystem + Share on Android/iOS Capacitor apps.

export interface PdfExportOptions {
  title: string;
  subtitle?: string;
  companyName?: string;
  companySubtitle?: string;
  address?: string;
  phone1?: string;
  phone2?: string;
  branchName?: string;
  branchNumber?: string;
  representativeName?: string;
  representativePhone?: string;
  commercialRegistration?: string;
  taxNumber?: string;
  docNumber?: string;
  dateRangeText?: string;
  meta?: Array<{ label: string; value: string }>;
  tableHeaders?: string[];
  tableRows?: Array<Array<string | number>>;
  summaryPairs?: Array<{ label: string; value: string; highlight?: boolean }>;
  notes?: string;
  footerText?: string;
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildPrintableHtml(options: PdfExportOptions): string {
  const {
    title,
    subtitle,
    companyName = 'مؤسسة أولاد سليم لتجارة المواد الغذائية بالجملة',
    companySubtitle = 'AWLAD SELIM ERP',
    address,
    phone1,
    phone2,
    branchName,
    branchNumber,
    representativeName,
    representativePhone,
    commercialRegistration,
    taxNumber,
    docNumber,
    dateRangeText,
    meta = [],
    tableHeaders = [],
    tableRows = [],
    summaryPairs = [],
    notes,
    footerText = 'تم إصدار هذا المستند آلياً من نظام أولاد سليم للمحاسبة وإدارة الأعمال',
  } = options;

  const origin =
    typeof window !== 'undefined' && !window.location.origin.startsWith('capacitor://')
      ? window.location.origin
      : '';
  const generatedAt = new Date().toLocaleString('ar-EG');

  const phoneLine = [phone1?.trim(), phone2?.trim()].filter(Boolean).join(' / ');
  const branchParts = [
    branchName?.trim() || '',
    branchNumber?.trim() ? `رقم الفرع: ${branchNumber.trim()}` : '',
  ].filter(Boolean);
  const branchLine = branchParts.join(' · ');

  const contactBits = [
    address?.trim() || '',
    phoneLine ? `هاتف: ${phoneLine}` : '',
  ].filter(Boolean);

  const enrichedMeta = [...meta];
  if (representativeName?.trim() && !enrichedMeta.some((m) => m.label.includes('المندوب'))) {
    enrichedMeta.push({ label: 'المندوب المسؤول', value: representativeName.trim() });
  }
  if (representativePhone?.trim() && !enrichedMeta.some((m) => m.label.includes('هاتف المندوب'))) {
    enrichedMeta.push({ label: 'هاتف المندوب', value: representativePhone.trim() });
  }
  if (branchLine && !enrichedMeta.some((m) => m.label.includes('الفرع'))) {
    enrichedMeta.push({ label: 'الفرع', value: branchLine });
  }

  const metaHtml = enrichedMeta.length
    ? `<div class="meta-grid">${enrichedMeta
        .filter((m) => String(m.value ?? '').trim() !== '')
        .map(
          (m) =>
            `<div class="meta-item"><span class="meta-label">${escapeHtml(m.label)}:</span> <strong>${escapeHtml(m.value)}</strong></div>`
        )
        .join('')}</div>`
    : '';

  const tableHtml =
    tableHeaders.length > 0
      ? `<table>
          <thead>
            <tr>${tableHeaders.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${
              tableRows.length > 0
                ? tableRows
                    .map(
                      (row) =>
                        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`
                    )
                    .join('')
                : `<tr><td colspan="${tableHeaders.length}" style="text-align:center;color:#64748b;">لا توجد بيانات للعرض</td></tr>`
            }
          </tbody>
        </table>`
      : '';

  const summaryHtml = summaryPairs.length
    ? `<div class="summary-box">${summaryPairs
        .map(
          (s) =>
            `<div class="summary-row ${s.highlight ? 'highlight' : ''}"><span>${escapeHtml(s.label)}</span><strong>${escapeHtml(s.value)}</strong></div>`
        )
        .join('')}</div>`
    : '';

  const legalParts = [commercialRegistration?.trim(), taxNumber?.trim()].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; }
    body { margin: 0; padding: 12px; color: #0f172a; font-size: 12px; line-height: 1.5; direction: rtl; background: #fff; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 14px; }
    .header img { max-height: 58px; width: auto; }
    .company-info { text-align: center; flex: 1; padding: 0 12px; }
    .company-info h1 { margin: 0; font-size: 18px; color: #172554; font-weight: 800; }
    .company-info p { margin: 2px 0 0; font-size: 11px; color: #475569; }
    .doc-badge { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 8px 12px; text-align: center; min-width: 120px; }
    .doc-badge .title { font-weight: 800; color: #1e3a8a; font-size: 12px; display: block; }
    .doc-badge .num { font-family: monospace; font-weight: 800; color: #1d4ed8; font-size: 13px; }
    .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px; margin-bottom: 14px; }
    .meta-label { color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 11px; }
    th { background: #172554; color: #fff; padding: 7px 8px; text-align: right; border: 1px solid #1e3a8a; font-weight: 700; }
    td { padding: 6px 8px; border: 1px solid #cbd5e1; text-align: right; }
    tr:nth-child(even) td { background: #f8fafc; }
    .summary-box { margin-right: auto; width: 280px; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; background: #f8fafc; }
    .summary-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px dashed #e2e8f0; }
    .summary-row:last-child { border-bottom: 0; }
    .summary-row.highlight { font-size: 13px; color: #172554; font-weight: 800; padding-top: 6px; }
    .notes { margin-top: 12px; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 11px; }
    .footer { margin-top: 18px; padding-top: 8px; border-top: 1px solid #cbd5e1; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; }
  </style>
</head>
<body>
  <div class="header">
    ${origin ? `<img src="${origin}/awlad-selim-logo.png" alt="AWLAD SELIM" onerror="this.style.display='none'" />` : ''}
    <div class="company-info">
      <h1>${escapeHtml(companyName)}</h1>
      ${subtitle || companySubtitle ? `<p>${escapeHtml(subtitle || companySubtitle)}</p>` : ''}
      ${branchLine ? `<p><strong>${escapeHtml(branchLine)}</strong></p>` : ''}
      ${contactBits.length > 0 ? `<p>${escapeHtml(contactBits.join(' • '))}</p>` : ''}
      ${dateRangeText ? `<p>${escapeHtml(dateRangeText)}</p>` : ''}
    </div>
    <div class="doc-badge">
      <span class="title">${escapeHtml(title)}</span>
      ${docNumber ? `<span class="num">${escapeHtml(docNumber)}</span>` : ''}
    </div>
  </div>
  ${metaHtml}
  ${tableHtml}
  ${summaryHtml}
  ${notes || legalParts.length > 0 ? `<div class="notes">${notes ? `<div><strong>ملاحظات:</strong> ${escapeHtml(notes)}</div>` : ''}${legalParts.length > 0 ? `<div style="margin-top:4px;color:#64748b;">${escapeHtml(legalParts.join(' • '))}</div>` : ''}</div>` : ''}
  <div class="footer">
    <span>${escapeHtml(footerText)}</span>
    <span>تاريخ الطباعة: ${escapeHtml(generatedAt)}</span>
  </div>
</body>
</html>`;
}

export function exportHtmlToPdf(options: PdfExportOptions): void {
  if (typeof document === 'undefined') return;
  const html = buildPrintableHtml(options);

  if (isNativeCapacitor()) {
    const fileLabel = options.docNumber || options.title || 'document';
    saveAndShareDocument({
      filename: `AWLAD_SELIM_${fileLabel}_${Date.now()}.html`,
      content: html,
      mimeType: 'text/html;charset=utf-8',
      title: `${options.title}${options.docNumber ? ` - ${options.docNumber}` : ''}`,
    }).catch(() => {});
    return;
  }

  const existing = document.getElementById('awlad-selim-pdf-iframe');
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'awlad-selim-pdf-iframe';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();

  const trigger = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      window.setTimeout(() => {
        iframe.remove();
      }, 2000);
    }
  };

  if (iframe.contentWindow) {
    iframe.onload = trigger;
    window.setTimeout(trigger, 300);
  }
}

export function exportTableToPdf(
  title: string,
  headers: string[],
  rows: Array<Array<string | number>>,
  extra?: Partial<PdfExportOptions>
): void {
  exportHtmlToPdf({
    title,
    tableHeaders: headers,
    tableRows: rows,
    ...extra,
  });
}
