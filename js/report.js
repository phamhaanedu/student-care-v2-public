// report.js - Phân Hệ Báo Cáo & Đánh Giá Chăm Sóc V2 (Admin Analytics & Reports)

import { db, doc, getDoc, getDocs, collection, query, where } from './firebase-init.js';
import { checkAuth } from './auth.js';
import { SemesterService } from './services/semester-service.js';
import { SubjectService } from './services/subject-service.js';
import { TeacherService } from './services/teacher-service.js';
import { StudentService } from './services/student-service.js';
import { AcademicService } from './services/academic-service.js';
import { EmailRollupService } from './services/email-rollup-service.js';
import { EmailModalComponent } from './components/email-modal.js';
import { sortSemestersList, formatDateTime, getPreviousSemester } from './utils/date-helpers.js';
import { showToast } from './utils/toast.js';
import { exportToExcel } from './utils/excel-exporter.js';
import { getContactBadgeHtml, getCareBadgeHtml, getBlockBadgeHtml, getClassStatusIcon } from './utils/dom-helpers.js';
import { SYSTEM_ROLES, CLASS_STATUS, BLOCK_TYPES, ABSENCE_FILTERS, ROOT_CAUSES } from './constants/index.js';



// ==========================================================================
// 1. STATE & GLOBAL VARIABLES
// ==========================================================================
let currentSession = null;
let globalConfig = { available_semesters: [], current_semester: '' };
let currentSemester = '';
let selectedSemester = '';
let rawRecords = []; // Toàn bộ AcademicRecords của kỳ hiện tại
const selectedReportRowIds = new Set();
const semesterDataCache = new Map(); // Session Cache: Map<semester, records[]>

const teachersCache = new Map(); // Cache Teachers: Map<docId, teacherData>
const subjectsCache = new Map(); // Cache Subjects: Map<docId, subjectData>

// Helper lấy element DOM an toàn
const $ = id => document.getElementById(id);

// ==========================================================================
// 2. KHỞI TẠO HỆ THỐNG & PHÂN QUYỀN RBAC
// ==========================================================================
document.addEventListener('DOMContentLoaded', async () => {
    try {
        console.log("Khởi tạo module Báo cáo...");

        // 1. Kiểm tra xác thực (Chỉ Admin và Super Admin được phép truy cập)
        currentSession = await checkAuth([SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.SUPER_ADMIN]);
        if (!currentSession) return;


        console.log("Phiên đăng nhập hợp lệ:", currentSession);

        // 2. Tải Cấu hình Kỳ học
        await loadConfigAndSemesters();

        // 3. Tải danh mục Môn học & Giảng viên (Không chặn luồng chính nếu có cảnh báo)
        await loadTeachersAndSubjectsCache();

        // 4. Tải dữ liệu của kỳ mặc định
        if (selectedSemester) {
            console.log("Tải dữ liệu kỳ:", selectedSemester);
            await fetchSemesterData(selectedSemester);
        } else {
            console.warn("Chưa xác định được selectedSemester!");
        }

        // 5. Đăng ký sự kiện
        setupEventListeners();

    } catch (error) {
        console.error("Lỗi khởi tạo module Báo cáo:", error);
        showToast("Có lỗi khi khởi tạo phân hệ Báo cáo: " + error.message, "error");
    }
});

// ==========================================================================
// 3. EVENT LISTENERS SETUP
// ==========================================================================
function setupEventListeners() {
    const semSelect = $('selectSemester');
    const btnRefresh = $('btnRefreshData');
    const btnExport = $('btnExportExcel');

    // 1. Chuyển đổi Học kỳ
    if (semSelect) {
        semSelect.addEventListener('change', async (e) => {
            selectedSemester = e.target.value;
            if (!selectedSemester) return;
            await fetchSemesterData(selectedSemester);
        });
    }

    // 2. Nút Làm Mới Dữ Liệu
    if (btnRefresh) {
        btnRefresh.addEventListener('click', async () => {
            if (!selectedSemester) return;
            showToast(`Đang làm mới dữ liệu kỳ ${selectedSemester}...`, "info");
            await fetchSemesterData(selectedSemester, true);
        });
    }

    // 3. Nút Xuất Báo Cáo Excel (SheetJS)
    if (btnExport) {
        btnExport.addEventListener('click', handleExportExcelReport);
    }

    // 4. Chuyển đổi Tabs
    const tabButtons = document.querySelectorAll('.report-tabs-nav .tab-btn');
    tabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTabId = btn.getAttribute('data-tab');
            
            // Xóa active cũ
            tabButtons.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

            // Kích hoạt tab mới
            btn.classList.add('active');
            const targetPane = $(targetTabId);
            if (targetPane) targetPane.classList.add('active');

            // Xử lý riêng khi mở tab Sync Logs
            if (targetTabId === 'tab-sync-logs' && !$('tableBodySyncLogs').dataset.loaded) {
                initSyncLogsTab();
            }
        });
    });

    // 5. Tìm kiếm Giảng viên ở Tab 1
    const inpTeacher = $('inpSearchTeacher');
    if (inpTeacher) {
        inpTeacher.addEventListener('input', () => {
            renderTeachersTable();
        });
    }

    // 6. Lọc danh sách chi tiết ở Tab 4 & Gửi Email Hàng Loạt
    const inpDetail = $('inpSearchDetail');
    const filterBlock = $('filterDetailBlock');
    const filterClassStatus = $('filterDetailClassStatus');
    const filterAbsence = $('filterDetailAbsence');
    const filterClass = $('filterDetailClass');
    const filterTeachingTeacher = $('filterDetailTeachingTeacher');
    const filterTeacher = $('filterDetailTeacher');
    const filterContact = $('filterDetailContact');
    const filterCare = $('filterDetailCareStatus');
    const filterDebts = $('filterDetailDebts');
    const filterRootCause = $('filterDetailRootCause');

    if (inpDetail) inpDetail.addEventListener('input', renderStudentsDetailTable);
    if (filterBlock) filterBlock.addEventListener('change', onDetailFilterGroupChange);
    if (filterClassStatus) filterClassStatus.addEventListener('change', onDetailFilterGroupChange);
    if (filterAbsence) filterAbsence.addEventListener('change', renderStudentsDetailTable);
    if (filterClass) filterClass.addEventListener('change', renderStudentsDetailTable);
    if (filterTeachingTeacher) filterTeachingTeacher.addEventListener('change', onDetailFilterGroupChange);
    if (filterTeacher) filterTeacher.addEventListener('change', onDetailFilterGroupChange);
    if (filterContact) filterContact.addEventListener('change', renderStudentsDetailTable);
    if (filterCare) filterCare.addEventListener('change', renderStudentsDetailTable);
    if (filterDebts) filterDebts.addEventListener('change', renderStudentsDetailTable);
    if (filterRootCause) filterRootCause.addEventListener('change', renderStudentsDetailTable);



    // Checkbox Chọn Tất Cả Tab 4
    const chkSelectAll = $('chkSelectAllReport');
    if (chkSelectAll) {
        chkSelectAll.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            const currentFiltered = getFilteredDetailRecords();
            currentFiltered.forEach(r => {
                const docId = r.id || r.docId;
                if (isChecked) selectedReportRowIds.add(docId);
                else selectedReportRowIds.delete(docId);
            });
            document.querySelectorAll('.chk-report-row').forEach(cb => {
                cb.checked = isChecked;
            });
            updateBulkReportButtonState();
        });
    }

    // Nút Gửi Email Hàng Loạt Tab 4
    const btnBulkReport = $('btnBulkSendEmailReport');
    if (btnBulkReport) {
        btnBulkReport.addEventListener('click', () => {
            if (selectedReportRowIds.size === 0) {
                showToast("Vui lòng tích chọn ít nhất 1 sinh viên!", "warning");
                return;
            }
            const selectedDocIds = Array.from(selectedReportRowIds);
            const aggregatedList = EmailRollupService.aggregateBulkSelection(selectedDocIds, rawRecords, subjectsCache, teachersCache);

            EmailModalComponent.openBulkModal(aggregatedList, currentSession, async (res) => {
                selectedReportRowIds.clear();
                if (chkSelectAll) chkSelectAll.checked = false;
                updateBulkReportButtonState();
                await fetchSemesterData(selectedSemester, true);
            });
        });
    }

    // Nút Sao Chép Tất Cả MSSV Dạng Array trong Tab 4 Báo Cáo
    const btnCopyReport = $('btnCopyStudentIdsReport');
    if (btnCopyReport) {
        btnCopyReport.addEventListener('click', async () => {
            const filtered = getFilteredDetailRecords();
            const uniqueStudentIds = Array.from(new Set(
                filtered
                    .map(r => (r.student_id ? r.student_id.trim() : ''))
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
    // Nút tra cứu Sync Logs
    const btnSearchSyncLogs = $('btnSearchSyncLogs');
    if (btnSearchSyncLogs) {
        btnSearchSyncLogs.addEventListener('click', () => {
            const startDate = $('filterLogStartDate').value;
            const endDate = $('filterLogEndDate').value;
            if (!startDate || !endDate) {
                showToast("Vui lòng chọn đầy đủ Từ ngày và Đến ngày", "warning");
                return;
            }
            if (startDate > endDate) {
                showToast("Ngày bắt đầu không được lớn hơn ngày kết thúc", "warning");
                return;
            }
            loadSyncLogs(startDate, endDate);
        });
    }
}


/**
 * Cập nhật trạng thái nút Gửi Email Hàng Loạt trong Tab 4 Báo Cáo
 */
function updateBulkReportButtonState() {
    const btnBulk = $('btnBulkSendEmailReport');
    if (!btnBulk) return;

    if (selectedReportRowIds.size === 0) {
        btnBulk.style.display = 'none';
        return;
    }

    const uniqueStudents = new Set();
    rawRecords.forEach(r => {
        const docId = r.id || r.docId;
        if (selectedReportRowIds.has(docId) && r.student_id) {
            uniqueStudents.add(r.student_id.trim());
        }
    });

    btnBulk.style.display = 'inline-flex';
    btnBulk.querySelector('span').textContent = `✉️ Gửi Email (${uniqueStudents.size} SV / ${selectedReportRowIds.size} ca)`;
}



// ==========================================================================
// 4. DATA LOADING & IN-MEMORY CACHING
// ==========================================================================

/**
 * Tải cấu hình kỳ học từ SemesterService (có Cache)
 */
async function loadConfigAndSemesters(forceRefresh = false) {
    try {
        const config = await SemesterService.getGlobalConfig(forceRefresh);
        globalConfig = config;
        const available = config.available_semesters || [];
        currentSemester = config.current_semester || (available[0] || '');
        selectedSemester = currentSemester;

        const semSelect = $('selectSemester');
        if (semSelect) {
            semSelect.innerHTML = config.sorted_semesters.map(sem => {
                const isCurrent = (sem === currentSemester);
                const label = isCurrent ? `📅 ${sem} (Hiện tại)` : `📅 ${sem}`;
                return `<option value="${sem}" ${sem === selectedSemester ? 'selected' : ''}>${label}</option>`;
            }).join('');
        }
    } catch (e) {
        console.error("Lỗi khi đọc Configuration/Global:", e);
    }
}

/**
 * Tải danh mục Môn học & Giảng viên qua Service Layer (có Cache)
 */
async function loadTeachersAndSubjectsCache(forceRefresh = false) {
    try {
        const [teachMap, subMap] = await Promise.all([
            TeacherService.getTeachersMap(forceRefresh),
            SubjectService.getSubjectsMap(forceRefresh)
        ]);

        teachMap.forEach((d, id) => teachersCache.set(id, d));
        subMap.forEach((d, id) => {
            subjectsCache.set(id, d);
            const rawCode = id.split(' ')[0].split('(')[0].trim();
            if (rawCode && rawCode !== id) subjectsCache.set(rawCode, d);
        });

        console.log(`Đã nạp cache ${teachersCache.size} GV và ${subjectsCache.size} môn học.`);
    } catch (e) {
        console.warn("Lưu ý khi nạp cache danh mục:", e);
    }
}

/**
 * Tải dữ liệu của 1 kỳ duy nhất qua AcademicService (có Session Caching)
 */
async function fetchSemesterData(semester, forceRefresh = false) {
    if (!semester) return;

    // Hiển thị trạng thái tải
    setLoadingState(true);

    try {
        const teacherId = (currentSession && currentSession.email ? currentSession.email.split('@')[0] : '');
        const records = await AcademicService.getRecordsBySemester(semester, teacherId, forceRefresh);

        // 1. Tải bản đồ nợ môn (Debt Summary Map) cho toàn bộ sinh viên trong kỳ (có Cache SessionStorage)
        const studentIds = Array.from(new Set(records.map(r => r.student_id).filter(Boolean)));
        const previousSemester = getPreviousSemester(semester, globalConfig.available_semesters);
        const debtMap = await StudentService.getStudentsDebtSummaryMap(studentIds, semester, previousSemester, forceRefresh);

        // 2. Gắn thông tin nợ môn & kiểm tra nợ môn tiên quyết vào từng bản ghi trong RAM
        records.forEach(item => {
            const sId = item.student_id;
            const dInfo = debtMap.get(sId) || { debt_count: 0, debts_list: [], has_recent_debt: false, recent_debts_list: [] };
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

        rawRecords = records;
        semesterDataCache.set(semester, records);

        console.log(`Đã nạp ${records.length} bản ghi của kỳ ${semester}.`);
        calculateAndRenderAllReports();

    } catch (error) {
        console.error(`Lỗi khi tải dữ liệu kỳ ${semester}:`, error);
        showToast("Lỗi khi tải dữ liệu báo cáo: " + error.message, "error");


        
        if ($('tableBodyTeachers')) {
            $('tableBodyTeachers').innerHTML = `<tr><td colspan="8" class="text-center text-danger" style="padding: 30px;">
                ⚠️ <strong>Không thể tải dữ liệu báo cáo:</strong> ${error.message}<br>
                <small style="color: var(--text-secondary); margin-top: 8px; display: inline-block;">
                    Nếu gặp lỗi phân quyền (insufficient permissions), vui lòng cập nhật <strong>Firestore Rules</strong> trên Firebase Cloud Console để cấp quyền xem cho vai trò Admin.
                </small>
            </td></tr>`;
        }
    } finally {
        setLoadingState(false);
    }
}

function setLoadingState(isLoading) {
    if (isLoading) {
        if ($('kpiTotalTasks')) $('kpiTotalTasks').textContent = "...";
        if ($('kpiCompletedRate')) $('kpiCompletedRate').textContent = "...";
        if ($('kpiContactRate')) $('kpiContactRate').textContent = "...";
        if ($('kpiReboundRate')) $('kpiReboundRate').textContent = "...";
        if ($('tableBodyTeachers')) $('tableBodyTeachers').innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 30px;">⏳ Đang tải dữ liệu kỳ ${selectedSemester}...</td></tr>`;
        if ($('tableBodyTopClasses')) $('tableBodyTopClasses').innerHTML = `<tr><td colspan="5" class="text-center text-muted">Đang tải...</td></tr>`;
        if ($('tableBodyTopSubjects')) $('tableBodyTopSubjects').innerHTML = `<tr><td colspan="5" class="text-center text-muted">Đang tải...</td></tr>`;
        if ($('tableBodyStudentsDetail')) $('tableBodyStudentsDetail').innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 30px;">Đang tải...</td></tr>`;
    }
}

// ==========================================================================
// 5. IN-MEMORY REPORT CALCULATIONS & RENDERING
// ==========================================================================

/**
 * Tính toán và cập nhật toàn bộ 4 khu vực báo cáo
 */
function calculateAndRenderAllReports() {
    renderExecutiveKPIs();
    renderTeachersTable();
    renderClassesAndSubjectsReport();
    renderOutcomeDistributionReport();
    populateDetailDropdowns();
    renderStudentsDetailTable();
}


/**
 * 1. Executive Summary KPI Cards
 */
function renderExecutiveKPIs() {
    const total = rawRecords.length;
    if (total === 0) {
        if ($('kpiTotalTasks')) $('kpiTotalTasks').textContent = "0";
        if ($('kpiTotalSub')) $('kpiTotalSub').textContent = "Không có ca sinh viên";
        if ($('kpiCompletedRate')) $('kpiCompletedRate').textContent = "0%";
        if ($('kpiCompletedSub')) $('kpiCompletedSub').textContent = "0 / 0 ca hoàn thành";
        if ($('kpiContactRate')) $('kpiContactRate').textContent = "0%";
        if ($('kpiContactSub')) $('kpiContactSub').textContent = "0 / 0 ca kết nối";
        if ($('kpiReboundRate')) $('kpiReboundRate').textContent = "0%";
        if ($('kpiReboundSub')) $('kpiReboundSub').textContent = "0 ca đi học lại";
        return;
    }

    let completedCount = 0;
    let contactedCount = 0;
    let reboundCount = 0;

    rawRecords.forEach(r => {
        // Hoàn thành: Có care_status hoặc status == 'Completed'
        if (r.care_status || r.status === 'Completed') {
            completedCount++;
        }
        // Đã liên lạc: contact_status khác rỗng và khác 'Chưa liên lạc'
        if (r.contact_status && r.contact_status !== 'Chưa liên lạc') {
            contactedCount++;
        }
        // Quay xe: Đã đi học hoặc Sẽ đi học
        if (r.care_status === 'Đã đi học' || r.care_status === 'Sẽ đi học') {
            reboundCount++;
        }
    });

    const completedPercent = Math.round((completedCount / total) * 100);
    const contactPercent = Math.round((contactedCount / total) * 100);
    const reboundPercent = completedCount > 0 ? Math.round((reboundCount / completedCount) * 100) : 0;

    if ($('kpiTotalTasks')) $('kpiTotalTasks').textContent = total;
    if ($('kpiTotalSub')) $('kpiTotalSub').textContent = `Tổng ca phát sinh kỳ ${selectedSemester}`;

    if ($('kpiCompletedRate')) $('kpiCompletedRate').textContent = `${completedPercent}%`;
    if ($('kpiCompletedSub')) $('kpiCompletedSub').textContent = `${completedCount} / ${total} ca hoàn thành`;

    if ($('kpiContactRate')) $('kpiContactRate').textContent = `${contactPercent}%`;
    if ($('kpiContactSub')) $('kpiContactSub').textContent = `${contactedCount} / ${total} ca kết nối`;

    if ($('kpiReboundRate')) $('kpiReboundRate').textContent = `${reboundPercent}%`;
    if ($('kpiReboundSub')) $('kpiReboundSub').textContent = `${reboundCount} ca hứa đi học lại (${reboundPercent}% ca đã CS)`;
}

/**
 * 2. Tab 1: Thống kê Tiến độ Giảng viên
 */
function renderTeachersTable() {
    const searchVal = $('inpSearchTeacher') ? $('inpSearchTeacher').value.trim().toLowerCase() : '';

    // Gom nhóm theo caregiver_id
    const teacherMap = new Map();

    rawRecords.forEach(r => {
        const tId = r.caregiver_id || 'Chưa phân công';
        if (!teacherMap.has(tId)) {
            const teacherInfo = teachersCache.get(tId) || {};
            teacherMap.set(tId, {
                id: tId,
                name: teacherInfo.full_name || tId,
                total: 0,
                completed: 0,
                pending: 0,
                contacted: 0,
                unreachable: 0,
                rebound: 0,
                reasons: {}
            });
        }

        const stats = teacherMap.get(tId);
        stats.total++;

        const isDone = !!(r.care_status || r.status === 'Completed');
        if (isDone) {
            stats.completed++;
        } else {
            stats.pending++;
        }

        if (r.contact_status === 'Đã liên lạc') {
            stats.contacted++;
        } else if (r.contact_status === 'Không nghe máy' || r.contact_status === 'Sai số điện thoại') {
            stats.unreachable++;
        }

        if (r.care_status === 'Đã đi học' || r.care_status === 'Sẽ đi học') {
            stats.rebound++;
        }

        if (r.care_status) {
            stats.reasons[r.care_status] = (stats.reasons[r.care_status] || 0) + 1;
        }
    });

    let teacherList = Array.from(teacherMap.values());

    // Lọc theo tìm kiếm
    if (searchVal) {
        teacherList = teacherList.filter(t => 
            t.id.toLowerCase().includes(searchVal) || 
            t.name.toLowerCase().includes(searchVal)
        );
    }

    // Sắp xếp: Giảng viên có ca giao nhiều nhất lên đầu
    teacherList.sort((a, b) => b.total - a.total);

    const tbody = $('tableBodyTeachers');
    if (!tbody) return;

    if (teacherList.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted" style="padding: 30px;">Không có dữ liệu phù hợp.</td></tr>`;
        return;
    }

    let rowsHtml = '';
    teacherList.forEach(t => {
        const rate = t.total > 0 ? Math.round((t.completed / t.total) * 100) : 0;
        
        // Phân loại màu thanh tiến độ
        let fillClass = 'fill-green';
        if (rate < 50) fillClass = 'fill-red';
        else if (rate < 90) fillClass = 'fill-amber';

        // Badge đánh giá
        let evalHtml = '';
        if (t.id === 'Chưa phân công') {
            evalHtml = `<span class="eval-badge eval-warning">⚠️ Cần phân công</span>`;
        } else if (rate === 100) {
            evalHtml = `<span class="eval-badge eval-excellent">✅ Hoàn thành 100%</span>`;
        } else if (rate >= 50) {
            evalHtml = `<span class="eval-badge eval-processing">⏳ Đang xử lý (${rate}%)</span>`;
        } else {
            evalHtml = `<span class="eval-badge eval-warning">🚨 Chậm tiến độ</span>`;
        }

        rowsHtml += `
            <tr>
                <td>
                    <strong style="color: var(--primary-color); display: block;">${t.id}</strong>
                    <span style="font-size: 0.8rem; color: var(--text-secondary);">${t.name}</span>
                </td>
                <td class="text-center"><strong>${t.total}</strong></td>
                <td class="text-center" style="color: #10b981; font-weight: 600;">${t.completed}</td>
                <td class="text-center" style="color: #f59e0b; font-weight: 600;">${t.pending}</td>
                <td>
                    <div class="progress-container">
                        <div class="progress-track">
                            <div class="progress-fill ${fillClass}" style="width: ${rate}%;"></div>
                        </div>
                        <span class="progress-text">${rate}%</span>
                    </div>
                </td>
                <td class="text-center">
                    <span title="Đã liên lạc: ${t.contacted} / Không nghe & Sai số: ${t.unreachable}">
                        📞 ${t.contacted} / 📵 ${t.unreachable}
                    </span>
                </td>
                <td class="text-center">
                    <span style="color: #10b981; font-weight: 600;" title="Số ca quay lại học">
                        🎯 ${t.rebound} SV
                    </span>
                </td>
                <td class="text-center">${evalHtml}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
}

/**
 * 3. Tab 2: Phân Tích Lớp Học & Môn Học Nguy Cơ
 */
function renderClassesAndSubjectsReport() {
    const classMap = new Map();
    const subjectMap = new Map();

    rawRecords.forEach(r => {
        // Lớp
        const clsName = r.class_name || r.class_id || 'Chưa rõ lớp';
        const course = r.course_code || 'Chưa rõ môn';
        const classKey = `${clsName}___${course}`;

        if (!classMap.has(classKey)) {
            classMap.set(classKey, {
                className: clsName,
                courseCode: course,
                totalStudents: 0,
                completedCare: 0,
                highAbsences: 0
            });
        }
        const clsStats = classMap.get(classKey);
        clsStats.totalStudents++;
        if (r.care_status || r.status === 'Completed') clsStats.completedCare++;
        if ((r.total_absences || 0) >= 3) clsStats.highAbsences++;

        // Môn học
        if (!subjectMap.has(course)) {
            const subjObj = findSubjectData(course);
            subjectMap.set(course, {
                courseCode: course,
                courseName: subjObj ? subjObj.course_name : '',
                isPrerequisite: subjObj ? !!subjObj.is_prerequisite : false,
                totalRecords: 0,
                totalAbsences: 0
            });
        }
        const subjStats = subjectMap.get(course);
        subjStats.totalRecords++;
        subjStats.totalAbsences += (r.total_absences || 0);
    });

    // Top Lớp
    const classList = Array.from(classMap.values()).sort((a, b) => b.totalStudents - a.totalStudents);
    if ($('badgeTotalClasses')) $('badgeTotalClasses').textContent = `${classList.length} Lớp`;

    let topClassesHtml = '';
    classList.slice(0, 10).forEach(c => {
        const rate = c.totalStudents > 0 ? Math.round((c.completedCare / c.totalStudents) * 100) : 0;
        topClassesHtml += `
            <tr>
                <td><strong>🏫 ${c.className}</strong></td>
                <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${c.courseCode}</span></td>
                <td class="text-center"><span class="badge badge-danger">${c.totalStudents} SV</span></td>
                <td class="text-center" style="color: #10b981; font-weight: 600;">${c.completedCare}</td>
                <td>
                    <div class="progress-container">
                        <div class="progress-track"><div class="progress-fill fill-green" style="width: ${rate}%;"></div></div>
                        <span class="progress-text">${rate}%</span>
                    </div>
                </td>
            </tr>
        `;
    });
    if ($('tableBodyTopClasses')) {
        $('tableBodyTopClasses').innerHTML = topClassesHtml || `<tr><td colspan="5" class="text-center text-muted">Không có dữ liệu lớp học.</td></tr>`;
    }

    // Top Môn Học
    const subjectList = Array.from(subjectMap.values()).sort((a, b) => b.totalRecords - a.totalRecords);
    if ($('badgeTotalSubjects')) $('badgeTotalSubjects').textContent = `${subjectList.length} Môn`;

    let topSubjectsHtml = '';
    const maxSubjectTotal = subjectList.length > 0 ? subjectList[0].totalRecords : 1;

    subjectList.slice(0, 10).forEach(s => {
        const avgAbs = s.totalRecords > 0 ? (s.totalAbsences / s.totalRecords).toFixed(1) : 0;
        const relativeRate = Math.round((s.totalRecords / maxSubjectTotal) * 100);
        const prereqBadge = s.isPrerequisite ? `<span class="badge badge-danger" style="font-size: 0.7rem;">⚡ Tiên quyết</span>` : `<span style="color: var(--text-muted);">-</span>`;

        topSubjectsHtml += `
            <tr>
                <td>
                    <strong style="color: var(--primary-color); display: block;">${s.courseCode}</strong>
                    <span style="font-size: 0.75rem; color: var(--text-secondary);">${s.courseName || ''}</span>
                </td>
                <td class="text-center"><strong>${s.totalRecords}</strong></td>
                <td class="text-center" style="color: #ef4444; font-weight: 600;">${avgAbs} b/SV</td>
                <td class="text-center">${prereqBadge}</td>
                <td>
                    <div class="progress-container">
                        <div class="progress-track"><div class="progress-fill fill-amber" style="width: ${relativeRate}%;"></div></div>
                    </div>
                </td>
            </tr>
        `;
    });
    if ($('tableBodyTopSubjects')) {
        $('tableBodyTopSubjects').innerHTML = topSubjectsHtml || `<tr><td colspan="5" class="text-center text-muted">Không có dữ liệu môn học.</td></tr>`;
    }
}

/**
 * 4. Tab 3: Phân Bổ Kết Quả & Phản Hồi
 */
function renderOutcomeDistributionReport() {
    const total = rawRecords.length;
    const contactListEl = $('contactDistributionList');
    const careListEl = $('careDistributionList');

    if (total === 0) {
        if (contactListEl) contactListEl.innerHTML = `<div class="text-muted text-center" style="padding: 20px;">Không có dữ liệu</div>`;
        if (careListEl) careListEl.innerHTML = `<div class="text-muted text-center" style="padding: 20px;">Không có dữ liệu</div>`;
        return;
    }

    // Đếm Tình trạng liên lạc
    const contactCounts = {
        'Đã liên lạc': 0,
        'Không nghe máy': 0,
        'Sai số điện thoại': 0,
        'Chưa liên lạc': 0
    };

    // Đếm Tình trạng chăm sóc
    const careCounts = {
        'Đã đi học': 0,
        'Sẽ đi học': 0,
        'Nghỉ học kỳ': 0,
        'Lý do khác': 0,
        'Chưa chăm sóc': 0
    };

    rawRecords.forEach(r => {
        const cStatus = r.contact_status || 'Chưa liên lạc';
        if (contactCounts.hasOwnProperty(cStatus)) contactCounts[cStatus]++;
        else contactCounts['Chưa liên lạc']++;

        const careStatus = r.care_status || 'Chưa chăm sóc';
        if (careCounts.hasOwnProperty(careStatus)) careCounts[careStatus]++;
        else careCounts['Chưa chăm sóc']++;
    });

    // Render Contact Distribution
    const contactColors = {
        'Đã liên lạc': '#10b981',
        'Không nghe máy': '#f59e0b',
        'Sai số điện thoại': '#ef4444',
        'Chưa liên lạc': '#94a3b8'
    };

    let contactHtml = '';
    Object.entries(contactCounts).forEach(([status, count]) => {
        const pct = Math.round((count / total) * 100);
        const color = contactColors[status] || '#6f42c1';
        contactHtml += `
            <div class="dist-item">
                <div class="dist-header">
                    <span>${status}</span>
                    <span><strong>${count} ca</strong> (${pct}%)</span>
                </div>
                <div class="dist-bar-track">
                    <div class="dist-bar-fill" style="width: ${pct}%; background-color: ${color};"></div>
                </div>
            </div>
        `;
    });
    if (contactListEl) contactListEl.innerHTML = contactHtml;

    // Render Care Outcome Distribution
    const careColors = {
        'Đã đi học': '#10b981',
        'Sẽ đi học': '#06b6d4',
        'Nghỉ học kỳ': '#ef4444',
        'Lý do khác': '#8b5cf6',
        'Chưa chăm sóc': '#94a3b8'
    };

    let careHtml = '';
    Object.entries(careCounts).forEach(([status, count]) => {
        const pct = Math.round((count / total) * 100);
        const color = careColors[status] || '#6f42c1';
        careHtml += `
            <div class="dist-item">
                <div class="dist-header">
                    <span>${status}</span>
                    <span><strong>${count} ca</strong> (${pct}%)</span>
                </div>
                <div class="dist-bar-track">
                    <div class="dist-bar-fill" style="width: ${pct}%; background-color: ${color};"></div>
                </div>
            </div>
        `;
    });
    if (careListEl) careListEl.innerHTML = careHtml;

    // 3. Render Phân Tích Cơ Cấu Nguyên Nhân Gốc Rễ (Root Causes)
    const rootListEl = $('rootCausesDistributionList');
    if (rootListEl) {
        const rootCounts = {};
        const rootStudentsMap = {};
        ROOT_CAUSES.forEach(rc => { 
            rootCounts[rc.id] = 0; 
            rootStudentsMap[rc.id] = [];
        });
        let totalTagged = 0;

        rawRecords.forEach(r => {
            if (Array.isArray(r.root_causes) && r.root_causes.length > 0) {
                r.root_causes.forEach(rcId => {
                    let targetId = rcId;
                    if (!rootCounts.hasOwnProperty(targetId)) {
                        const matched = ROOT_CAUSES.find(rc => rc.label === rcId || rc.shortLabel === rcId);
                        if (matched) targetId = matched.id;
                        else targetId = 'OTHER';
                    }
                    if (rootCounts[targetId] !== undefined) {
                        rootCounts[targetId]++;
                        totalTagged++;
                        // Tránh thêm trùng cùng 1 record vào 1 nhóm
                        if (!rootStudentsMap[targetId].some(existing => (existing.id || existing.docId) === (r.id || r.docId))) {
                            rootStudentsMap[targetId].push(r);
                        }
                    }
                });
            }
        });

        if (totalTagged === 0) {
            rootListEl.innerHTML = `<div class="text-muted text-center" style="padding: 20px; font-size: 0.85rem;">Chưa có ca chăm sóc nào được gắn nhãn nguyên nhân gốc rễ trong kỳ này.</div>`;
        } else {
            let rootHtml = '';
            ROOT_CAUSES.forEach(rc => {
                const count = rootCounts[rc.id] || 0;
                const pct = totalTagged > 0 ? Math.round((count / totalTagged) * 100) : 0;
                const studentsList = rootStudentsMap[rc.id] || [];

                let studentPillsHtml = '';
                if (studentsList.length > 0) {
                    studentPillsHtml = `
                        <div class="student-tag-list-wrap">
                            <span style="font-size: 0.74rem; font-weight: 600; color: var(--text-secondary); align-self: center; margin-right: 4px;">Danh sách SV:</span>
                            ${studentsList.map(st => `
                                <button type="button" class="btn-student-tag-link" onclick="window.handleFilterByStudentAndCause('${st.student_id}', '${rc.id}')" title="Bấm để lọc chi tiết sinh viên ${st.student_id} ở Tab Danh Sách">
                                    <strong>${st.student_id}</strong> - ${st.name || ''} <span style="color: var(--text-muted);">(${st.course_code || ''})</span>
                                </button>
                            `).join('')}
                        </div>
                    `;
                }

                rootHtml += `
                    <div class="dist-item" style="margin-bottom: 14px;">
                        <div class="dist-header" style="cursor: pointer;" onclick="window.handleFilterByCauseOnly('${rc.id}')" title="Bấm để lọc tất cả sinh viên thuộc nguyên nhân này ở Tab Chi Tiết">
                            <span style="font-weight: 600;">${rc.label}</span>
                            <span><strong>${count} ca</strong> (${pct}%) 👉 <small style="color: var(--primary-color);">Xem tất cả</small></span>
                        </div>
                        <div class="dist-bar-track" style="cursor: pointer;" onclick="window.handleFilterByCauseOnly('${rc.id}')">
                            <div class="dist-bar-fill" style="width: ${pct}%; background-color: ${rc.color};"></div>
                        </div>
                        ${studentPillsHtml}
                    </div>
                `;
            });
            rootListEl.innerHTML = rootHtml;
        }
    }
}



/**
 * 5. Tab 4: Danh Sách Sinh Viên Chi Tiết & Bộ Lọc Cascading
 */

/**
 * Đổ dữ liệu vào các Combobox bộ lọc: GV Giảng Dạy, GV Chăm Sóc & Lớp Học
 */
function populateDetailDropdowns() {
    const filterTeaching = $('filterDetailTeachingTeacher');
    const filterCaregiver = $('filterDetailTeacher');

    // 1. Lấy danh sách GV Giảng Dạy (teacher_id / teacher_ids)
    if (filterTeaching) {
        const currentVal = filterTeaching.value || 'all';
        const teachingSet = new Set();
        rawRecords.forEach(r => {
            if (r.teacher_id) teachingSet.add(r.teacher_id.trim());
            if (Array.isArray(r.teacher_ids)) {
                r.teacher_ids.forEach(t => { if (t) teachingSet.add(t.trim()); });
            }
        });

        let teachingHtml = '<option value="all">👨‍🏫 Tất cả GV Giảng dạy</option>';
        Array.from(teachingSet).sort().forEach(tId => {
            const tInfo = teachersCache.get(tId) || teachersCache.get(tId.toLowerCase()) || {};
            const tName = tInfo.full_name || tInfo.name || '';
            const label = tName ? `${tId} - ${tName}` : tId;
            teachingHtml += `<option value="${tId}" ${tId === currentVal ? 'selected' : ''}>${label}</option>`;
        });
        filterTeaching.innerHTML = teachingHtml;
    }

    // 2. Lấy danh sách GV Chăm Sóc (caregiver_id)
    if (filterCaregiver) {
        const currentVal = filterCaregiver.value || 'all';
        const caregiverSet = new Set();
        rawRecords.forEach(r => {
            if (r.caregiver_id) caregiverSet.add(r.caregiver_id.trim());
        });

        let caregiverHtml = '<option value="all">🎯 Tất cả GV Chăm sóc</option>';
        caregiverHtml += `<option value="unassigned" ${currentVal === 'unassigned' ? 'selected' : ''}>⚠️ Chưa phân công</option>`;
        Array.from(caregiverSet).sort().forEach(tId => {
            const tInfo = teachersCache.get(tId) || teachersCache.get(tId.toLowerCase()) || {};
            const tName = tInfo.full_name || tInfo.name || '';
            const label = tName ? `${tId} - ${tName}` : tId;
            caregiverHtml += `<option value="${tId}" ${tId === currentVal ? 'selected' : ''}>${label}</option>`;
        });
        filterCaregiver.innerHTML = caregiverHtml;
    }

    // 3. Cập nhật Cascading Dropdown Lớp - Môn Học
    updateCascadingClassFilter();
}

/**
 * Cập nhật danh sách Lớp - Môn học phụ thuộc theo Block, Trạng Thái, GV Giảng Dạy & GV Chăm Sóc
 */
function updateCascadingClassFilter() {
    const classFilterEl = $('filterDetailClass');
    if (!classFilterEl) return;

    const blockVal = $('filterDetailBlock') ? $('filterDetailBlock').value : 'all';
    const classStatusVal = $('filterDetailClassStatus') ? $('filterDetailClassStatus').value : 'all';
    const teachingTeacherVal = $('filterDetailTeachingTeacher') ? $('filterDetailTeachingTeacher').value : 'all';
    const caregiverVal = $('filterDetailTeacher') ? $('filterDetailTeacher').value : 'all';
    const currentClassVal = classFilterEl.value || 'all';

    // Lọc tập hợp các lớp phù hợp với ngữ cảnh hiện tại
    const contextRecords = rawRecords.filter(r => {
        const rBlock = r.block || 'Block 1';
        if (blockVal !== 'all' && rBlock !== blockVal) return false;

        const rStatus = r.class_status || 'Ongoing';
        if (classStatusVal !== 'all' && rStatus !== classStatusVal) return false;

        if (teachingTeacherVal !== 'all') {
            const tTeaching = (r.teacher_id || '').toLowerCase().trim();
            const tTeachingList = Array.isArray(r.teacher_ids) 
                ? r.teacher_ids.map(t => (t || '').toLowerCase().trim()) 
                : [];
            const target = teachingTeacherVal.toLowerCase().trim();
            if (tTeaching !== target && !tTeachingList.includes(target)) return false;
        }

        if (caregiverVal !== 'all') {
            if (caregiverVal === 'unassigned') {
                if (r.caregiver_id) return false;
            } else {
                if ((r.caregiver_id || '').toLowerCase().trim() !== caregiverVal.toLowerCase().trim()) return false;
            }
        }

        return true;
    });

    // Thống kê số sinh viên theo từng lớp môn
    const classMap = new Map();
    contextRecords.forEach(r => {
        const clsName = r.class_name || r.class_id || 'Chưa rõ lớp';
        const course = r.course_code || 'Chưa rõ môn';
        const key = `${clsName}___${course}`;
        classMap.set(key, (classMap.get(key) || 0) + 1);
    });

    const sortedClasses = Array.from(classMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    let optsHtml = `<option value="all">🏫 Tất cả Lớp - Môn học (${sortedClasses.length} lớp)</option>`;
    let isStillValid = (currentClassVal === 'all');

    sortedClasses.forEach(([key, count]) => {
        const [cls, course] = key.split('___');
        const isSelected = (key === currentClassVal);
        if (isSelected) isStillValid = true;
        optsHtml += `<option value="${key}" ${isSelected ? 'selected' : ''}>🏫 ${cls} (${course}) - ${count} SV</option>`;
    });

    classFilterEl.innerHTML = optsHtml;
    if (!isStillValid) classFilterEl.value = 'all';
}

/**
 * Xử lý khi thay đổi nhóm bộ lọc phân cấp (Block, Trạng Thái Lớp, GV Giảng Dạy, GV Chăm Sóc)
 */
function onDetailFilterGroupChange() {
    updateCascadingClassFilter();
    renderStudentsDetailTable();
}

/**
 * Lấy danh sách bản ghi đã lọc theo các tiêu chí ở Tab 4
 */
function getFilteredDetailRecords() {
    const searchVal = $('inpSearchDetail') ? $('inpSearchDetail').value.trim().toLowerCase() : '';
    const blockVal = $('filterDetailBlock') ? $('filterDetailBlock').value : 'all';
    const classStatusVal = $('filterDetailClassStatus') ? $('filterDetailClassStatus').value : 'all';
    const absenceVal = $('filterDetailAbsence') ? $('filterDetailAbsence').value : 'all';
    const classVal = $('filterDetailClass') ? $('filterDetailClass').value : 'all';
    const teachingTeacherVal = $('filterDetailTeachingTeacher') ? $('filterDetailTeachingTeacher').value : 'all';
    const caregiverVal = $('filterDetailTeacher') ? $('filterDetailTeacher').value : 'all';
    const contactVal = $('filterDetailContact') ? $('filterDetailContact').value : 'all';
    const careVal = $('filterDetailCareStatus') ? $('filterDetailCareStatus').value : 'all';

    return rawRecords.filter(r => {
        // 1. Tìm kiếm text
        const tTeaching = (r.teacher_id || '').toLowerCase();
        const tCaregiver = (r.caregiver_id || '').toLowerCase();
        const matchSearch = !searchVal ||
            (r.student_id && r.student_id.toLowerCase().includes(searchVal)) ||
            (r.name && r.name.toLowerCase().includes(searchVal)) ||
            (r.class_name && r.class_name.toLowerCase().includes(searchVal)) ||
            (r.course_code && r.course_code.toLowerCase().includes(searchVal)) ||
            (r.phone && r.phone.toLowerCase().includes(searchVal)) ||
            tTeaching.includes(searchVal) ||
            tCaregiver.includes(searchVal);

        // 2. Block
        const rBlock = r.block || 'Block 1';
        const matchBlock = (blockVal === 'all') || (rBlock === blockVal);

        // 3. Trạng thái lớp
        const rStatus = r.class_status || 'Ongoing';
        const matchClassStatus = (classStatusVal === 'all') || (rStatus === classStatusVal);

        // 4. Mức độ vắng
        const absences = r.total_absences || 0;
        let matchAbsence = true;
        if (absenceVal === 'all_risk') {
            matchAbsence = absences >= 2;
        } else if (absenceVal === '1') {
            matchAbsence = absences === 1;
        } else if (absenceVal === '2') {
            matchAbsence = absences === 2;
        } else if (absenceVal === '3') {
            matchAbsence = absences === 3;
        } else if (absenceVal === 'gte4') {
            matchAbsence = absences >= 4;
        }

        // 5. Lớp - Môn học
        const key = `${r.class_name || r.class_id || 'Chưa rõ lớp'}___${r.course_code || 'Chưa rõ môn'}`;
        const matchClass = (classVal === 'all') || (key === classVal);

        // 6. GV Giảng Dạy
        let matchTeaching = true;
        if (teachingTeacherVal !== 'all') {
            const target = teachingTeacherVal.toLowerCase().trim();
            const teachingList = Array.isArray(r.teacher_ids) 
                ? r.teacher_ids.map(t => (t || '').toLowerCase().trim()) 
                : [];
            matchTeaching = (tTeaching === target) || teachingList.includes(target);
        }

        // 7. GV Chăm Sóc
        let matchCaregiver = true;
        if (caregiverVal !== 'all') {
            if (caregiverVal === 'unassigned') {
                matchCaregiver = !r.caregiver_id;
            } else {
                matchCaregiver = (tCaregiver === caregiverVal.toLowerCase().trim());
            }
        }

        // 8. Tình trạng liên lạc
        let matchContact = true;
        if (contactVal !== 'all') {
            const curContact = r.contact_status || 'Chưa liên lạc';
            matchContact = (curContact === contactVal);
        }

        // 9. Kết quả chăm sóc
        let matchCare = true;
        if (careVal === 'none') {
            matchCare = !r.care_status;
        } else if (careVal !== 'all') {
            matchCare = (r.care_status === careVal);
        }

        // 10. Tình trạng nợ môn
        const filterDebts = $('filterDetailDebts');
        const debtVal = filterDebts ? filterDebts.value : 'all';
        let matchDebt = true;
        if (debtVal !== 'all') {
            const dCount = r.debt_count || 0;
            if (debtVal === 'critical_debt') matchDebt = dCount >= 3;
            else if (debtVal === 'has_debt') matchDebt = dCount >= 1;
            else if (debtVal === 'no_debt') matchDebt = dCount === 0;
            else if (debtVal === 'recent_debt') matchDebt = !!r.has_recent_debt;
            else if (debtVal === 'prereq_debt') matchDebt = !!r.has_prerequisite_debt;
        }

        // 11. Nguyên nhân gốc rễ
        const filterRootCause = $('filterDetailRootCause');
        const rootCauseVal = filterRootCause ? filterRootCause.value : 'all';
        let matchRootCause = true;
        if (rootCauseVal !== 'all') {
            const causes = Array.isArray(r.root_causes) ? r.root_causes : [];
            matchRootCause = causes.includes(rootCauseVal) || causes.some(c => {
                const matched = ROOT_CAUSES.find(rc => rc.id === rootCauseVal);
                return matched && (c === matched.label || c === matched.shortLabel);
            });
        }

        return matchSearch && matchBlock && matchClassStatus && matchAbsence && matchClass && matchTeaching && matchCaregiver && matchContact && matchCare && matchDebt && matchRootCause;
    });
}

/**
 * Render bảng danh sách sinh viên chi tiết (12 cột kèm checkbox và nút gửi email)
 */
function renderStudentsDetailTable() {
    const filtered = getFilteredDetailRecords();
    const tbody = $('tableBodyStudentsDetail');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted" style="padding: 30px;">Không có sinh viên nào phù hợp bộ lọc.</td></tr>`;
        return;
    }

    let rowsHtml = '';
    filtered.forEach(r => {
        const docId = r.id || r.docId;
        const contactBadge = getContactBadgeHtml(r.contact_status);
        const careBadge = getCareBadgeHtml(r.care_status);
        const blockName = r.block || 'Block 1';
        const blockClass = blockName === 'Block 2' ? 'badge-block-2' : (blockName === 'Full' ? 'badge-block-full' : 'badge-block-1');
        const statusIcon = r.class_status === 'Completed' ? '🏁' : (r.class_status === 'Upcoming' ? '🕒' : '🟢');

        // Thông tin GV Giảng Dạy
        const teachingId = r.teacher_id || (Array.isArray(r.teacher_ids) && r.teacher_ids[0]) || '-';
        const teachingInfo = teachersCache.get(teachingId) || teachersCache.get(teachingId.toLowerCase()) || {};
        const teachingName = teachingInfo.full_name || teachingInfo.name || '';

        // Thông tin GV Chăm Sóc
        const caregiverId = r.caregiver_id || '';
        const caregiverInfo = caregiverId ? (teachersCache.get(caregiverId) || teachersCache.get(caregiverId.toLowerCase()) || {}) : {};
        const caregiverName = caregiverInfo.full_name || caregiverInfo.name || '';

        // Tên môn học
        const subData = subjectsCache.get(r.course_code) || SubjectService.findSubjectData(r.course_code) || {};
        const subName = subData.course_name || subData.name || '';

        // Tạo Huy Hiệu Nợ Môn Trực Quan
        let debtBadgeHtml = '';
        const dCount = r.debt_count || 0;
        if (dCount >= 3) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-danger" title="Đang nợ ${dCount} môn: ${(r.debts_list || []).join(', ')}">🚨 Nợ ${dCount} môn</div>`;
        } else if (dCount > 0) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-warning" title="Đang nợ ${dCount} môn: ${(r.debts_list || []).join(', ')}">⚠️ Nợ ${dCount} môn</div>`;
        } else {
            debtBadgeHtml += `<div class="badge-debt badge-debt-safe" title="Không nợ môn tích lũy">🟢 0 nợ</div>`;
        }

        if (r.has_recent_debt) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-recent" title="Có môn vừa nợ kỳ trước: ${(r.recent_debts_list || []).join(', ')}">⚡ Nợ kỳ trước</div>`;
        }
        if (r.has_prerequisite_debt) {
            debtBadgeHtml += `<div class="badge-debt badge-debt-prereq" title="Nợ môn tiên quyết của môn này: ${(r.prereq_debt_courses || []).join(', ')}">🔗 Nợ tiên quyết</div>`;
        }

        // Tạo Huy Hiệu Nguyên Nhân Gốc Rễ
        const rootBadgesHtml = (Array.isArray(r.root_causes) && r.root_causes.length > 0)
            ? `<div style="display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px;">
                ${r.root_causes.map(rcId => {
                    const rcObj = ROOT_CAUSES.find(rc => rc.id === rcId || rc.label === rcId);
                    const label = rcObj ? rcObj.shortLabel || rcObj.label : rcId;
                    const color = rcObj ? rcObj.color : '#6f42c1';
                    const bg = rcObj ? rcObj.bg : '#f3e8ff';
                    return `<span class="root-cause-badge" style="color: ${color}; background-color: ${bg}; border: 1px solid ${color}33;">🏷️ ${label}</span>`;
                }).join('')}
               </div>`
            : '';

        rowsHtml += `
            <tr>
                <td class="text-center" onclick="event.stopPropagation();">
                    <input type="checkbox" class="chk-report-row" data-id="${docId}" ${selectedReportRowIds.has(docId) ? 'checked' : ''}>
                </td>
                <td>
                    <div><strong>${r.student_id || '-'}</strong></div>
                    <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 3px;">
                        ${debtBadgeHtml}
                    </div>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 600;">${r.name || '-'}</span>
                        ${r.phone ? `<small style="color: var(--text-secondary); font-size: 0.75rem;">📱 ${r.phone}</small>` : ''}
                    </div>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span>${statusIcon} <strong>${r.class_name || r.class_id || '-'}</strong></span>
                        <span class="badge-block ${blockClass}" style="align-self: flex-start; font-size: 0.7rem;">${blockName}</span>
                    </div>
                </td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <strong>${r.course_code || '-'}</strong>
                        ${subName ? `<span style="font-size: 0.76rem; color: var(--text-secondary);">${subName}</span>` : ''}
                    </div>
                </td>
                <td class="text-center" style="color: #ef4444; font-weight: 700; font-size: 0.95rem;">${r.total_absences || 0}</td>
                <td>
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 600;">👨‍🏫 ${teachingId}</span>
                        ${teachingName ? `<small style="color: var(--text-secondary); font-size: 0.74rem;">${teachingName}</small>` : ''}
                    </div>
                </td>
                <td>
                    ${caregiverId ? `
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-weight: 600; color: var(--primary-color);">🎯 ${caregiverId}</span>
                            ${caregiverName ? `<small style="color: var(--text-secondary); font-size: 0.74rem;">${caregiverName}</small>` : ''}
                        </div>
                    ` : `<span class="badge-status badge-unassigned" style="font-size: 0.75rem;">Chưa giao</span>`}
                </td>
                <td class="text-center">${contactBadge}</td>
                <td class="text-center">${careBadge}</td>
                <td>
                    ${rootBadgesHtml || '<span style="color: var(--text-muted); font-size: 0.75rem;">-</span>'}
                </td>
                <td>
                    <span style="font-size: 0.78rem; color: var(--text-muted);">${r.notes || '-'}</span>
                </td>
                <td class="text-center" onclick="event.stopPropagation();">
                    <button type="button" class="btn-send-email-mini" onclick="window.handleOpenSingleEmailModalFromReport('${r.student_id}', '${docId}');" title="Gửi email nhắc nhở chuyên cần (tự động gộp đa môn)">
                        ✉️ Gửi Email
                    </button>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;

    // Gắn sự kiện Checkbox từng dòng
    const rowCheckboxes = tbody.querySelectorAll('.chk-report-row');
    rowCheckboxes.forEach(cb => {
        cb.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            if (e.target.checked) selectedReportRowIds.add(id);
            else selectedReportRowIds.delete(id);
            updateBulkReportButtonState();
        });
    });
}

/**
 * Window Hook: Lọc theo Sinh viên từ Tab 3 sang Tab 4
 */
window.handleFilterByStudentAndCause = function(studentId, causeId) {
    const tabBtn = document.querySelector('.report-tabs-nav .tab-btn[data-tab="tab-student-details"]');
    if (tabBtn) tabBtn.click();

    const inpSearch = $('inpSearchDetail');
    if (inpSearch) inpSearch.value = studentId;

    const filterRoot = $('filterDetailRootCause');
    if (filterRoot) filterRoot.value = 'all';

    const filterAbsence = $('filterDetailAbsence');
    if (filterAbsence) filterAbsence.value = 'all';

    const filterClassStatus = $('filterDetailClassStatus');
    if (filterClassStatus) filterClassStatus.value = 'all';

    renderStudentsDetailTable();
};

/**
 * Window Hook: Lọc tất cả sinh viên thuộc một Nguyên nhân từ Tab 3 sang Tab 4
 */
window.handleFilterByCauseOnly = function(causeId) {
    const tabBtn = document.querySelector('.report-tabs-nav .tab-btn[data-tab="tab-student-details"]');
    if (tabBtn) tabBtn.click();

    const inpSearch = $('inpSearchDetail');
    if (inpSearch) inpSearch.value = '';

    const filterRoot = $('filterDetailRootCause');
    if (filterRoot && causeId) filterRoot.value = causeId;

    const filterAbsence = $('filterDetailAbsence');
    if (filterAbsence) filterAbsence.value = 'all';

    const filterClassStatus = $('filterDetailClassStatus');
    if (filterClassStatus) filterClassStatus.value = 'all';

    renderStudentsDetailTable();
};

/**
 * Window Hook: Mở Modal Gửi Email Đơn Lẻ từ Báo Cáo
 */
window.handleOpenSingleEmailModalFromReport = function(studentId, docId) {
    const studentPayload = EmailRollupService.aggregateStudentData(studentId, rawRecords, subjectsCache, teachersCache);
    if (!studentPayload) {
        showToast("Không tìm thấy thông tin sinh viên để gửi email!", "warning");
        return;
    }

    EmailModalComponent.openSingleModal(studentPayload, currentSession, async (res) => {
        await fetchSemesterData(selectedSemester, true);
    });
};


// ==========================================================================
// 6. EXCEL EXPORT WORKBOOK GENERATOR (SHEETJS)
// ==========================================================================

/**
 * Xuất Báo Cáo Tổng Hợp Ra Excel (2 Sheets)
 */
function handleExportExcelReport() {
    if (!rawRecords || rawRecords.length === 0) {
        showToast("Không có dữ liệu để xuất Excel!", "warning");
        return;
    }

    if (typeof XLSX === 'undefined') {
        showToast("Thư viện SheetJS chưa sẵn sàng!", "error");
        return;
    }

    showToast("Đang tạo tệp Excel báo cáo...", "info");

    try {
        const wb = XLSX.utils.book_new();

        // ----------------------------------------------------
        // SHEET 1: TIẾN ĐỘ GIẢNG VIÊN
        // ----------------------------------------------------
        const teacherMap = new Map();
        rawRecords.forEach(r => {
            const tId = r.caregiver_id || 'Chưa phân công';
            if (!teacherMap.has(tId)) {
                const info = teachersCache.get(tId) || {};
                teacherMap.set(tId, {
                    ma_gv: tId,
                    ten_gv: info.full_name || tId,
                    so_ca_giao: 0,
                    da_xu_ly: 0,
                    chua_xu_ly: 0,
                    da_di_hoc: 0,
                    se_di_hoc: 0,
                    nghi_ky: 0,
                    khong_nghe_may_sai_so: 0
                });
            }
            const s = teacherMap.get(tId);
            s.so_ca_giao++;
            if (r.care_status || r.status === 'Completed') s.da_xu_ly++;
            else s.chua_xu_ly++;

            if (r.care_status === 'Đã đi học') s.da_di_hoc++;
            else if (r.care_status === 'Sẽ đi học') s.se_di_hoc++;
            else if (r.care_status === 'Nghỉ học kỳ') s.nghi_ky++;

            if (r.contact_status === 'Không nghe máy' || r.contact_status === 'Sai số điện thoại') {
                s.khong_nghe_may_sai_so++;
            }
        });

        const sheet1Data = [
            ["Mã Giảng Viên", "Họ Và Tên", "Số Ca Được Giao", "Đã Xử Lý", "Chưa Xử Lý", "Tỷ Lệ Hoàn Thành (%)", "Đã Đi Học", "Sẽ Đi Học", "Nghỉ Học Kỳ", "Không Nghe / Sai SĐT"]
        ];

        Array.from(teacherMap.values()).forEach(t => {
            const rate = t.so_ca_giao > 0 ? Math.round((t.da_xu_ly / t.so_ca_giao) * 100) : 0;
            sheet1Data.push([
                t.ma_gv,
                t.ten_gv,
                t.so_ca_giao,
                t.da_xu_ly,
                t.chua_xu_ly,
                rate + "%",
                t.da_di_hoc,
                t.se_di_hoc,
                t.nghi_ky,
                t.khong_nghe_may_sai_so
            ]);
        });

        const ws1 = XLSX.utils.aoa_to_sheet(sheet1Data);
        XLSX.utils.book_append_sheet(wb, ws1, "Tien_Do_Giang_Vien");

        // ----------------------------------------------------
        // SHEET 2: CHI TIẾT SINH VIÊN
        // ----------------------------------------------------
        const sheet2Data = [
            ["Mã Sinh Viên", "Họ Tên", "Số Điện Thoại", "Lớp", "Môn Học", "Số Buổi Vắng", "GV Đứng Lớp", "GV Chăm Sóc", "Tình Trạng Liên Lạc", "Kết Quả Chăm Sóc", "Nguyên Nhân Gốc Rễ", "Lần CS Cuối", "Ghi Chú"]
        ];

        rawRecords.forEach(r => {
            const rootCauseText = (Array.isArray(r.root_causes) && r.root_causes.length > 0)
                ? r.root_causes.map(rcId => {
                    const rcObj = ROOT_CAUSES.find(rc => rc.id === rcId || rc.label === rcId);
                    return rcObj ? rcObj.label : rcId;
                }).join('; ')
                : '';

            sheet2Data.push([
                r.student_id || "",
                r.name || "",
                r.phone || "",
                r.class_name || r.class_id || "",
                r.course_code || "",
                r.total_absences || 0,
                r.teacher_id || "",
                r.caregiver_id || "",
                r.contact_status || "Chưa liên lạc",
                r.care_status || "",
                rootCauseText,
                r.last_care_date ? new Date(r.last_care_date).toLocaleString('vi-VN') : "",
                r.notes || ""
            ]);
        });

        const ws2 = XLSX.utils.aoa_to_sheet(sheet2Data);
        XLSX.utils.book_append_sheet(wb, ws2, "Chi_Tiet_Sinh_Vien");

        // Xuất file
        const fileName = `Bao_Cao_Cham_Soc_Sinh_Vien_${selectedSemester.replace(/\s+/g, '_')}.xlsx`;
        XLSX.writeFile(wb, fileName);
        showToast(`Xuất file thành công: ${fileName}`, "success");

    } catch (e) {
        console.error("Lỗi khi xuất file Excel:", e);
        showToast("Lỗi khi tạo file Excel: " + e.message, "error");
    }
}


// ==========================================================================
// 7. HELPER FUNCTIONS
// ==========================================================================

function findSubjectData(courseCode) {
    return SubjectService.findSubjectData(courseCode) || null;
}

// ==========================================================================
// 8. XỬ LÝ TAB SYNC LOGS (HOẠT ĐỘNG LẤY DỮ LIỆU)
// ==========================================================================
function initSyncLogsTab() {
    // Đặt ngày mặc định: Từ 7 ngày trước đến hôm nay
    const today = new Date();
    const lastWeek = new Date(today);
    lastWeek.setDate(today.getDate() - 7);

    const fmtDate = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    $('filterLogStartDate').value = fmtDate(lastWeek);
    $('filterLogEndDate').value = fmtDate(today);

    // Load dữ liệu
    loadSyncLogs(fmtDate(lastWeek), fmtDate(today));
    $('tableBodySyncLogs').dataset.loaded = 'true';
}

async function loadSyncLogs(startDate, endDate) {
    const tableBody = $('tableBodySyncLogs');
    tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 30px;">Đang tải dữ liệu...</td></tr>`;

    try {
        const logsRef = collection(db, 'SyncLogs');
        const q = query(
            logsRef,
            where('date', '>=', startDate),
            where('date', '<=', endDate)
        );

        const querySnapshot = await getDocs(q);
        const logs = [];
        querySnapshot.forEach(doc => {
            logs.push({ id: doc.id, ...doc.data() });
        });

        if (logs.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding: 30px;">Không có hoạt động lấy dữ liệu nào trong khoảng thời gian này.</td></tr>`;
            return;
        }

        // Sắp xếp giảm dần theo thời gian (mới nhất lên trên)
        logs.sort((a, b) => {
            const timeA = a.last_sync_time ? new Date(a.last_sync_time).getTime() : 0;
            const timeB = b.last_sync_time ? new Date(b.last_sync_time).getTime() : 0;
            return timeB - timeA;
        });

        let html = '';
        logs.forEach(log => {
            const teacherData = teachersCache.get(log.teacher_id);
            const teacherName = teacherData ? teacherData.name : 'Không xác định';
            
            // Format ngày
            const dateStr = log.date || ''; // YYYY-MM-DD
            
            // Format thời gian
            let timeStr = log.last_sync_time || '';
            if (timeStr) {
                const d = new Date(timeStr);
                timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
            }

            // Badge action
            let actionBadge = `<span class="badge badge-secondary">${log.latest_action || 'Không rõ'}</span>`;
            if (log.latest_action === 'upsert-attendance') {
                actionBadge = `<span class="badge badge-info">Điểm danh</span>`;
            } else if (log.latest_action === 'upsert-transcript') {
                actionBadge = `<span class="badge badge-warning">Bảng điểm nợ môn</span>`;
            }

            html += `
                <tr>
                    <td class="font-weight-500">${dateStr}</td>
                    <td><code>${log.teacher_id}</code></td>
                    <td class="font-weight-500">${teacherName}</td>
                    <td>${actionBadge}</td>
                    <td class="text-muted" style="font-size: 0.85rem;">${timeStr}</td>
                </tr>
            `;
        });

        tableBody.innerHTML = html;
        showToast(`Đã tải ${logs.length} bản ghi log.`, "success");

    } catch (error) {
        console.error("Lỗi khi tải SyncLogs:", error);
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger" style="padding: 30px;">Lỗi tải dữ liệu: ${error.message}</td></tr>`;
        showToast("Lỗi khi tải dữ liệu SyncLogs", "error");
    }
}
