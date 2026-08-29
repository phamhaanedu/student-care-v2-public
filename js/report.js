// report.js - Phân Hệ Báo Cáo & Đánh Giá Chăm Sóc V2 (Admin Analytics & Reports)

import { db, doc, getDoc, getDocs, collection, query, where } from './firebase-init.js';
import { checkAuth } from './auth.js';

// ==========================================================================
// 1. STATE & GLOBAL VARIABLES
// ==========================================================================
let currentSession = null;
let globalConfig = { available_semesters: [], current_semester: '' };
let currentSemester = '';
let selectedSemester = '';
let rawRecords = []; // Toàn bộ AcademicRecords của kỳ hiện tại
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
        currentSession = await checkAuth(['Admin', 'Super Admin']);
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
        });
    });

    // 5. Tìm kiếm Giảng viên ở Tab 1
    const inpTeacher = $('inpSearchTeacher');
    if (inpTeacher) {
        inpTeacher.addEventListener('input', () => {
            renderTeachersTable();
        });
    }

    // 6. Lọc danh sách chi tiết ở Tab 4
    const inpDetail = $('inpSearchDetail');
    const filterBlock = $('filterDetailBlock');
    const filterClassStatus = $('filterDetailClassStatus');
    const filterAbsence = $('filterDetailAbsence');
    const filterTeacher = $('filterDetailTeacher');
    const filterCare = $('filterDetailCareStatus');

    if (inpDetail) inpDetail.addEventListener('input', renderStudentsDetailTable);
    if (filterBlock) filterBlock.addEventListener('change', renderStudentsDetailTable);
    if (filterClassStatus) filterClassStatus.addEventListener('change', renderStudentsDetailTable);
    if (filterAbsence) filterAbsence.addEventListener('change', renderStudentsDetailTable);
    if (filterTeacher) filterTeacher.addEventListener('change', renderStudentsDetailTable);
    if (filterCare) filterCare.addEventListener('change', renderStudentsDetailTable);
}

// ==========================================================================
// 4. DATA LOADING & IN-MEMORY CACHING
// ==========================================================================

/**
 * Tải cấu hình kỳ học từ Configuration/Global
 */
async function loadConfigAndSemesters() {
    try {
        const configDoc = await getDoc(doc(db, "Configuration", "Global"));
        if (configDoc.exists()) {
            globalConfig = configDoc.data();
            const available = globalConfig.available_semesters || [];
            currentSemester = globalConfig.current_semester || (available[0] || '');
            selectedSemester = currentSemester;

            const sortedSemesters = sortSemestersList(available);
            const semSelect = $('selectSemester');
            if (semSelect) {
                semSelect.innerHTML = sortedSemesters.map(sem => {
                    const isCurrent = (sem === currentSemester);
                    const label = isCurrent ? `📅 ${sem} (Hiện tại)` : `📅 ${sem}`;
                    return `<option value="${sem}" ${sem === selectedSemester ? 'selected' : ''}>${label}</option>`;
                }).join('');
            }
        }
    } catch (e) {
        console.error("Lỗi khi đọc Configuration/Global:", e);
    }
}

/**
 * Tải danh mục Môn học & Giảng viên để hiển thị tên đầy đủ
 */
async function loadTeachersAndSubjectsCache() {
    try {
        const [teachersSnap, subjectsSnap] = await Promise.all([
            getDocs(collection(db, "Teachers")),
            getDocs(collection(db, "Subjects"))
        ]);

        teachersSnap.forEach(d => teachersCache.set(d.id, d.data()));
        subjectsSnap.forEach(d => {
            const data = d.data();
            const id = d.id;
            subjectsCache.set(id, data);
            const rawCode = id.split(' ')[0].split('(')[0].trim();
            if (rawCode && rawCode !== id) subjectsCache.set(rawCode, data);
        });

        console.log(`Đã nạp cache ${teachersCache.size} GV và ${subjectsCache.size} môn học.`);
    } catch (e) {
        console.warn("Lưu ý khi nạp cache danh mục:", e);
    }
}

/**
 * Tải dữ liệu của 1 kỳ duy nhất (Point-in-time single query)
 */
async function fetchSemesterData(semester, forceRefresh = false) {
    if (!semester) return;

    // Kiểm tra cache nếu không ép buộc tải lại
    if (!forceRefresh && semesterDataCache.has(semester)) {
        rawRecords = semesterDataCache.get(semester);
        calculateAndRenderAllReports();
        return;
    }

    // Hiển thị trạng thái tải
    setLoadingState(true);

    try {
        const q = query(
            collection(db, "AcademicRecords"),
            where("semester", "==", semester)
        );

        const querySnapshot = await getDocs(q);
        const records = [];
        querySnapshot.forEach(d => {
            const data = d.data();
            data.id = d.id;
            records.push(data);
        });

        rawRecords = records;
        semesterDataCache.set(semester, records);

        // Tính toán và hiển thị toàn bộ báo cáo
        calculateAndRenderAllReports();
        showToast(`Đã tải ${records.length} ca sinh viên kỳ ${semester}.`, "success");

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
    populateDetailTeacherFilter();
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
}

/**
 * 5. Tab 4: Danh Sách Sinh Viên Chi Tiết
 */
function populateDetailTeacherFilter() {
    const filterEl = $('filterDetailTeacher');
    if (!filterEl) return;
    const currentVal = filterEl.value || 'all';
    const teacherSet = new Set();
    rawRecords.forEach(r => {
        if (r.caregiver_id) teacherSet.add(r.caregiver_id);
    });

    let optsHtml = '<option value="all">Tất cả Giảng viên</option>';
    Array.from(teacherSet).sort().forEach(tId => {
        optsHtml += `<option value="${tId}" ${tId === currentVal ? 'selected' : ''}>GV: ${tId}</option>`;
    });
    filterEl.innerHTML = optsHtml;
}

function renderStudentsDetailTable() {
    const searchVal = $('inpSearchDetail') ? $('inpSearchDetail').value.trim().toLowerCase() : '';
    const blockVal = $('filterDetailBlock') ? $('filterDetailBlock').value : 'all';
    const classStatusVal = $('filterDetailClassStatus') ? $('filterDetailClassStatus').value : 'all';
    const absenceVal = $('filterDetailAbsence') ? $('filterDetailAbsence').value : 'all';
    const teacherVal = $('filterDetailTeacher') ? $('filterDetailTeacher').value : 'all';
    const careVal = $('filterDetailCareStatus') ? $('filterDetailCareStatus').value : 'all';

    let filtered = rawRecords.filter(r => {
        const matchSearch = !searchVal ||
            (r.student_id && r.student_id.toLowerCase().includes(searchVal)) ||
            (r.name && r.name.toLowerCase().includes(searchVal)) ||
            (r.class_name && r.class_name.toLowerCase().includes(searchVal)) ||
            (r.course_code && r.course_code.toLowerCase().includes(searchVal));

        const rBlock = r.block || 'Block 1';
        const matchBlock = (blockVal === 'all') || (rBlock === blockVal);

        const rStatus = r.class_status || 'Ongoing';
        const matchClassStatus = (classStatusVal === 'all') || (rStatus === classStatusVal);

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

        const matchTeacher = (teacherVal === 'all') || (r.caregiver_id === teacherVal);

        let matchCare = true;
        if (careVal === 'none') matchCare = !r.care_status;
        else if (careVal !== 'all') matchCare = (r.care_status === careVal);

        return matchSearch && matchBlock && matchClassStatus && matchAbsence && matchTeacher && matchCare;
    });

    const tbody = $('tableBodyStudentsDetail');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding: 30px;">Không có sinh viên nào phù hợp bộ lọc.</td></tr>`;
        return;
    }

    let rowsHtml = '';
    filtered.forEach(r => {
        const contactBadge = getContactBadgeHtml(r.contact_status);
        const careBadge = getCareBadgeHtml(r.care_status);
        const blockName = r.block || 'Block 1';
        const blockClass = blockName === 'Block 2' ? 'badge-block-2' : (blockName === 'Full' ? 'badge-block-full' : 'badge-block-1');
        const statusIcon = r.class_status === 'Completed' ? '🏁' : (r.class_status === 'Upcoming' ? '🕒' : '🟢');

        rowsHtml += `
            <tr>
                <td><strong>${r.student_id || '-'}</strong></td>
                <td>${r.name || '-'}</td>
                <td>
                    <div style="display: flex; flex-direction: column; gap: 2px;">
                        <span>${statusIcon} <strong>${r.class_name || r.class_id || '-'}</strong></span>
                        <span class="badge-block ${blockClass}" style="align-self: flex-start; font-size: 0.7rem;">${blockName}</span>
                    </div>
                </td>
                <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${r.course_code || '-'}</span></td>
                <td class="text-center" style="color: #ef4444; font-weight: 700;">${r.total_absences || 0}</td>
                <td><strong>${r.caregiver_id || '-'}</strong></td>
                <td class="text-center">${contactBadge}</td>
                <td class="text-center">${careBadge}</td>
                <td><span style="font-size: 0.78rem; color: var(--text-muted);">${r.notes || '-'}</span></td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
}

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
            ["Mã Sinh Viên", "Họ Tên", "Số Điện Thoại", "Lớp", "Môn Học", "Số Buổi Vắng", "GV Đứng Lớp", "GV Chăm Sóc", "Tình Trạng Liên Lạc", "Kết Quả Chăm Sóc", "Lần CS Cuối", "Ghi Chú"]
        ];

        rawRecords.forEach(r => {
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

function sortSemestersList(semesters) {
    const seasonWeight = { 'Fall': 3, 'Summer': 2, 'Spring': 1 };
    return [...semesters].sort((a, b) => {
        const partsA = a.split(' ');
        const partsB = b.split(' ');
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

function findSubjectData(courseCode) {
    if (!courseCode) return null;
    if (subjectsCache.has(courseCode)) return subjectsCache.get(courseCode);
    const cleanCode = courseCode.split(' ')[0].split('(')[0].trim();
    if (subjectsCache.has(cleanCode)) return subjectsCache.get(cleanCode);
    return null;
}

function getContactBadgeHtml(status) {
    if (!status || status === 'Chưa liên lạc') return `<span class="badge badge-light">Chưa liên lạc</span>`;
    if (status === 'Đã liên lạc') return `<span class="badge badge-success">Đã liên lạc</span>`;
    if (status === 'Không nghe máy') return `<span class="badge badge-warning">Không nghe máy</span>`;
    if (status === 'Sai số điện thoại') return `<span class="badge badge-danger">Sai số ĐT</span>`;
    return `<span class="badge badge-light">${status}</span>`;
}

function getCareBadgeHtml(status) {
    if (!status) return `<span style="color: var(--text-muted);">-</span>`;
    if (status === 'Đã đi học') return `<span class="badge badge-success">Đã đi học</span>`;
    if (status === 'Sẽ đi học') return `<span class="badge badge-info">Sẽ đi học</span>`;
    if (status === 'Nghỉ học kỳ') return `<span class="badge badge-danger">Nghỉ kỳ</span>`;
    return `<span class="badge badge-secondary">${status}</span>`;
}

function showToast(message, type = "info") {
    const toastContainer = $('toastContainer');
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
