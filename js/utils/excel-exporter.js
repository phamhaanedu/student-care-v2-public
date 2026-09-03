// client/js/utils/excel-exporter.js - Tiện ích Xuất File Excel Đa Sheet dùng chung (SheetJS Wrapper)

/**
 * Xuất dữ liệu ra file Excel (.xlsx) hỗ trợ nhiều Sheet
 * @param {string} filename Tên file cần tải về (ví dụ: 'Bao_Cao_Cham_Soc_Spring2026.xlsx')
 * @param {Array<{sheetName: string, data: Array<Object>, headers?: Array<string>}>} sheets Danh sách các Sheet
 */
export function exportToExcel(filename, sheets = []) {
    if (typeof XLSX === 'undefined') {
        throw new Error('Thư viện SheetJS (xlsx) chưa được nạp trên trang web!');
    }

    if (!Array.isArray(sheets) || sheets.length === 0) {
        throw new Error('Không có dữ liệu sheet nào để xuất Excel!');
    }

    const wb = XLSX.utils.book_new();

    sheets.forEach(({ sheetName, data, headers }) => {
        let ws;
        if (headers && Array.isArray(headers) && headers.length > 0) {
            ws = XLSX.utils.json_to_sheet(data, { header: headers });
        } else {
            ws = XLSX.utils.json_to_sheet(data);
        }

        // Tự động căn chỉnh độ rộng cột cơ bản nếu có dữ liệu
        if (data && data.length > 0) {
            const colKeys = Object.keys(data[0]);
            ws['!cols'] = colKeys.map(key => ({ wch: Math.max(key.length + 5, 14) }));
        }

        const safeSheetName = (sheetName || 'Sheet').substring(0, 31); // Giới hạn 31 ký tự của Excel
        XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
    });

    const safeFilename = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
    XLSX.writeFile(wb, safeFilename);
}
