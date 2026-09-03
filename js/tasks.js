// tasks.js - Không Gian Làm Việc Giảng Viên & Expandable Data Table (Clean Controller Architecture)

import { checkAuth } from './auth.js';
import { SemesterService } from './services/semester-service.js';
import { SubjectService } from './services/subject-service.js';
import { TeacherService } from './services/teacher-service.js';
import { StudentService } from './services/student-service.js';
import { AcademicService } from './services/academic-service.js';
import { EmailRollupService } from './services/email-rollup-service.js';
import { EmailModalComponent } from './components/email-modal.js';
import { AccordionWorkspaceComponent } from './components/accordion-workspace.js';
import { formatDateTime, sortSemestersList, getPreviousSemester } from './utils/date-helpers.js';
import { showToast } from './utils/toast.js';
import { getAbsenceBadgeClass, getContactBadgeHtml, getCareBadgeHtml, getBlockBadgeHtml, getClassStatusIcon } from './utils/dom-helpers.js';
import { SYSTEM_ROLES, CLASS_STATUS, BLOCK_TYPES, CONTACT_STATUS, CARE_STATUS, ABSENCE_FILTERS, ROOT_CAUSES } from './constants/index.js';

import { db, collection, query, where, getDocs, orderBy } from './firebase-init.js';

// Global State
let currentSession = null;
let globalConfig = { available_semesters: [], current_semester: '' };
let currentSemester = '';
let selectedSemester = '';
let allTasks = [];
let filteredTasks = [];
let studentDebtsMap = new Map();
const expandedRowIds = new Set();
const selectedRowIds = new Set();

const studentProfileCache = new Map();
const careLogsCache = new Map();
let subjectsCache = new Map();
let teachersCache = new Map();

// DOM Elements
const kpiTotal = document.getElementById('kpiTotal');
const kpiPending = document.getElementById('kpiPending');
const kpiCompleted = document.getElementById('kpiCompleted');
const kpiRate = document.getElementById('kpiRate');

const inpSearch = document.getElementById('inpSearch');
const selectSemesterFilter = document.getElementById('selectSemesterFilter');
const selectScopeFilter = document.getElementById('selectScopeFilter');
const selectBlockFilter = document.getElementById('selectBlockFilter');
const selectClassStatusFilter = document.getElementById('selectClassStatusFilter');
const selectAbsenceFilter = document.getElementById('selectAbsenceFilter');
const selectClassFilter = document.getElementById('selectClassFilter');
const selectTeacherFilter = document.getElementById('selectTeacherFilter');
const filterItemTeacher = document.getElementById('filterItemTeacher');
const selectContactStatusFilter = document.getElementById('selectContactStatusFilter');
const selectCareStatusFilter = document.getElementById('selectCareStatusFilter');
const selectDebtFilter = document.getElementById('selectDebtFilter');
const selectRootCauseFilter = document.getElementById('selectRootCauseFilter');
const tasksTableBody = document.getElementById('tasksTableBody');
const thTeacher = document.getElementById('thTeacher');


document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Xác thực người dùng
        currentSession = await checkAuth();
        if (!currentSession) return;

        // 2. Tải cấu hình kỳ học, danh mục môn học & giảng viên
        await initGlobalData();

        // 3. Tải danh sách nhiệm vụ chăm sóc
        await loadTasks();

        // 4. Đăng ký sự kiện tìm kiếm & lọc
        setupEventListeners();

    } catch (error) {
        console.error("Lỗi khởi tạo module Tasks:", error);
        showToast("Có lỗi khi khởi tạo hệ thống: " + error.message, "error");
    }
});

/**
 * Nạp cấu hình kỳ học và danh mục dùng chung
 */
async function initGlobalData() {
    const config = await SemesterService.getGlobalConfig();
    globalConfig = config;
    currentSemester = config.current_semester || '';
    if (!selectedSemester) selectedSemester = currentSemester;

    // Đổ danh sách kỳ vào Combobox
    if (selectSemesterFilter) {
        selectSemesterFilter.innerHTML = config.sorted_semesters.map(sem => {
            const isCurrent = (sem === currentSemester);
            const label = isCurrent ? `📅 ${sem} (Hiện tại)` : `📅 ${sem}`;
            return `<option value="${sem}" ${sem === selectedSemester ? 'selected' : ''}>${label}</option>`;
        }).join('');
    }

    // Tải Cache Môn học & Giảng viên qua Service Layer
    const [subMap, teachMap] = await Promise.all([
        SubjectService.getSubjectsMap(),
        TeacherService.getTeachersMap()
    ]);
    subjectsCache = subMap;
    teachersCache = teachMap;
}

/**
 * Đăng ký các sự kiện tương tác bộ lọc & Gửi Email Hàng Loạt
 */
function setupEventListeners() {
    if (inpSearch) inpSearch.addEventListener('input', applyFilters);
    if (selectScopeFilter) selectScopeFilter.addEventListener('change', onScopeOrTeacherChange);
    if (selectBlockFilter) selectBlockFilter.addEventListener('change', onScopeOrTeacherChange);
    if (selectClassStatusFilter) selectClassStatusFilter.addEventListener('change', onScopeOrTeacherChange);
    if (selectAbsenceFilter) selectAbsenceFilter.addEventListener('change', onScopeOrTeacherChange);
    if (selectTeacherFilter) selectTeacherFilter.addEventListener('change', onScopeOrTeacherChange);
    if (selectClassFilter) selectClassFilter.addEventListener('change', applyFilters);
    if (selectContactStatusFilter) selectContactStatusFilter.addEventListener('change', applyFilters);
    if (selectCareStatusFilter) selectCareStatusFilter.addEventListener('change', applyFilters);
    if (selectDebtFilter) selectDebtFilter.addEventListener('change', applyFilters);
    if (selectRootCauseFilter) selectRootCauseFilter.addEventListener('change', applyFilters);


    // Nút Làm Mới Dữ Liệu
    const btnRefreshTasks = document.getElementById('btnRefreshTasks');
    if (btnRefreshTasks) {
        btnRefreshTasks.addEventListener('click', async () => {
            showToast("🔄 Đang làm mới dữ liệu từ máy chủ...", "info");
            await loadTasks(true);
        });
    }


    // Checkbox Chọn Tất Cả
    const chkSelectAll = document.getElementById('chkSelectAllTasks');
    if (chkSelectAll) {
        chkSelectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            filteredTasks.forEach(t => {
                if (isChecked) selectedRowIds.add(t.id);
                else selectedRowIds.delete(t.id);
            });
            document.querySelectorAll('.chk-task-row').forEach(cb => {
                cb.checked = isChecked;
            });
            updateBulkButtonState();
        });
    }

    // Nút Gửi Email Hàng Loạt
    const btnBulkSendEmail = document.getElementById('btnBulkSendEmail');
    if (btnBulkSendEmail) {
        btnBulkSendEmail.addEventListener('click', () => {
            if (selectedRowIds.size === 0) {
                showToast("Vui lòng tích chọn ít nhất 1 sinh viên!", "warning");
                return;
            }
            const selectedDocIds = Array.from(selectedRowIds);
            const aggregatedList = EmailRollupService.aggregateBulkSelection(selectedDocIds, allTasks, subjectsCache, teachersCache);

            EmailModalComponent.openBulkModal(aggregatedList, currentSession, async (res) => {
                selectedRowIds.clear();
                if (chkSelectAll) chkSelectAll.checked = false;
                updateBulkButtonState();
                await loadTasks(true);
            });
        });
    }

    // Nút Sao Chép Tất Cả MSSV Dạng Array [PH49836, PH49938]
    const btnCopyStudentIds = document.getElementById('btnCopyStudentIds');
    if (btnCopyStudentIds) {
        btnCopyStudentIds.addEventListener('click', async () => {
            const uniqueStudentIds = Array.from(new Set(
                filteredTasks
                    .map(t => (t.student_id ? t.student_id.trim() : ''))
                    .filter(Boolean)
            ));

            if (uniqueStudentIds.length === 0) {
                showToast("Không có mã sinh viên nào trong danh sách hiển thị!", "warning");
                return;
            }

            const arrayFormatted = `[${uniqueStudentIds.join(', ')}]`;

            try {
                await navigator.clipboard.writeText(arrayFormatted);
                const samplePreview = uniqueStudentIds.slice(0, 2).join(', ');
                const moreText = uniqueStudentIds.length > 2 ? ', ...' : '';
                showToast(`📋 Đã sao chép ${uniqueStudentIds.length} mã SV dạng [${samplePreview}${moreText}] vào Clipboard!`, "success");
            } catch (err) {
                console.error("Lỗi khi sao chép Clipboard:", err);
                // Fallback copy qua textarea
                const tempTextArea = document.createElement('textarea');
                tempTextArea.value = arrayFormatted;
                document.body.appendChild(tempTextArea);
                tempTextArea.select();
                document.execCommand('copy');
                document.body.removeChild(tempTextArea);
                showToast(`📋 Đã sao chép ${uniqueStudentIds.length} mã SV vào Clipboard!`, "success");
            }
        });
    }


    if (selectSemesterFilter) {
        selectSemesterFilter.addEventListener('change', async (e) => {
            selectedSemester = e.target.value;
            showToast(`Đang tải dữ liệu học kỳ: ${selectedSemester}...`, "info");

            if (inpSearch) inpSearch.value = '';
            if (selectScopeFilter) selectScopeFilter.value = 'all';
            if (selectBlockFilter) selectBlockFilter.value = 'all';
            if (selectClassStatusFilter) selectClassStatusFilter.value = 'Ongoing';
            if (selectAbsenceFilter) selectAbsenceFilter.value = 'all';
            if (selectContactStatusFilter) selectContactStatusFilter.value = 'all';
            if (selectCareStatusFilter) selectCareStatusFilter.value = 'all';
            if (selectTeacherFilter) selectTeacherFilter.value = 'all';

            selectedRowIds.clear();
            updateBulkButtonState();
            await loadTasks(false);
        });
    }
}

/**
 * Cập nhật trạng thái nút Gửi Email Hàng Loạt
 */
function updateBulkButtonState() {
    const btnBulk = document.getElementById('btnBulkSendEmail');
    if (!btnBulk) return;

    if (selectedRowIds.size === 0) {
        btnBulk.style.display = 'none';
        return;
    }

    // Đếm số sinh viên duy nhất (đã gộp)
    const uniqueStudents = new Set();
    allTasks.forEach(r => {
        if (selectedRowIds.has(r.id) && r.student_id) {
            uniqueStudents.add(r.student_id.trim());
        }
    });

    btnBulk.style.display = 'inline-flex';
    btnBulk.querySelector('span').textContent = `✉️ Gửi Email (${uniqueStudents.size} SV / ${selectedRowIds.size} ca)`;
}


/**
 * Tải danh sách nhiệm vụ chăm sóc theo học kỳ đã chọn (có Multi-Tier Cache)
 * @param {boolean} forceRefresh
 */
async function loadTasks(forceRefresh = false) {
    if (!tasksTableBody) return;
    tasksTableBody.innerHTML = `
        <tr>
            <td colspan="11" class="text-center" style="padding: 40px;">
                <div class="loader" style="display: inline-block; width: 32px; height: 32px; border-top-color: var(--primary-color);"></div>
                <div style="margin-top: 10px; color: var(--text-secondary); font-size: 0.85rem;">Đang tải danh sách sinh viên (${selectedSemester})...</div>
            </td>
        </tr>
    `;

    try {
        const teacherId = (currentSession.teacher_id || (currentSession.email ? currentSession.email.split('@')[0] : '')).toLowerCase().trim();
        const isTeacher = currentSession.role === SYSTEM_ROLES.TEACHER;
        const activeSemester = selectedSemester || currentSemester;

        if (isTeacher) {
            allTasks = await AcademicService.getTeacherTasks(activeSemester, teacherId, forceRefresh);
        } else {
            allTasks = await AcademicService.getRecordsBySemester(activeSemester, teacherId, forceRefresh);
        }

        // Sắp xếp mặc định theo MSSV (A-Z)
        allTasks.sort((a, b) => (a.student_id || '').localeCompare(b.student_id || ''));

        // 1. Tải bản đồ nợ môn (Debt Summary Map) cho toàn bộ sinh viên trong kỳ (có Cache SessionStorage)
        const studentIds = Array.from(new Set(allTasks.map(t => t.student_id).filter(Boolean)));
        const previousSemester = getPreviousSemester(activeSemester, globalConfig.available_semesters);
        studentDebtsMap = await StudentService.getStudentsDebtSummaryMap(studentIds, activeSemester, previousSemester, forceRefresh);

        // 2. Gắn thông tin nợ môn & kiểm tra nợ môn tiên quyết vào từng ca trong RAM
        allTasks.forEach(item => {
            const sId = item.student_id;
            const dInfo = studentDebtsMap.get(sId) || { debt_count: 0, debts_list: [], has_recent_debt: false, recent_debts_list: [] };
            item.debt_count = dInfo.debt_count || 0;
            item.debts_list = dInfo.debts_list || [];
            item.has_recent_debt = dInfo.has_recent_debt || false;
            item.recent_debts_list = dInfo.recent_debts_list || [];

            // Kiểm tra nợ môn tiên quyết (cả tiên quyết trực tiếp của môn đang học & môn tiên quyết trong CTĐT)
            item.has_prerequisite_debt = false;
            item.has_direct_prereq_debt = false;
            item.prereq_debt_courses = [];

            // 1. Kiểm tra Tiên quyết trực tiếp của môn đang học (Direct Prerequisite)
            if (item.course_code) {
                const subObj = SubjectService.findSubjectData(item.course_code) || (subjectsCache ? subjectsCache.get(item.course_code) : null);
                if (subObj && subObj.prerequisites) {
                    const prereqs = Array.isArray(subObj.prerequisites) 
                        ? subObj.prerequisites 
                        : subObj.prerequisites.split(',').map(s => s.trim().toUpperCase());
                    
                    prereqs.forEach(pCode => {
                        const cleanP = (pCode || '').split(' ')[0].split('(')[0].trim().toUpperCase();
                        if (cleanP && item.debts_list.some(d => (d || '').split(' ')[0].split('(')[0].trim().toUpperCase() === cleanP)) {
                            item.has_prerequisite_debt = true;
                            item.has_direct_prereq_debt = true;
                            if (!item.prereq_debt_courses.includes(cleanP)) {
                                item.prereq_debt_courses.push(cleanP);
                            }
                        }
                    });
                }
            }

            // 2. Kiểm tra nếu trong danh sách môn nợ của SV có môn nào là Môn Tiên Quyết trong CTĐT (General Prerequisite Debt)
            if (item.debts_list && item.debts_list.length > 0) {
                item.debts_list.forEach(dCode => {
                    const cleanD = (dCode || '').split(' ')[0].split('(')[0].trim().toUpperCase();
                    if (!cleanD) return;
                    const dSubObj = SubjectService.findSubjectData(cleanD) || (subjectsCache ? subjectsCache.get(cleanD) : null);
                    if (dSubObj) {
                        const isPrereqSubject = dSubObj.is_prerequisite === true || (Array.isArray(dSubObj.prerequisites) && dSubObj.prerequisites.length > 0);
                        if (isPrereqSubject) {
                            item.has_prerequisite_debt = true;
                            if (!item.prereq_debt_courses.includes(cleanD)) {
                                item.prereq_debt_courses.push(cleanD);
                            }
                        }
                    }
                });
            }

        });

        // Cập nhật bộ lọc Giảng viên & Lớp học
        setupTeacherFilterDropdown();
        updateCascadingClassDropdown();
        applyFilters();

    } catch (error) {
        console.error("Lỗi khi tải tasks:", error);
        tasksTableBody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center text-danger" style="padding: 30px;">
                    ❌ Lỗi tải dữ liệu: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Khởi tạo Dropdown Giảng viên chăm sóc cho Admin / Super Admin
 */
function setupTeacherFilterDropdown() {
    const isTeacher = currentSession.role === SYSTEM_ROLES.TEACHER;
    if (isTeacher) {
        if (filterItemTeacher) filterItemTeacher.style.display = 'none';
        if (thTeacher) thTeacher.style.display = 'none';
        return;
    }

    if (filterItemTeacher) filterItemTeacher.style.display = 'flex';
    if (thTeacher) thTeacher.style.display = '';

    if (!selectTeacherFilter) return;

    let html = `<option value="all">👨‍🏫 Tất cả Giảng viên</option>`;
    html += `<option value="unassigned">⚠️ Chưa phân công</option>`;

    teachersCache.forEach((t, tid) => {
        const name = t.name || t.full_name || tid;
        html += `<option value="${tid}">👨‍🏫 ${tid} - ${name}</option>`;
    });

    selectTeacherFilter.innerHTML = html;
}

/**
 * Cập nhật Dropdown Lớp - Môn học động (Cascading Filter)
 */
function updateCascadingClassDropdown() {
    if (!selectClassFilter) return;

    const scopeVal = selectScopeFilter ? selectScopeFilter.value : 'all';
    const blockVal = selectBlockFilter ? selectBlockFilter.value : 'all';
    const classStatusVal = selectClassStatusFilter ? selectClassStatusFilter.value : 'all';
    const absenceVal = selectAbsenceFilter ? selectAbsenceFilter.value : 'all';
    const teacherVal = selectTeacherFilter ? selectTeacherFilter.value : 'all';

    const currentSelected = selectClassFilter.value;
    const classMap = new Map();

    allTasks.forEach(item => {
        if (scopeVal === 'assigned' && !item.is_assigned) return;
        if (scopeVal === 'teaching' && !item.is_teaching) return;
        if (blockVal !== 'all' && item.block !== blockVal) return;
        if (classStatusVal !== 'all' && item.class_status !== classStatusVal) return;

        const totalAbs = Number(item.total_absences) || 0;
        if (absenceVal === 'all_risk' && totalAbs < 2) return;
        if (absenceVal === '1' && totalAbs !== 1) return;
        if (absenceVal === '2' && totalAbs !== 2) return;
        if (absenceVal === '3' && totalAbs !== 3) return;
        if (absenceVal === 'gte4' && totalAbs < 4) return;

        if (teacherVal === 'unassigned' && item.caregiver_id) return;
        if (teacherVal !== 'all' && teacherVal !== 'unassigned' && (item.caregiver_id || '').toLowerCase() !== teacherVal.toLowerCase()) return;

        const className = item.class_name || item.class_id || 'Chưa rõ lớp';
        const courseCode = item.course_code || 'Chưa rõ môn';
        const key = `${className}___${courseCode}`;

        if (!classMap.has(key)) {
            classMap.set(key, {
                className: className,
                courseCode: courseCode,
                block: item.block || 'Block 1',
                count: 0
            });
        }
        classMap.get(key).count++;
    });

    let html = `<option value="all">🏫 Tất cả Lớp - Môn (${classMap.size})</option>`;
    const sortedKeys = Array.from(classMap.keys()).sort();

    sortedKeys.forEach(k => {
        const info = classMap.get(k);
        const selectedAttr = k === currentSelected ? 'selected' : '';
        html += `<option value="${k}" ${selectedAttr}>${info.className} - ${info.courseCode} (${info.block}) [${info.count} SV]</option>`;
    });

    selectClassFilter.innerHTML = html;
}

/**
 * Xử lý khi bộ lọc thay đổi
 */
function onScopeOrTeacherChange() {
    updateCascadingClassDropdown();
    applyFilters();
}

/**
 * Bộ lọc dữ liệu chính và Render Table
 */
function applyFilters() {
    const searchVal = inpSearch ? inpSearch.value.trim().toLowerCase() : '';
    const scopeVal = selectScopeFilter ? selectScopeFilter.value : 'all';
    const blockVal = selectBlockFilter ? selectBlockFilter.value : 'all';
    const classStatusVal = selectClassStatusFilter ? selectClassStatusFilter.value : 'all';
    const absenceVal = selectAbsenceFilter ? selectAbsenceFilter.value : 'all';
    const classVal = selectClassFilter ? selectClassFilter.value : 'all';
    const teacherVal = selectTeacherFilter ? selectTeacherFilter.value : 'all';
    const contactVal = selectContactStatusFilter ? selectContactStatusFilter.value : 'all';
    const careVal = selectCareStatusFilter ? selectCareStatusFilter.value : 'all';
    const debtVal = selectDebtFilter ? selectDebtFilter.value : 'all';

    filteredTasks = allTasks.filter(item => {
        // 1. Phạm vi
        if (scopeVal === 'assigned' && !item.is_assigned) return false;
        if (scopeVal === 'teaching' && !item.is_teaching) return false;

        // 2. Block
        if (blockVal !== 'all' && item.block !== blockVal) return false;

        // 3. Trạng thái lớp
        if (classStatusVal !== 'all' && item.class_status !== classStatusVal) return false;

        // 4. Mức độ vắng
        const totalAbs = Number(item.total_absences) || 0;
        if (absenceVal === 'all_risk' && totalAbs < 2) return false;
        if (absenceVal === '1' && totalAbs !== 1) return false;
        if (absenceVal === '2' && totalAbs !== 2) return false;
        if (absenceVal === '3' && totalAbs !== 3) return false;
        if (absenceVal === 'gte4' && totalAbs < 4) return false;

        // 5. Lớp - Môn học
        if (classVal !== 'all') {
            const className = item.class_name || item.class_id || 'Chưa rõ lớp';
            const courseCode = item.course_code || 'Chưa rõ môn';
            const itemClassKey = `${className}___${courseCode}`;
            if (itemClassKey !== classVal) return false;
        }

        // 6. Giảng viên chăm sóc (Admin filter)
        if (teacherVal === 'unassigned' && item.caregiver_id) return false;
        if (teacherVal !== 'all' && teacherVal !== 'unassigned' && (item.caregiver_id || '').toLowerCase() !== teacherVal.toLowerCase()) return false;

        // 7. Tình trạng liên lạc
        if (contactVal !== 'all') {
            const curContact = item.contact_status || 'Chưa liên lạc';
            if (curContact !== contactVal) return false;
        }

        // 8. Kết quả chăm sóc
        if (careVal !== 'all') {
            if (careVal === 'none' && item.care_status) return false;
            if (careVal !== 'none' && item.care_status !== careVal) return false;
        }

        // 9. Lọc theo tình trạng nợ môn
        if (debtVal !== 'all') {
            const dCount = item.debt_count || 0;
            if (debtVal === 'critical_debt' && dCount < 3) return false;
            if (debtVal === 'has_debt' && dCount < 1) return false;
            if (debtVal === 'no_debt' && dCount > 0) return false;
            if (debtVal === 'recent_debt' && !item.has_recent_debt) return false;
            if (debtVal === 'prereq_debt' && !item.has_prerequisite_debt) return false;
        }

        // 10. Lọc theo nguyên nhân gốc rễ
        const rootCauseVal = selectRootCauseFilter ? selectRootCauseFilter.value : 'all';
        if (rootCauseVal !== 'all') {
            const causes = Array.isArray(item.root_causes) ? item.root_causes : [];
            const matched = causes.includes(rootCauseVal) || causes.some(c => {
                const rcObj = ROOT_CAUSES.find(rc => rc.id === rootCauseVal);
                return rcObj && (c === rcObj.label || c === rcObj.shortLabel);
            });
            if (!matched) return false;
        }

        // 11. Tìm kiếm từ khóa
        if (searchVal) {
            const name = (item.student_name || item.name || '').toLowerCase();
            const sid = (item.student_id || '').toLowerCase();
            const cls = (item.class_name || item.class_id || '').toLowerCase();
            const code = (item.course_code || '').toLowerCase();
            const phone = (item.phone || '').toLowerCase();
            const teacher = (item.teacher_id || '').toLowerCase();
            const caregiver = (item.caregiver_id || '').toLowerCase();
            if (!name.includes(searchVal) && 
                !sid.includes(searchVal) && 
                !cls.includes(searchVal) && 
                !code.includes(searchVal) && 
                !phone.includes(searchVal) &&
                !teacher.includes(searchVal) &&
                !caregiver.includes(searchVal)) {
                return false;
            }
        }

        return true;
    });

    updateKPICards(filteredTasks);
    renderTasksTable(filteredTasks);
}



/**
 * Cập nhật số liệu các Thẻ KPI tóm tắt
 */
function updateKPICards(tasks) {
    const total = tasks.length;
    let completedCount = 0;

    tasks.forEach(t => {
        if (t.care_status || t.status === 'Completed') {
            completedCount++;
        }
    });

    const pendingCount = total - completedCount;
    const rate = total > 0 ? Math.round((completedCount / total) * 100) : 0;

    if (kpiTotal) kpiTotal.textContent = total;
    if (kpiPending) kpiPending.textContent = pendingCount;
    if (kpiCompleted) kpiCompleted.textContent = completedCount;
    if (kpiRate) kpiRate.textContent = `${rate}%`;
}

/**
 * Render Bảng Danh Sách Sinh Viên (Master Table)
 */
function renderTasksTable(tasks) {
    if (!tasksTableBody) return;
    const isTeacher = currentSession.role === SYSTEM_ROLES.TEACHER;

    if (tasks.length === 0) {
        tasksTableBody.innerHTML = `
            <tr>
                <td colspan="${isTeacher ? 11 : 12}" class="text-center" style="padding: 40px; color: var(--text-secondary); font-size: 0.9rem;">
                    🔍 Không tìm thấy ca sinh viên nào phù hợp với bộ lọc.
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    tasks.forEach(item => {
        const isExpanded = expandedRowIds.has(item.id);
        const contactStatus = item.contact_status || CONTACT_STATUS.CHUA_LIEN_LAC;
        const careStatus = item.care_status || '-';
        const lastCareDate = formatDateTime(item.last_care_date || item.updated_at);
        const absence = Number(item.total_absences) || 0;
        const absenceClass = getAbsenceBadgeClass(absence);

        let roleBadgeHtml = '';
        if (item.is_assigned && item.is_teaching) {
            roleBadgeHtml = `<div class="badge-role badge-role-both">🎯 Phân công & 🏫 Đứng lớp</div>`;
        } else if (item.is_assigned) {
            roleBadgeHtml = `<div class="badge-role badge-role-assigned">🎯 Phân công</div>`;
        } else if (item.is_teaching) {
            roleBadgeHtml = `<div class="badge-role badge-role-teaching">🏫 Đứng lớp</div>`;
        }

        // Tạo Huy Hiệu Nợ Môn Trực Quan
        let debtBadgeHtml = '';
        const dCount = item.debt_count || 0;
        if (dCount >= 3) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-danger" title="Đang nợ ${dCount} môn: ${(item.debts_list || []).join(', ')}">🚨 Nợ ${dCount} môn</div>`;
        } else if (dCount > 0) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-warning" title="Đang nợ ${dCount} môn: ${(item.debts_list || []).join(', ')}">⚠️ Nợ ${dCount} môn</div>`;
        } else {
            debtBadgeHtml += `<div class="badge-debt badge-debt-safe" title="Không nợ môn tích lũy">🟢 0 nợ</div>`;
        }

        if (item.has_recent_debt) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-recent" title="Có môn vừa nợ kỳ trước: ${(item.recent_debts_list || []).join(', ')}">⚡ Nợ kỳ trước</div>`;
        }
        if (item.has_prerequisite_debt) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-prereq" title="Nợ môn tiên quyết của môn này: ${(item.prereq_debt_courses || []).join(', ')}">🔗 Nợ tiên quyết</div>`;
        }

        // Tạo Huy Hiệu Nguyên Nhân Gốc Rễ
        const rootBadgesHtml = (Array.isArray(item.root_causes) && item.root_causes.length > 0)
            ? `<div style="display: flex; flex-wrap: wrap; gap: 2px; margin-top: 4px;">
                ${item.root_causes.map(rcId => {
                    const rcObj = ROOT_CAUSES.find(rc => rc.id === rcId || rc.label === rcId);
                    const label = rcObj ? rcObj.shortLabel || rcObj.label : rcId;
                    const color = rcObj ? rcObj.color : '#6f42c1';
                    const bg = rcObj ? rcObj.bg : '#f3e8ff';
                    return `<span class="root-cause-badge" style="color: ${color}; background-color: ${bg}; border: 1px solid ${color}33; font-size: 0.68rem; padding: 1px 5px;">🏷️ ${label}</span>`;
                }).join('')}
               </div>`
            : '';

        html += `
            <tr class="expandable-row ${isExpanded ? 'row-expanded' : ''}" id="row-${item.id}" data-docid="${item.id}" data-studentid="${item.student_id}">
                <td class="col-select text-center" data-label="Chọn" onclick="event.stopPropagation();">
                    <input type="checkbox" class="chk-task-row" data-id="${item.id}" ${selectedRowIds.has(item.id) ? 'checked' : ''}>
                </td>
                <td class="col-expand text-center" data-label="">
                    <button type="button" class="btn-toggle-expand" title="Mở rộng chăm sóc">
                        <span class="chevron-icon">▶</span>
                    </button>
                </td>
                <td class="col-student-id" data-label="Mã SV">
                    <div><strong>${item.student_id || '-'}</strong></div>
                    ${roleBadgeHtml}
                    <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 2px;">
                        ${debtBadgeHtml}
                    </div>
                </td>
                <td class="col-name" data-label="Họ Tên">${item.student_name || item.name || '-'}</td>
                <td class="col-course" data-label="Môn Học">${item.course_code || '-'}</td>
                <td class="col-class" data-label="Lớp & Block">
                    <div style="display: flex; flex-direction: column; gap: 3px;">
                        <span>${getClassStatusIcon(item.class_status)} <strong>${item.class_name || item.class_id || '-'}</strong></span>
                        ${getBlockBadgeHtml(item.block)}
                    </div>
                </td>
                <td class="col-absence text-center ${absenceClass}" data-label="Vắng">${absence}</td>
                ${!isTeacher ? `<td class="col-caregiver" data-label="GV Chăm Sóc">${item.caregiver_id || '-'}</td>` : ''}
                <td class="col-contact-status" data-label="Liên Lạc">
                    ${getContactBadgeHtml(contactStatus)}
                </td>
                <td class="col-care-status" data-label="Kết Quả CS">
                    ${getCareBadgeHtml(careStatus)}
                    ${rootBadgesHtml}
                </td>
                <td class="col-care-time" data-label="Lần CS Cuối" style="font-size: 0.8rem; color: var(--text-secondary);">
                    ${lastCareDate}
                </td>
                <td class="col-actions text-center" data-label="Thao Tác">
                    <button type="button" class="btn-care-action">
                        ${isExpanded ? '▲ Thu gọn' : '🎯 Chăm sóc'}
                    </button>
                </td>
            </tr>


            <!-- Dòng Con Mở Rộng Accordion 360 -->
            <tr class="inline-detail-row" id="detail-row-${item.id}" style="display: ${isExpanded ? 'table-row' : 'none'};">
                <td colspan="${isTeacher ? 11 : 12}">
                    <div class="inline-workspace-wrapper" id="workspace-${item.id}">
                        <div style="text-align: center; padding: 20px; color: var(--text-secondary);">
                            <div class="loader" style="display: inline-block; width: 24px; height: 24px; border-top-color: var(--primary-color);"></div>
                            <div style="margin-top: 8px; font-size: 0.82rem;">Đang tải hồ sơ 360°...</div>
                        </div>
                    </div>
                </td>
            </tr>
        `;
    });

    tasksTableBody.innerHTML = html;

    // Gắn sự kiện Checkbox từng dòng
    const rowCheckboxes = tasksTableBody.querySelectorAll('.chk-task-row');
    rowCheckboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const docId = e.target.getAttribute('data-id');
            if (e.target.checked) selectedRowIds.add(docId);
            else selectedRowIds.delete(docId);
            updateBulkButtonState();
        });
    });

    // Gắn sự kiện click mở rộng Accordion
    tasks.forEach(item => {
        const row = document.getElementById(`row-${item.id}`);
        if (row) {
            row.addEventListener('click', (e) => {
                if (e.target.closest('a') || e.target.closest('input') || e.target.closest('button')) return;
                toggleInlineRow(item.id, item.student_id);
            });

            const btnAction = row.querySelector('.btn-care-action');
            if (btnAction) {
                btnAction.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleInlineRow(item.id, item.student_id);
                });
            }
        }

        if (expandedRowIds.has(item.id)) {
            renderInlineWorkspace(item.id, item.student_id);
        }
    });
}

/**
 * Window Hook: Mở Modal Gửi Email Đơn Lẻ từ Header Hồ Sơ 360°
 */
window.handleOpenSingleEmailModal = function(studentId, docId) {
    const studentPayload = EmailRollupService.aggregateStudentData(studentId, allTasks, subjectsCache, teachersCache);
    if (!studentPayload) {
        showToast("Không tìm thấy thông tin sinh viên để gửi email!", "warning");
        return;
    }

    EmailModalComponent.openSingleModal(studentPayload, currentSession, async (res) => {
        // Cập nhật timestamp vào RAM
        const target = allTasks.find(t => (t.id === docId || t.docId === docId));
        if (target) {
            target.last_email_sent_at = res.sent_at;
        }

        // Tải lại timeline chăm sóc
        await loadCareTimelineAsync(docId, studentId);
        renderTasksTable(filteredTasks);
    });
};


/**
 * Đóng/Mở Hàng Accordion
 */
async function toggleInlineRow(docId, studentId) {
    const mainRow = document.getElementById(`row-${docId}`);
    const detailRow = document.getElementById(`detail-row-${docId}`);
    const btnAction = mainRow ? mainRow.querySelector('.btn-care-action') : null;

    if (!mainRow || !detailRow) return;

    if (expandedRowIds.has(docId)) {
        expandedRowIds.delete(docId);
        mainRow.classList.remove('row-expanded');
        detailRow.style.display = 'none';
        if (btnAction) btnAction.innerHTML = '🎯 Chăm sóc';
    } else {
        expandedRowIds.add(docId);
        mainRow.classList.add('row-expanded');
        detailRow.style.display = 'table-row';
        if (btnAction) btnAction.innerHTML = '▲ Thu gọn';
        await renderInlineWorkspace(docId, studentId);
    }
}

/**
 * Nạp Dữ Liệu & Render Không Gian Làm Việc 360° Inline
 */
async function renderInlineWorkspace(docId, studentId) {
    const wsContainer = document.getElementById(`workspace-${docId}`);
    if (!wsContainer) return;

    const record = allTasks.find(t => t.id === docId) || {};

    try {
        // 1. Tải hồ sơ sinh viên từ StudentService (có cache)
        let studentData = studentProfileCache.get(studentId);
        if (!studentData) {
            studentData = await StudentService.getStudentProfile(studentId);
            if (studentData) studentProfileCache.set(studentId, studentData);
        }

        // 2. Render HTML Không gian 360° qua Component độc lập
        wsContainer.innerHTML = AccordionWorkspaceComponent.render(
            record,
            studentData,
            subjectsCache,
            record.is_teaching,
            allTasks
        );


        // 3. Tải CareLogs Timeline bất đồng bộ
        loadCareTimelineAsync(docId, studentId);

    } catch (error) {
        console.error("Lỗi khi render workspace inline:", error);
        wsContainer.innerHTML = `<div class="text-danger" style="padding: 10px;">❌ Lỗi khi tải hồ sơ: ${error.message}</div>`;
    }
}

/**
 * Tải danh sách CareLogs của sinh viên và đổ vào Timeline
 */
async function loadCareTimelineAsync(docId, studentId) {
    const timelineEl = document.getElementById(`carelogs_timeline_${docId}`) || document.getElementById(`careLogsList-${docId}`);
    const countEl = document.getElementById(`careLogCount-${docId}`);
    if (!timelineEl) return;

    try {
        let logs = await AcademicService.getStudentCareLogs(studentId);

        if (countEl) countEl.textContent = logs.length;

        if (logs.length === 0) {
            timelineEl.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.8rem; padding: 6px 0;">Chưa có lịch sử chăm sóc nào.</div>`;
            return;
        }

        timelineEl.innerHTML = logs.map(l => {
            const contactStatus = l.contact_status || 'Chưa liên lạc';
            const careStatus = l.care_status || '-';

            let contactBadgeClass = 'badge-contact-chua-ll';
            if (contactStatus === 'Đã liên lạc') contactBadgeClass = 'badge-contact-da-ll';
            else if (contactStatus === 'Không nghe máy') contactBadgeClass = 'badge-contact-khong-nghe';
            else if (contactStatus === 'Sai số điện thoại') contactBadgeClass = 'badge-contact-sai-so';

            let careBadgeClass = 'badge-care-none';
            if (careStatus === 'Đã đi học') careBadgeClass = 'badge-care-da-di-hoc';
            else if (careStatus === 'Sẽ đi học') careBadgeClass = 'badge-care-se-di-hoc';
            else if (careStatus === 'Nghỉ học kỳ') careBadgeClass = 'badge-care-nghi-ky';
            else if (careStatus === 'Lý do khác') careBadgeClass = 'badge-care-ly-do-khac';

            const rootCausesHtml = (Array.isArray(l.root_causes) && l.root_causes.length > 0)
                ? `<div style="display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px;">
                    ${l.root_causes.map(rcId => {
                        const rcObj = ROOT_CAUSES.find(r => r.id === rcId || r.label === rcId);
                        const label = rcObj ? rcObj.shortLabel || rcObj.label : rcId;
                        const color = rcObj ? rcObj.color : '#6f42c1';
                        const bg = rcObj ? rcObj.bg : '#f3e8ff';
                        return `<span class="root-cause-badge" style="color: ${color}; background-color: ${bg}; border: 1px solid ${color}33;">🏷️ ${label}</span>`;
                    }).join('')}
                   </div>`
                : '';

            return `
                <div class="timeline-item">
                    <div class="timeline-dot"></div>
                    <div class="timeline-header">
                        <span class="timeline-caregiver">👨‍🏫 ${l.caregiver_id || 'GV'} ${l.course_code ? `(${l.course_code})` : ''}</span>
                        <span>🕒 ${formatDateTime(l.created_at)}</span>
                    </div>
                    <div style="display: flex; gap: 4px; margin-top: 3px; flex-wrap: wrap;">
                        <span class="timeline-status-badge badge-status ${contactBadgeClass}">${contactStatus}</span>
                        <span class="timeline-status-badge badge-status ${careBadgeClass}">${careStatus}</span>
                    </div>
                    ${rootCausesHtml}
                    ${l.notes ? `<div class="timeline-notes">${l.notes}</div>` : ''}
                </div>
            `;
        }).join('');

    } catch (e) {
        timelineEl.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.8rem; padding: 6px 0;">Lịch sử chăm sóc chưa có hoặc đang đồng bộ.</div>`;
    }
}

/**
 * Xử lý Lưu Form Chăm Sóc (Window Hook cho Inline Form)
 */
window.handleSaveCareForm = async function(event, docId, studentId, courseCode, semester) {
    event.preventDefault();
    const btnSave = document.getElementById(`btnSave-${docId}`);
    const contactSelect = document.getElementById(`inpContactStatus-${docId}`);
    const careSelect = document.getElementById(`inpCareStatus-${docId}`);
    const notesArea = document.getElementById(`inpCareNotes-${docId}`);

    if (!contactSelect || !careSelect || !btnSave) return;

    const contactStatus = contactSelect.value;
    const careStatus = careSelect.value;
    const notes = notesArea ? notesArea.value.trim() : '';

    // Thu thập các nguyên nhân gốc rễ đã chọn
    const selectedRootCauses = Array.from(document.querySelectorAll(`input[name="root_cause_${docId}"]:checked`)).map(cb => cb.value);

    if (!careStatus) {
        showToast("Vui lòng chọn kết quả chăm sóc trước khi lưu!", "warning");
        careSelect.focus();
        return;
    }

    btnSave.disabled = true;
    btnSave.textContent = "⏳ Đang lưu kết quả...";

    try {
        const teacherId = currentSession.email.split('@')[0];
        const nowIso = new Date().toISOString();

        const updateFields = {
            contact_status: contactStatus,
            care_status: careStatus,
            root_causes: selectedRootCauses,
            notes: notes,
            status: 'Completed',
            last_care_date: nowIso,
            caregiver_id: teacherId,
            updated_at: nowIso
        };

        const logData = {
            student_id: studentId,
            academic_record_id: docId,
            course_code: courseCode || '',
            semester: semester || currentSemester,
            contact_status: contactStatus,
            care_status: careStatus,
            root_causes: selectedRootCauses,
            notes: notes,
            caregiver_id: teacherId,
            created_at: nowIso
        };

        // Ghi qua AcademicService
        await AcademicService.saveCareResult(docId, updateFields, logData);

        // Cập nhật RAM
        const rec = allTasks.find(t => t.id === docId);
        if (rec) {
            Object.assign(rec, updateFields);
        }

        // Cập nhật cache CareLogs
        let logs = careLogsCache.get(studentId) || [];
        logs.unshift(logData);
        careLogsCache.set(studentId, logs);

        // Làm mới Timeline và KPI
        loadCareTimelineAsync(docId, studentId);
        updateKPICards(filteredTasks);

        // Cập nhật Master Row
        updateMasterRowDom(docId, updateFields);

        showToast(`🎉 Đã lưu kết quả chăm sóc cho sinh viên ${studentId} thành công!`, "success");

    } catch (e) {
        console.error("Lỗi lưu chăm sóc:", e);
        showToast(`❌ Lỗi khi lưu: ${e.message}`, "error");
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = "💾 Lưu Kết Quả Chăm Sóc";
    }
};


/**
 * Cập nhật Master Row DOM tức thì
 */
function updateMasterRowDom(docId, fields) {
    const row = document.getElementById(`row-${docId}`);
    if (!row) return;

    const tdContact = row.querySelector('.col-contact-status');
    if (tdContact) tdContact.innerHTML = getContactBadgeHtml(fields.contact_status);

    const tdCare = row.querySelector('.col-care-status');
    if (tdCare) {
        const rootBadgesHtml = (Array.isArray(fields.root_causes) && fields.root_causes.length > 0)
            ? `<div style="display: flex; flex-wrap: wrap; gap: 2px; margin-top: 4px;">
                ${fields.root_causes.map(rcId => {
                    const rcObj = ROOT_CAUSES.find(rc => rc.id === rcId || rc.label === rcId);
                    const label = rcObj ? rcObj.shortLabel || rcObj.label : rcId;
                    const color = rcObj ? rcObj.color : '#6f42c1';
                    const bg = rcObj ? rcObj.bg : '#f3e8ff';
                    return `<span class="root-cause-badge" style="color: ${color}; background-color: ${bg}; border: 1px solid ${color}33; font-size: 0.68rem; padding: 1px 5px;">🏷️ ${label}</span>`;
                }).join('')}
               </div>`
            : '';
        tdCare.innerHTML = getCareBadgeHtml(fields.care_status) + rootBadgesHtml;
    }

    const tdTime = row.querySelector('.col-care-time');
    if (tdTime) tdTime.textContent = formatDateTime(fields.last_care_date);
}


/**
 * Xử lý Thêm Nhận Xét của GV đứng lớp (Window Hook)
 */
window.handleAddInstructorRemark = async function(studentId, courseCode, docId) {
    const inp = document.getElementById(`inpRemark-${docId}`);
    const btn = document.getElementById(`btnSendRemark-${docId}`);
    const listEl = document.getElementById(`remarksList-${docId}`);
    const countEl = document.getElementById(`remarkCount-${docId}`);

    if (!inp) return;
    const note = inp.value.trim();

    if (!note) {
        showToast("Vui lòng nhập nội dung nhận xét!", "warning");
        inp.focus();
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = "⏳...";
    }

    try {
        const teacherId = currentSession.email.split('@')[0];
        const remarkObj = {
            teacher_id: teacherId,
            course_code: courseCode || 'Chưa rõ',
            note: note,
            created_at: new Date().toISOString()
        };

        const updatedRemarks = await StudentService.addInstructorRemark(studentId, remarkObj);
        
        // Cập nhật cache
        const studentData = studentProfileCache.get(studentId) || {};
        studentData.instructor_remarks = updatedRemarks;
        studentProfileCache.set(studentId, studentData);

        // Làm mới danh sách nhận xét trên UI
        if (listEl) {
            listEl.innerHTML = AccordionWorkspaceComponent.renderRemarksListHtml(updatedRemarks);
            listEl.scrollTop = listEl.scrollHeight;
        }
        if (countEl) {
            countEl.textContent = updatedRemarks.length;
        }

        inp.value = '';
        showToast("🎉 Đã thêm nhận xét của GV đứng lớp thành công!", "success");

    } catch (e) {
        console.error("Lỗi thêm nhận xét:", e);
        showToast(`❌ Lỗi: ${e.message}`, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = "💬 Gửi";
        }
    }
};

/**
 * Xử lý Mở Modal / Prompt Thêm SĐT Mới (Window Hook)
 */

window.handleOpenAddPhoneModal = async function(studentId, docId) {
    const newPhone = prompt(`Nhập số điện thoại mới cho sinh viên ${studentId}:`);
    if (!newPhone || !newPhone.trim()) return;

    const cleanPhone = newPhone.trim();
    if (cleanPhone.length < 8 || cleanPhone.length > 15) {
        showToast("Số điện thoại không hợp lệ (từ 8 đến 15 chữ số).", "warning");
        return;
    }

    try {
        const res = await StudentService.addNewPhoneNumber(studentId, cleanPhone, selectedSemester);
        
        // Cập nhật cache
        let studentData = studentProfileCache.get(studentId) || {};
        studentData.phone = res.phone;
        studentData.phone_numbers = res.phone_numbers;
        studentProfileCache.set(studentId, studentData);

        // Cập nhật RAM allTasks
        allTasks.forEach(t => {
            if (t.student_id === studentId) t.phone = res.phone;
        });

        // Render lại không gian 360
        await renderInlineWorkspace(docId, studentId);
        showToast(`Đã cập nhật SĐT mới ${cleanPhone} (ưu tiên hiển thị).`, "success");

    } catch (e) {
        console.error("Lỗi thêm SĐT:", e);
        showToast(`❌ Lỗi: ${e.message}`, "error");
    }
};
