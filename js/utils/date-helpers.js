// client/js/utils/date-helpers.js - Tiện ích xử lý Ngày Tháng & Học Kỳ

/**
 * Format thời gian theo định dạng DD/MM/YYYY HH:mm
 * Hỗ trợ cả Firestore Timestamp, Javascript Date, ISO string và Unix timestamp
 * @param {any} timeVal
 * @returns {string} Chuỗi ngày giờ hoặc '-'
 */
export function formatDateTime(timeVal) {
    if (!timeVal) return '-';
    let dateObj;
    if (typeof timeVal.toDate === 'function') {
        dateObj = timeVal.toDate();
    } else if (timeVal.seconds) {
        dateObj = new Date(timeVal.seconds * 1000);
    } else {
        dateObj = new Date(timeVal);
    }

    if (isNaN(dateObj.getTime())) return '-';

    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = dateObj.getFullYear();
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');

    return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

/**
 * Format ngày theo định dạng DD/MM/YYYY
 * @param {any} timeVal
 * @returns {string} Chuỗi ngày hoặc '-'
 */
export function formatDateOnly(timeVal) {
    if (!timeVal) return '-';
    let dateObj = typeof timeVal.toDate === 'function' ? timeVal.toDate() : new Date(timeVal.seconds ? timeVal.seconds * 1000 : timeVal);
    if (isNaN(dateObj.getTime())) return '-';

    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = dateObj.getFullYear();

    return `${dd}/${mm}/${yyyy}`;
}

/**
 * Sắp xếp danh sách kỳ học theo thời gian mới nhất (Năm giảm dần -> Fall -> Summer -> Spring)
 * @param {string[]} semesters
 * @returns {string[]} Danh sách kỳ học đã sắp xếp
 */
export function sortSemestersList(semesters) {
    if (!Array.isArray(semesters)) return [];
    const seasonWeight = { 'Fall': 3, 'Summer': 2, 'Spring': 1 };
    
    return [...semesters].sort((a, b) => {
        const partsA = (a || '').split(' ');
        const partsB = (b || '').split(' ');
        const seasonA = partsA[0];
        const yearA = parseInt(partsA[1], 10) || 0;
        const seasonB = partsB[0];
        const yearB = parseInt(partsB[1], 10) || 0;

        if (yearA !== yearB) return yearB - yearA;
        const weightA = seasonWeight[seasonA] || 0;
        const weightB = seasonWeight[seasonB] || 0;
        return weightB - weightA;
    });
}

/**
 * Xác định kỳ học liền kề trước của một kỳ học (Ví dụ: Fall 2026 -> Summer 2026 -> Spring 2026 -> Fall 2025)
 * @param {string} currentSemester
 * @param {string[]} availableSemesters
 * @returns {string} Kỳ liền kề trước hoặc chuỗi rỗng
 */
export function getPreviousSemester(currentSemester, availableSemesters = []) {
    if (!currentSemester) return '';
    
    // 1. Nếu có danh sách kỳ học, lấy kỳ ngay phía sau trong danh sách đã sắp xếp giảm dần
    if (Array.isArray(availableSemesters) && availableSemesters.length > 0) {
        const sorted = sortSemestersList(availableSemesters);
        const idx = sorted.indexOf(currentSemester);
        if (idx !== -1 && idx < sorted.length - 1) {
            return sorted[idx + 1];
        }
    }

    // 2. Fallback tính toán quy tắc học kỳ FPT Polytechnic: Fall -> Summer -> Spring -> Fall năm trước
    const parts = currentSemester.trim().split(' ');
    if (parts.length === 2) {
        const season = parts[0];
        const year = parseInt(parts[1]);
        if (!isNaN(year)) {
            if (season === 'Fall') return `Summer ${year}`;
            if (season === 'Summer') return `Spring ${year}`;
            if (season === 'Spring') return `Fall ${year - 1}`;
        }
    }

    return '';
}
