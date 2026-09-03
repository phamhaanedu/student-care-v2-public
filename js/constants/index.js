// client/js/constants/index.js - Quản lý tập trung toàn bộ Constants & Enums của hệ thống

/**
 * 1. Phân quyền người dùng (RBAC)
 */
export const SYSTEM_ROLES = Object.freeze({
    SUPER_ADMIN: 'Super Admin',
    ADMIN: 'Admin',
    TEACHER: 'Teacher'
});

/**
 * 2. Vòng đời lớp học
 */
export const CLASS_STATUS = Object.freeze({
    ONGOING: 'Ongoing',
    UPCOMING: 'Upcoming',
    COMPLETED: 'Completed'
});

/**
 * 3. Phân loại Block
 */
export const BLOCK_TYPES = Object.freeze({
    BLOCK_1: 'Block 1',
    BLOCK_2: 'Block 2',
    FULL: 'Full',
    ALL: 'all'
});

/**
 * 4. Tình trạng liên lạc
 */
export const CONTACT_STATUS = Object.freeze({
    CHUA_LIEN_LAC: 'Chưa liên lạc',
    DA_LIEN_LAC: 'Đã liên lạc',
    KHONG_NGHE: 'Không nghe máy',
    SAI_SO: 'Sai số điện thoại',
    ALL: 'all'
});

/**
 * 5. Tình trạng chăm sóc
 */
export const CARE_STATUS = Object.freeze({
    DA_DI_HOC: 'Đã đi học',
    SE_DI_HOC: 'Sẽ đi học',
    NGHI_KY: 'Nghỉ học kỳ',
    LY_DO_KHAC: 'Lý do khác',
    NONE: 'none',
    ALL: 'all'
});

/**
 * 6. Bộ lọc Mức độ vắng
 */
export const ABSENCE_FILTERS = Object.freeze({
    ALL: 'all',
    ALL_RISK: 'all_risk',
    ONE: '1',
    TWO: '2',
    THREE: '3',
    GTE_FOUR: 'gte4'
});

/**
 * 7. Danh sách Super Admin tối cao (Zero-cost Token Whitelist)
 */
export const SUPER_ADMIN_EMAILS = Object.freeze([
    'phamhaan@fe.edu.vn',
    'phamhaan@gmail.com',
    'anph21@fpt.edu.vn',
    'anph21@fe.edu.vn'
]);

/**
 * 8. Danh mục Nguyên nhân gốc rễ (Root Causes)
 */
export const ROOT_CAUSES = Object.freeze([
    { id: 'JOB_CONFLICT', label: '💼 Đi làm thêm / Trùng ca', shortLabel: 'Đi làm thêm', color: '#0284c7', bg: '#e0f2fe' },
    { id: 'LOST_MOTIVATION', label: '📉 Mất động lực / Chán ngành', shortLabel: 'Mất động lực', color: '#d97706', bg: '#fef3c7' },
    { id: 'KNOWLEDGE_GAP', label: '📚 Hổng kiến thức / Môn khó', shortLabel: 'Hổng kiến thức', color: '#7c3aed', bg: '#f3e8ff' },
    { id: 'HEALTH_FAMILY', label: '🏥 Sức khỏe / Biến cố gia đình', shortLabel: 'Sức khỏe/Gia đình', color: '#e11d48', bg: '#ffe4e6' },
    { id: 'FINANCIAL', label: '💸 Khó khăn tài chính / Học phí', shortLabel: 'Tài chính/Học phí', color: '#059669', bg: '#d1fae5' },
    { id: 'OTHER', label: '❓ Lý do cá nhân khác', shortLabel: 'Lý do khác', color: '#64748b', bg: '#f1f5f9' }
]);

