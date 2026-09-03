// client/js/utils/dom-helpers.js - Tiện ích hỗ trợ Render HTML Badges & UI Elements

import { CONTACT_STATUS, CARE_STATUS, CLASS_STATUS, BLOCK_TYPES } from '../constants/index.js';

/**
 * Trả về class màu cho số buổi vắng
 * @param {number} absences
 * @returns {string}
 */
export function getAbsenceBadgeClass(absences) {
    const abs = Number(absences) || 0;
    if (abs >= 4) return 'badge-absence-danger';
    if (abs >= 2) return 'badge-absence-warning';
    return 'badge-absence-safe';
}

/**
 * Trả về chuỗi HTML Badge Tình trạng liên lạc
 * @param {string} status
 * @returns {string}
 */
export function getContactBadgeHtml(status) {
    const s = status || CONTACT_STATUS.CHUA_LIEN_LAC;
    let badgeClass = 'badge-contact-chua-ll';
    
    if (s === CONTACT_STATUS.DA_LIEN_LAC) {
        badgeClass = 'badge-contact-da-ll';
    } else if (s === CONTACT_STATUS.KHONG_NGHE) {
        badgeClass = 'badge-contact-khong-nghe';
    } else if (s === CONTACT_STATUS.SAI_SO) {
        badgeClass = 'badge-contact-sai-so';
    }

    return `<span class="badge-status ${badgeClass}">${s}</span>`;
}

/**
 * Trả về chuỗi HTML Badge Tình trạng chăm sóc
 * @param {string} status
 * @returns {string}
 */
export function getCareBadgeHtml(status) {
    if (!status || status === '-') {
        return `<span class="badge-status badge-care-none">Chưa chăm sóc</span>`;
    }

    let badgeClass = 'badge-care-none';
    if (status === CARE_STATUS.DA_DI_HOC) {
        badgeClass = 'badge-care-da-di-hoc';
    } else if (status === CARE_STATUS.SE_DI_HOC) {
        badgeClass = 'badge-care-se-di-hoc';
    } else if (status === CARE_STATUS.NGHI_KY) {
        badgeClass = 'badge-care-nghi-ky';
    } else if (status === CARE_STATUS.LY_DO_KHAC) {
        badgeClass = 'badge-care-ly-do-khac';
    }

    return `<span class="badge-status ${badgeClass}">${status}</span>`;
}

/**
 * Trả về chuỗi HTML Badge Block
 * @param {string} blockName
 * @returns {string}
 */
export function getBlockBadgeHtml(blockName) {
    const b = blockName || BLOCK_TYPES.BLOCK_1;
    let badgeClass = 'badge-block-1';
    if (b === BLOCK_TYPES.BLOCK_2) badgeClass = 'badge-block-2';
    else if (b === BLOCK_TYPES.FULL) badgeClass = 'badge-block-full';

    return `<span class="badge-block ${badgeClass}">${b}</span>`;
}

/**
 * Trả về Icon trạng thái lớp học
 * @param {string} classStatus
 * @returns {string}
 */
export function getClassStatusIcon(classStatus) {
    if (classStatus === CLASS_STATUS.COMPLETED) return '🏁';
    if (classStatus === CLASS_STATUS.UPCOMING) return '🕒';
    return '🟢';
}
