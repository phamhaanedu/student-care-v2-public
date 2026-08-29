// tasks.js - Không Gian Làm Việc Giảng Viên & Expandable Data Table (Accordion Inline 360 Workspace Đồng Thời)

import { db, doc, getDoc, getDocs, collection, query, where, writeBatch, updateDoc, Timestamp } from './firebase-init.js';
import { checkAuth } from './auth.js';

// State
let currentSession = null;
let globalConfig = { available_semesters: [], current_semester: '' };
let currentSemester = '';
let selectedSemester = ''; // Học kỳ đang được chọn để xem
let allTasks = []; // Toàn bộ ca (được phân công + lớp đứng lớp)
let filteredTasks = []; // Dữ liệu hiển thị sau khi lọc/search
const expandedRowIds = new Set(); // Tập hợp các docId đang mở rộng accordion
const studentProfileCache = new Map(); // Cache thông tin sinh viên Students/{studentId}
const careLogsCache = new Map(); // Cache lịch sử chăm sóc CareLogs của từng sinh viên
const subjectsCache = new Map(); // Cache danh mục Subjects để tra cứu môn tiên quyết

// DOM Elements
const kpiTotal = document.getElementById('kpiTotal');
const kpiPending = document.getElementById('kpiPending');
const kpiCompleted = document.getElementById('kpiCompleted');
const kpiRate = document.getElementById('kpiRate');

const inpSearch = document.getElementById('inpSearch');
const selectSemesterFilter = document.getElementById('selectSemesterFilter');
const selectScopeFilter = document.getElementById('selectScopeFilter');
const selectClassFilter = document.getElementById('selectClassFilter');
const selectTeacherFilter = document.getElementById('selectTeacherFilter');
const selectContactStatusFilter = document.getElementById('selectContactStatusFilter');
const selectCareStatusFilter = document.getElementById('selectCareStatusFilter');
const tasksTableBody = document.getElementById('tasksTableBody');
const thTeacher = document.getElementById('thTeacher');
const toastContainer = document.getElementById('toastContainer');

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Kiểm tra xác thực
        currentSession = await checkAuth();
        if (!currentSession) return;

        // 2. Lấy cấu hình kỳ học hiện tại & Danh mục Môn học
        await Promise.all([
            loadCurrentSemester(),
            loadSubjectsCache()
        ]);

        // 3. Tải danh sách nhiệm vụ chăm sóc
        await loadTasks();

        // 4. Đăng ký sự kiện tìm kiếm & lọc
        inpSearch.addEventListener('input', applyFilters);
        if (selectScopeFilter) selectScopeFilter.addEventListener('change', applyFilters);
        if (selectClassFilter) selectClassFilter.addEventListener('change', applyFilters);
        selectContactStatusFilter.addEventListener('change', applyFilters);
        selectCareStatusFilter.addEventListener('change', applyFilters);
        if (selectTeacherFilter) selectTeacherFilter.addEventListener('change', applyFilters);

        // Sự kiện đổi học kỳ xem dữ liệu
        if (selectSemesterFilter) {
            selectSemesterFilter.addEventListener('change', async (e) => {
                selectedSemester = e.target.value;
                showToast(`Đang tải dữ liệu học kỳ: ${selectedSemester}...`, "info");

                // Reset search và các bộ lọc về mặc định
                if (inpSearch) inpSearch.value = '';
                if (selectScopeFilter) selectScopeFilter.value = 'all';
                if (selectContactStatusFilter) selectContactStatusFilter.value = 'all';
                if (selectCareStatusFilter) selectCareStatusFilter.value = 'all';
                if (selectTeacherFilter) selectTeacherFilter.value = 'all';

                // Tải lại dữ liệu của đúng kỳ đã chọn
                await loadTasks();
            });
        }

    } catch (error) {
        console.error("Lỗi khởi tạo module Tasks:", error);
        showToast("Có lỗi khi khởi tạo hệ thống: " + error.message, "error");
    }
});

/**
 * Sắp xếp danh sách kỳ học theo thời gian mới nhất (Năm giảm dần -> Fall -> Summer -> Spring)
 */
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

/**
 * Tải kỳ học hiện tại từ Configuration/Global & Đổ vào combobox chọn kỳ
 */
async function loadCurrentSemester() {
    try {
        const configDoc = await getDoc(doc(db, "Configuration", "Global"));
        if (configDoc.exists()) {
            globalConfig = configDoc.data();
            const available = globalConfig.available_semesters || [];
            currentSemester = globalConfig.current_semester || (available[0] || '');
            if (!selectedSemester) {
                selectedSemester = currentSemester;
            }

            // Sắp xếp danh sách kỳ học theo thời gian mới nhất
            const sortedSemesters = sortSemestersList(available);

            // Đổ vào combobox selectSemesterFilter
            if (selectSemesterFilter) {
                selectSemesterFilter.innerHTML = sortedSemesters.map(sem => {
                    const isCurrent = (sem === currentSemester);
                    const label = isCurrent ? `📅 ${sem} (Hiện tại)` : `📅 ${sem}`;
                    return `<option value="${sem}" ${sem === selectedSemester ? 'selected' : ''}>${label}</option>`;
                }).join('');
            }
        }
        if (!currentSemester) {
            console.warn("Chưa cấu hình current_semester trong Configuration/Global.");
        }
    } catch (e) {
        console.error("Lỗi khi đọc Configuration/Global:", e);
    }
}

/**
 * Tải danh mục Subjects 1 lần duy nhất vào Cache để tra cứu Môn Tiên Quyết
 */
async function loadSubjectsCache() {
    try {
        const subjectsSnap = await getDocs(collection(db, "Subjects"));
        subjectsSnap.forEach(d => {
            const data = d.data();
            const id = d.id;
            subjectsCache.set(id, data);

            // Map thêm theo mã môn rút gọn (ví dụ: "GAM109" từ "GAM109 (GAM109)")
            const rawCode = id.split(' ')[0].split('(')[0].trim();
            if (rawCode && rawCode !== id) {
                subjectsCache.set(rawCode, data);
            }
        });
        console.log(`Đã tải cache ${subjectsCache.size} môn học.`);
    } catch (e) {
        console.warn("Lưu ý khi tải cache Subjects:", e);
    }
}

/**
 * Tra cứu thông tin môn học trong cache Subjects
 */
function findSubjectData(courseCode) {
    if (!courseCode) return null;
    if (subjectsCache.has(courseCode)) return subjectsCache.get(courseCode);

    const cleanCode = courseCode.split(' ')[0].split('(')[0].trim();
    if (subjectsCache.has(cleanCode)) return subjectsCache.get(cleanCode);

    for (let [key, val] of subjectsCache.entries()) {
        if (key.startsWith(cleanCode) || (val.course_name && val.course_name.toLowerCase().includes(cleanCode.toLowerCase()))) {
            return val;
        }
    }
    return null;
}

/**
 * Tính toán Học kỳ Liền Kề Trước Đó
 */
function getPreviousSemester(semesterStr) {
    if (!semesterStr) return '';
    const parts = semesterStr.trim().split(' ');
    if (parts.length < 2) return '';

    const season = parts[0].toLowerCase();
    const year = parseInt(parts[1], 10);
    if (isNaN(year)) return '';

    if (season === 'summer') return `Spring ${year}`;
    if (season === 'fall') return `Summer ${year}`;
    if (season === 'spring') return `Fall ${year - 1}`;
    return '';
}

/**
 * Tải danh sách ca phân công & Lớp đứng lớp theo quyền (RBAC) cho Học kỳ đã chọn
 */
async function loadTasks() {
    tasksTableBody.innerHTML = `
        <tr>
            <td colspan="11" class="text-center" style="padding: 40px;">
                <div class="loader" style="display: inline-block; width: 32px; height: 32px; border-top-color: var(--primary-color);"></div>
                <div style="margin-top: 10px; color: var(--text-secondary); font-size: 0.85rem;">Đang tải danh sách sinh viên (${selectedSemester || currentSemester})...</div>
            </td>
        </tr>
    `;

    try {
        const teacherId = currentSession.email.split('@')[0];
        const isTeacher = currentSession.role === 'Teacher';
        const tasksMap = new Map();
        const teacherSet = new Set();
        const activeSemester = selectedSemester || currentSemester;

        if (isTeacher) {
            // 1. Teacher: Lấy song song 2 nguồn (Ca được phân công + Ca lớp đứng lớp) của đúng activeSemester
            const qAssigned = query(
                collection(db, "AcademicRecords"),
                where("semester", "==", activeSemester),
                where("caregiver_id", "==", teacherId)
            );

            const qTeaching = query(
                collection(db, "AcademicRecords"),
                where("semester", "==", activeSemester),
                where("teacher_id", "==", teacherId)
            );

            const [snapAssigned, snapTeaching] = await Promise.all([
                getDocs(qAssigned),
                getDocs(qTeaching)
            ]);

            snapAssigned.forEach(docSnap => {
                const data = docSnap.data();
                data.id = docSnap.id;
                data.is_assigned = true;
                tasksMap.set(docSnap.id, data);
            });

            snapTeaching.forEach(docSnap => {
                const data = docSnap.data();
                data.id = docSnap.id;
                if (tasksMap.has(docSnap.id)) {
                    tasksMap.get(docSnap.id).is_teaching = true;
                } else {
                    data.is_teaching = true;
                    tasksMap.set(docSnap.id, data);
                }
            });

        } else {
            // 2. Admin / Super Admin: Query toàn bộ ca trong activeSemester
            const q = query(
                collection(db, "AcademicRecords"),
                where("semester", "==", activeSemester)
            );

            const querySnapshot = await getDocs(q);
            querySnapshot.forEach(docSnap => {
                const data = docSnap.data();
                data.id = docSnap.id;
                data.is_assigned = !!(data.caregiver_id && data.caregiver_id === teacherId);
                data.is_teaching = !!(data.teacher_id && data.teacher_id === teacherId);
                tasksMap.set(docSnap.id, data);
                if (data.caregiver_id) teacherSet.add(data.caregiver_id);
            });

            // Hiển thị cột GV Chăm Sóc & bộ lọc GV
            if (thTeacher) thTeacher.style.display = '';
            if (selectTeacherFilter) selectTeacherFilter.style.display = '';
        }

        allTasks = Array.from(tasksMap.values());

        // Đổ danh sách GV vào bộ lọc (Admin)
        if (!isTeacher && selectTeacherFilter) {
            selectTeacherFilter.innerHTML = '<option value="all">Tất cả Giảng viên</option>';
            Array.from(teacherSet).sort().forEach(tId => {
                const opt = document.createElement('option');
                opt.value = tId;
                opt.textContent = `GV: ${tId}`;
                selectTeacherFilter.appendChild(opt);
            });
        }

        // Sắp xếp mặc định: THEO MÃ SỐ SINH VIÊN (A -> Z)
        allTasks.sort((a, b) => (a.student_id || '').localeCompare(b.student_id || ''));

        // Đổ danh sách Lớp - Môn học vào Dropdown bộ lọc
        populateClassFilter(allTasks);

        // Áp dụng bộ lọc & render
        applyFilters();

    } catch (error) {
        console.error("Lỗi khi tải danh sách AcademicRecords:", error);
        tasksTableBody.innerHTML = `
            <tr>
                <td colspan="11" class="text-center text-danger" style="padding: 30px;">
                    ❌ Không thể tải dữ liệu: ${error.message}
                </td>
            </tr>
        `;
    }
}

/**
 * Tự động trích xuất và đổ danh sách Lớp - Môn học vào dropdown bộ lọc
 */
function populateClassFilter(tasks) {
    if (!selectClassFilter) return;

    const currentVal = selectClassFilter.value || 'all';
    const classMap = new Map();

    tasks.forEach(item => {
        const cls = item.class_name || item.class_id || 'Chưa rõ lớp';
        const rawCode = item.course_code || 'Chưa rõ môn';
        const key = `${cls}___${rawCode}`;

        if (!classMap.has(key)) {
            const subjObj = findSubjectData(rawCode);
            const courseName = subjObj && subjObj.course_name ? subjObj.course_name : '';
            classMap.set(key, {
                class_name: cls,
                course_code: rawCode,
                course_name: courseName,
                count: 1
            });
        } else {
            classMap.get(key).count++;
        }
    });

    let optionsHtml = `<option value="all">Tất cả Lớp - Môn học (${tasks.length} SV)</option>`;

    // Sắp xếp theo tên lớp A-Z
    const sortedClasses = Array.from(classMap.entries()).sort((a, b) => {
        return a[1].class_name.localeCompare(b[1].class_name);
    });

    sortedClasses.forEach(([key, info]) => {
        const courseDisplay = info.course_name ? `${info.course_code} - ${info.course_name}` : info.course_code;
        const selected = (key === currentVal) ? 'selected' : '';
        optionsHtml += `<option value="${key}" ${selected}>🏫 ${info.class_name} | ${courseDisplay} (${info.count} SV)</option>`;
    });

    selectClassFilter.innerHTML = optionsHtml;
}

/**
 * Bộ lọc & Tìm kiếm Tức thì (Instant Search/Filter)
 */
function applyFilters() {
    const searchVal = inpSearch.value.trim().toLowerCase();
    const scopeVal = selectScopeFilter ? selectScopeFilter.value : 'all';
    const classVal = selectClassFilter ? selectClassFilter.value : 'all';
    const contactVal = selectContactStatusFilter.value;
    const careVal = selectCareStatusFilter.value;
    const teacherVal = selectTeacherFilter ? selectTeacherFilter.value : 'all';

    filteredTasks = allTasks.filter(item => {
        // 1. Tìm kiếm MSSV hoặc Họ tên hoặc Lớp
        const matchSearch = !searchVal || 
            (item.student_id && item.student_id.toLowerCase().includes(searchVal)) ||
            (item.name && item.name.toLowerCase().includes(searchVal)) ||
            (item.class_name && item.class_name.toLowerCase().includes(searchVal)) ||
            (item.course_code && item.course_code.toLowerCase().includes(searchVal));

        // 2. Lọc theo Phạm vi (Chăm sóc / Đứng lớp)
        let matchScope = true;
        if (scopeVal === 'assigned') {
            matchScope = item.is_assigned === true;
        } else if (scopeVal === 'teaching') {
            matchScope = item.is_teaching === true;
        }

        // 3. Lọc theo Lớp - Môn học
        let matchClass = true;
        if (classVal !== 'all') {
            const [filterClass, filterCourse] = classVal.split('___');
            const itemClass = item.class_name || item.class_id || 'Chưa rõ lớp';
            const itemCourse = item.course_code || 'Chưa rõ môn';
            matchClass = (itemClass === filterClass && itemCourse === filterCourse);
        }

        // 4. Lọc Tình trạng liên lạc
        const currentContact = item.contact_status || 'Chưa liên lạc';
        const matchContact = (contactVal === 'all') || (currentContact === contactVal);

        // 5. Lọc Tình trạng chăm sóc
        let matchCare = true;
        if (careVal === 'none') {
            matchCare = !item.care_status;
        } else if (careVal !== 'all') {
            matchCare = (item.care_status === careVal);
        }

        // 6. Lọc Giảng viên chăm sóc (Admin)
        const matchTeacher = (teacherVal === 'all') || (item.caregiver_id === teacherVal);

        return matchSearch && matchScope && matchClass && matchContact && matchCare && matchTeacher;
    });

    // Cập nhật Thẻ KPI
    updateKPICards(filteredTasks);

    // Render Bảng dữ liệu Expandable Data Table
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

    kpiTotal.textContent = total;
    kpiPending.textContent = pendingCount;
    kpiCompleted.textContent = completedCount;
    kpiRate.textContent = `${rate}%`;
}

/**
 * Render Bảng Expandable Data Table (Accordion)
 */
function renderTasksTable(tasks) {
    const isTeacher = currentSession.role === 'Teacher';

    if (tasks.length === 0) {
        tasksTableBody.innerHTML = `
            <tr>
                <td colspan="${isTeacher ? 10 : 11}" class="text-center" style="padding: 40px; color: var(--text-secondary);">
                    🔍 Không tìm thấy ca sinh viên nào phù hợp với bộ lọc.
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    tasks.forEach(item => {
        const isExpanded = expandedRowIds.has(item.id);
        const contactStatus = item.contact_status || 'Chưa liên lạc';
        const careStatus = item.care_status || '-';
        const lastCareDate = formatDateTime(item.last_care_date || item.updated_at);
        const absence = item.total_absences || 0;

        // Class màu cho số buổi vắng
        let absenceClass = 'text-success';
        if (absence >= 4) absenceClass = 'text-danger';
        else if (absence >= 2) absenceClass = 'text-warning';

        // Badge Tình trạng liên lạc
        let contactBadgeClass = 'badge-contact-chua-ll';
        if (contactStatus === 'Đã liên lạc') contactBadgeClass = 'badge-contact-da-ll';
        else if (contactStatus === 'Không nghe máy') contactBadgeClass = 'badge-contact-khong-nghe';
        else if (contactStatus === 'Sai số điện thoại') contactBadgeClass = 'badge-contact-sai-so';

        // Badge Tình trạng chăm sóc
        let careBadgeClass = 'badge-care-none';
        if (careStatus === 'Đã đi học') careBadgeClass = 'badge-care-da-di-hoc';
        else if (careStatus === 'Sẽ đi học') careBadgeClass = 'badge-care-se-di-hoc';
        else if (careStatus === 'Nghỉ học kỳ') careBadgeClass = 'badge-care-nghi-ky';
        else if (careStatus === 'Lý do khác') careBadgeClass = 'badge-care-ly-do-khac';

        // Badge Vai trò (Phân công / Đứng lớp)
        let roleBadgeHtml = '';
        if (item.is_assigned && item.is_teaching) {
            roleBadgeHtml = `<div class="badge-role badge-role-both">🎯 Phân công & 🏫 Đứng lớp</div>`;
        } else if (item.is_assigned) {
            roleBadgeHtml = `<div class="badge-role badge-role-assigned">🎯 Phân công</div>`;
        } else if (item.is_teaching) {
            roleBadgeHtml = `<div class="badge-role badge-role-teaching">🏫 Đứng lớp</div>`;
        }

        html += `
            <!-- Dòng Chính (Master Row) -->
            <tr class="expandable-row ${isExpanded ? 'row-expanded' : ''}" id="row-${item.id}" data-docid="${item.id}" data-studentid="${item.student_id}">
                <td class="col-expand text-center" data-label="">
                    <button type="button" class="btn-toggle-expand" title="Mở rộng chăm sóc">
                        <span class="chevron-icon">▶</span>
                    </button>
                </td>
                <td class="col-student-id" data-label="Mã SV">
                    <div>${item.student_id || '-'}</div>
                    ${roleBadgeHtml}
                </td>
                <td class="col-name" data-label="Họ Tên">${item.name || '-'}</td>
                <td class="col-course" data-label="Môn Học">${item.course_code || '-'}</td>
                <td class="col-class" data-label="Lớp">${item.class_name || item.class_id || '-'}</td>
                <td class="col-absence text-center ${absenceClass}" data-label="Vắng">${absence}</td>
                ${!isTeacher ? `<td class="col-caregiver" data-label="GV Chăm Sóc">${item.caregiver_id || '-'}</td>` : ''}
                <td class="col-contact-status" data-label="Liên Lạc">
                    <span class="badge-status ${contactBadgeClass}">${contactStatus}</span>
                </td>
                <td class="col-care-status" data-label="Kết Quả CS">
                    <span class="badge-status ${careBadgeClass}">${careStatus}</span>
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

            <!-- Dòng Con Mở Rộng Accordion (Inline Workspace Detail Row) -->
            <tr class="inline-detail-row" id="detail-row-${item.id}" style="display: ${isExpanded ? 'table-row' : 'none'};">
                <td colspan="${isTeacher ? 10 : 11}">
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

    // Đăng ký sự kiện click mở rộng cho từng dòng
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

        // Nếu dòng đang ở trạng thái expanded từ trước, render nội dung inline ngay
        if (expandedRowIds.has(item.id)) {
            renderInlineWorkspace(item.id, item.student_id);
        }
    });
}

/**
 * Đóng/Mở Hàng Accordion (Inline Row Toggle)
 */
async function toggleInlineRow(docId, studentId) {
    const mainRow = document.getElementById(`row-${docId}`);
    const detailRow = document.getElementById(`detail-row-${docId}`);
    const btnAction = mainRow ? mainRow.querySelector('.btn-care-action') : null;

    if (!mainRow || !detailRow) return;

    if (expandedRowIds.has(docId)) {
        // Đang mở -> Thu gọn
        expandedRowIds.delete(docId);
        mainRow.classList.remove('row-expanded');
        detailRow.style.display = 'none';
        if (btnAction) btnAction.innerHTML = '🎯 Chăm sóc';
    } else {
        // Đang đóng -> Mở rộng
        expandedRowIds.add(docId);
        mainRow.classList.add('row-expanded');
        detailRow.style.display = 'table-row';
        if (btnAction) btnAction.innerHTML = '▲ Thu gọn';

        // Tải và render không gian 360° Inline
        await renderInlineWorkspace(docId, studentId);
    }
}

/**
 * Tải JIT & Render Không Gian Làm Việc 360° Đồng Thời
 */
async function renderInlineWorkspace(docId, studentId) {
    const wsContainer = document.getElementById(`workspace-${docId}`);
    if (!wsContainer) return;

    const record = allTasks.find(t => t.id === docId) || {};

    try {
        // 1. Tải JIT thông tin Students/{studentId} (Kiểm tra Cache trước)
        let studentData = studentProfileCache.get(studentId);
        if (!studentData) {
            const studentDoc = await getDoc(doc(db, "Students", studentId));
            studentData = studentDoc.exists() ? studentDoc.data() : {};
            studentProfileCache.set(studentId, studentData);
        }

        // 2. Tải JIT lịch sử CareLogs (Kiểm tra Cache trước)
        let careLogs = careLogsCache.get(studentId);
        if (!careLogs) {
            const qLogs = query(
                collection(db, "CareLogs"),
                where("student_id", "==", studentId)
            );
            const logsSnap = await getDocs(qLogs);
            careLogs = [];
            logsSnap.forEach(d => careLogs.push(d.data()));
            careLogs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
            careLogsCache.set(studentId, careLogs);
        }

        // 3. Chuẩn bị Dữ liệu
        const sdt = record.phone || studentData.phone || 'Chưa có SĐT';
        const email = record.email || studentData.email || 'Chưa có email';
        const name = record.name || studentData.name || 'Sinh viên';
        const absences = record.total_absences || 0;
        const debts = studentData.current_debts || [];
        const contactStatus = record.contact_status || 'Chưa liên lạc';
        const careStatus = record.care_status || '';
        const notes = record.notes || '';
        const remarks = studentData.instructor_remarks || [];

        // Tra cứu Tên Môn Học & Ngưỡng Vắng Cho Phép
        const rawCourseCode = record.course_code || '';
        const subjectObj = findSubjectData(rawCourseCode);
        const courseName = subjectObj && subjectObj.course_name ? subjectObj.course_name : '';
        const courseDisplay = courseName ? `${rawCourseCode} - ${courseName}` : rawCourseCode;
        const maxAllowed = (subjectObj && subjectObj.max_absences !== undefined) ? subjectObj.max_absences : 3;

        // Đánh giá Health Bars theo dữ liệu chuẩn Subjects
        const healthAtt = calculateAttendanceHealth(absences, maxAllowed);
        const healthAcad = calculateAcademicHealth(debts.length);
        const healthResp = calculateResponseHealth(careLogs, contactStatus);

        // Đánh giá Kịch Bản Trợ Lý AI
        const suggestion = generateSmartSuggestion(absences, debts.length, careLogs, contactStatus);

        // 4. Render HTML Bố cục Không Gian Làm Việc Đồng Thời (3 Cột)
        wsContainer.innerHTML = `
            <!-- Top Header: Profile Info -->
            <div class="inline-header-profile">
                <div class="student-meta-main">
                    <div class="student-avatar">${name.charAt(0).toUpperCase()}</div>
                    <div class="student-title-block">
                        <h3>
                            <span>${name}</span>
                            <span class="student-id-tag">${studentId}</span>
                        </h3>
                        <div class="student-contact-row">
                            <span class="phone-highlight-block">📞 <a href="tel:${sdt}" class="phone-link-large" onclick="event.stopPropagation();">${sdt}</a> 
                                ${sdt !== 'Chưa có SĐT' ? `<button type="button" class="btn-copy-phone-large" onclick="navigator.clipboard.writeText('${sdt}'); showToast('Đã sao chép SĐT ${sdt}', 'success'); event.stopPropagation();">Sao chép</button>` : ''}
                            </span>
                            <span>✉️ ${email}</span>
                            <span>🏫 Lớp: <strong>${record.class_name || record.class_id || '-'}</strong> (Môn: <strong>${courseDisplay || '-'}</strong>)</span>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Health Bars Visualization -->
            <div class="health-bars-box">
                <div class="health-item">
                    <div class="health-header">
                        <span>Chuyên Cần (Vắng ${absences}/${maxAllowed})</span>
                        <span class="health-status-text ${healthAtt.class}">${healthAtt.label}</span>
                    </div>
                    <div class="health-bar-track">
                        <div class="health-bar-progress ${healthAtt.class}" style="width: ${healthAtt.percent}%;"></div>
                    </div>
                </div>

                <div class="health-item">
                    <div class="health-header">
                        <span>Học Lực (Nợ môn)</span>
                        <span class="health-status-text ${healthAcad.class}">${healthAcad.label}</span>
                    </div>
                    <div class="health-bar-track">
                        <div class="health-bar-progress ${healthAcad.class}" style="width: ${healthAcad.percent}%;"></div>
                    </div>
                </div>

                <div class="health-item">
                    <div class="health-header">
                        <span>Mức Độ Phản Hồi</span>
                        <span class="health-status-text ${healthResp.class}">${healthResp.label}</span>
                    </div>
                    <div class="health-bar-track">
                        <div class="health-bar-progress ${healthResp.class}" style="width: ${healthResp.percent}%;"></div>
                    </div>
                </div>
            </div>

            <!-- Smart AI Suggestion Box -->
            <div class="smart-suggestion-box">
                <div class="suggestion-icon">💡</div>
                <div class="suggestion-content">
                    <h4>${suggestion.title}</h4>
                    <p>${suggestion.text}</p>
                </div>
            </div>

            <!-- 3-Column Simultaneous Workspace Grid -->
            <div class="inline-dashboard-grid">
                <!-- CỘT 1: 📚 Điểm Danh & 📊 Hồ Sơ Nợ Môn (2 Tầng: Nợ môn & Chưa học) -->
                <div class="inline-panel-card">
                    <div class="panel-header">
                        <h4>📚 Điểm Danh & Chuyên Cần</h4>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem; margin-bottom: 12px;">
                        <tbody>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary);">Môn học:</td>
                                <td style="padding: 5px 0; font-weight: 600;">${courseDisplay || '-'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary);">Lớp:</td>
                                <td style="padding: 5px 0; font-weight: 600;">${record.class_name || record.class_id || '-'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary);">GV Đứng Lớp:</td>
                                <td style="padding: 5px 0; font-weight: 600;">${record.teacher_id || '-'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary);">Vắng / Cho phép:</td>
                                <td style="padding: 5px 0; font-weight: 700; color: #dc3545;">${absences} / ${maxAllowed} buổi</td>
                            </tr>
                            <tr>
                                <td style="padding: 5px 0; color: var(--text-secondary);">Đánh giá:</td>
                                <td style="padding: 5px 0;">${absences >= maxAllowed ? `🚨 Nguy cơ cấm thi rất cao (${absences}/${maxAllowed})` : (absences >= Math.ceil(maxAllowed / 2) ? `⚠️ Cần nhắc nhở đi học (${absences}/${maxAllowed})` : `✅ Chuyên cần an toàn (${absences}/${maxAllowed})`)}</td>
                            </tr>
                        </tbody>
                    </table>

                    <div class="panel-header" style="margin-top: 8px; border-top: 1px dashed var(--border-color); padding-top: 10px;">
                        <h4>📊 Hồ Sơ Nợ Môn (${debts.length})</h4>
                    </div>
                    ${renderDebts2TierHtml(studentData, selectedSemester || currentSemester)}
                </div>

                <!-- CỘT 2: 📝 Nhận Xét GV Đứng Lớp (Phía Trên) & 🕒 Lịch Sử Chăm Sóc (Phía Dưới) -->
                <div class="inline-panel-card">
                    <!-- PHẦN TRÊN: Sổ Nhận Xét Của GV Đứng Lớp (Tích Lũy Dùng Chung) -->
                    <div class="instructor-remarks-section" onclick="event.stopPropagation();">
                        <div class="remarks-header">
                            <span>📝 Nhận Xét Của GV Đứng Lớp (<span id="remarkCount-${docId}">${remarks.length}</span>)</span>
                            <span style="font-size: 0.72rem; color: #7e22ce; font-weight: 500;">(Dùng chung mọi môn)</span>
                        </div>
                        <div class="remarks-list" id="remarksList-${docId}">
                            ${renderRemarksListHtml(remarks)}
                        </div>
                        <div class="remark-input-group">
                            <input type="text" id="inpRemark-${docId}" class="input-new-remark" placeholder="Thêm nhận xét về SV này (GV đứng lớp)...">
                            <button type="button" id="btnSendRemark-${docId}" class="btn-submit-remark">💬 Gửi</button>
                        </div>
                    </div>

                    <!-- PHẦN DƯỚI: Lịch Sử Chăm Sóc Timeline -->
                    <div class="panel-header" style="margin-top: 4px;">
                        <h4>🕒 Lịch Sử Chăm Sóc (${careLogs.length})</h4>
                    </div>
                    <div class="care-timeline" id="timeline-${docId}" style="max-height: 230px;">
                        ${renderCareTimelineHtml(careLogs)}
                    </div>
                </div>

                <!-- CỘT 3: 📝 Ghi Nhận Kết Quả Chăm Sóc (Form) -->
                <div class="care-action-card" onclick="event.stopPropagation();">
                    <div class="panel-header">
                        <h4>📝 Ghi Nhận Kết Quả Chăm Sóc</h4>
                    </div>
                    
                    <div class="form-group">
                        <label>Tình trạng liên lạc <span style="color: #dc3545;">*</span></label>
                        <select id="inpContactStatus-${docId}" class="form-control">
                            <option value="Chưa liên lạc" ${contactStatus === 'Chưa liên lạc' ? 'selected' : ''}>Chưa liên lạc</option>
                            <option value="Đã liên lạc" ${contactStatus === 'Đã liên lạc' ? 'selected' : ''}>Đã liên lạc</option>
                            <option value="Không nghe máy" ${contactStatus === 'Không nghe máy' ? 'selected' : ''}>Không nghe máy</option>
                            <option value="Sai số điện thoại" ${contactStatus === 'Sai số điện thoại' ? 'selected' : ''}>Sai số điện thoại</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Tình trạng chăm sóc <span style="color: #dc3545;">*</span></label>
                        <select id="inpCareStatus-${docId}" class="form-control">
                            <option value="" ${!careStatus ? 'selected' : ''}>-- Chọn tình trạng chăm sóc --</option>
                            <option value="Đã đi học" ${careStatus === 'Đã đi học' ? 'selected' : ''}>Đã đi học</option>
                            <option value="Sẽ đi học" ${careStatus === 'Sẽ đi học' ? 'selected' : ''}>Sẽ đi học</option>
                            <option value="Nghỉ học kỳ" ${careStatus === 'Nghỉ học kỳ' ? 'selected' : ''}>Nghỉ học kỳ</option>
                            <option value="Lý do khác" ${careStatus === 'Lý do khác' ? 'selected' : ''}>Lý do khác</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Ghi chú chi tiết</label>
                        <textarea id="inpCareNotes-${docId}" class="form-control" placeholder="Nhập tóm tắt nội dung trao đổi...">${notes}</textarea>
                    </div>

                    <button type="button" id="btnSave-${docId}" class="btn-save-care-result">
                        💾 Lưu Kết Quả Chăm Sóc
                    </button>
                </div>
            </div>
        `;

        // 5. Gắn sự kiện Lưu Kết Quả Inline
        const btnSave = document.getElementById(`btnSave-${docId}`);
        if (btnSave) {
            btnSave.addEventListener('click', (e) => {
                e.stopPropagation();
                saveInlineCareResult(docId, studentId);
            });
        }

        // 6. Gắn sự kiện Thêm Nhận Xét Của GV Đứng Lớp
        const btnSendRemark = document.getElementById(`btnSendRemark-${docId}`);
        const inpRemark = document.getElementById(`inpRemark-${docId}`);
        if (btnSendRemark && inpRemark) {
            btnSendRemark.addEventListener('click', (e) => {
                e.stopPropagation();
                addInstructorRemark(docId, studentId);
            });
            inpRemark.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    addInstructorRemark(docId, studentId);
                }
            });
        }

    } catch (error) {
        console.error("Lỗi khi render workspace inline:", error);
        wsContainer.innerHTML = `<div class="text-danger" style="padding: 10px;">❌ Lỗi khi tải hồ sơ: ${error.message}</div>`;
    }
}

/**
 * Xử lý Thêm Nhận Xét Tích Lũy Của GV Đứng Lớp vào Students/{studentId}
 */
async function addInstructorRemark(docId, studentId) {
    const inp = document.getElementById(`inpRemark-${docId}`);
    const btn = document.getElementById(`btnSendRemark-${docId}`);
    const listEl = document.getElementById(`remarksList-${docId}`);
    const countEl = document.getElementById(`remarkCount-${docId}`);

    if (!inp || !btn) return;
    const text = inp.value.trim();
    if (!text) {
        showToast("Vui lòng nhập nội dung nhận xét!", "warning");
        inp.focus();
        return;
    }

    btn.disabled = true;
    btn.innerText = "⏳...";

    try {
        const teacherId = currentSession.email.split('@')[0];
        const nowIso = new Date().toISOString();
        const record = allTasks.find(t => t.id === docId) || {};
        const course = record.course_code || '';

        const newRemark = {
            teacher_id: teacherId,
            course_code: course,
            note: text,
            created_at: nowIso
        };

        // Cập nhật Cache
        let studentData = studentProfileCache.get(studentId) || {};
        let remarks = studentData.instructor_remarks || [];
        remarks.push(newRemark);
        studentData.instructor_remarks = remarks;
        studentProfileCache.set(studentId, studentData);

        // Lưu vào Firestore Students/{studentId}
        const studentRef = doc(db, "Students", studentId);
        await updateDoc(studentRef, {
            instructor_remarks: remarks,
            updated_at: nowIso
        });

        // Cập nhật DOM tức thì
        if (listEl) {
            listEl.innerHTML = renderRemarksListHtml(remarks);
            listEl.scrollTop = listEl.scrollHeight;
        }
        if (countEl) {
            countEl.textContent = remarks.length;
        }

        inp.value = '';
        showToast("🎉 Đã lưu nhận xét của GV đứng lớp thành công!", "success");

    } catch (e) {
        console.error("Lỗi khi thêm nhận xét GV:", e);
        showToast(`❌ Lỗi khi lưu nhận xét: ${e.message}`, "error");
    } finally {
        btn.disabled = false;
        btn.innerText = "💬 Gửi";
    }
}

/**
 * Helper Render Danh Sách Nhận Xét GV Đứng Lớp
 */
function renderRemarksListHtml(remarks) {
    if (!remarks || remarks.length === 0) {
        return `<p style="color: var(--text-secondary); font-size: 0.78rem; margin: 4px 0;">Chưa có nhận xét nào từ GV đứng lớp.</p>`;
    }

    return remarks.map(r => `
        <div class="remark-item">
            <div class="remark-meta">
                <span class="remark-author">👤 ${r.teacher_id || 'GV'} ${r.course_code ? `(${r.course_code})` : ''}</span>
                <span>🕒 ${formatDateTime(r.created_at)}</span>
            </div>
            <div class="remark-text">${r.note || ''}</div>
        </div>
    `).join('');
}

/**
 * Xử lý Lưu Kết quả Chăm sóc Inline (Atomic Batch Write)
 */
async function saveInlineCareResult(docId, studentId) {
    const contactSelect = document.getElementById(`inpContactStatus-${docId}`);
    const careSelect = document.getElementById(`inpCareStatus-${docId}`);
    const notesArea = document.getElementById(`inpCareNotes-${docId}`);
    const btnSave = document.getElementById(`btnSave-${docId}`);

    if (!contactSelect || !careSelect || !btnSave) return;

    const contactStatus = contactSelect.value;
    const careStatus = careSelect.value;
    const notes = notesArea ? notesArea.value.trim() : '';

    if (!careStatus) {
        showToast("Vui lòng chọn Tình trạng chăm sóc trước khi lưu!", "warning");
        careSelect.focus();
        return;
    }

    // Đổi trạng thái nút bấm (loading spinner)
    btnSave.disabled = true;
    btnSave.innerHTML = `⏳ Đang lưu kết quả...`;

    try {
        const teacherId = currentSession.email.split('@')[0];
        const nowIso = new Date().toISOString();
        const record = allTasks.find(t => t.id === docId) || {};

        // Khởi tạo Firestore Batch Write
        const batch = writeBatch(db);

        // 1. Tạo bản ghi mới vào collection CareLogs
        const careLogRef = doc(collection(db, "CareLogs"));
        const newCareLog = {
            student_id: studentId,
            academic_record_id: docId,
            course_code: record.course_code || '',
            semester: record.semester || currentSemester,
            contact_status: contactStatus,
            care_status: careStatus,
            notes: notes,
            caregiver_id: teacherId, // Ghi nhận GV trực tiếp thực hiện
            created_at: nowIso
        };
        batch.set(careLogRef, newCareLog);

        // 2. Cập nhật bản ghi AcademicRecords/{docId}
        const recordRef = doc(db, "AcademicRecords", docId);
        batch.update(recordRef, {
            contact_status: contactStatus,
            care_status: careStatus,
            notes: notes,
            status: 'Completed',
            last_care_date: nowIso,
            caregiver_id: teacherId, // GV đứng lớp tự động nhận ca nếu chưa có
            updated_at: nowIso
        });

        // 3. Thực thi Commit Atomic Write
        await batch.commit();

        // 4. Cập nhật Local State
        record.contact_status = contactStatus;
        record.care_status = careStatus;
        record.notes = notes;
        record.status = 'Completed';
        record.last_care_date = nowIso;
        record.caregiver_id = teacherId;

        // Cập nhật Cache CareLogs
        let studentLogs = careLogsCache.get(studentId) || [];
        studentLogs.unshift(newCareLog);
        careLogsCache.set(studentId, studentLogs);

        // Cập nhật giao diện Dòng chính (Master Row) tức thì
        updateMasterRowDom(docId, record);

        // Cập nhật Khối Lịch Sử CS (Timeline) của sinh viên đó ngay lập tức
        const timelineBox = document.getElementById(`timeline-${docId}`);
        if (timelineBox) {
            timelineBox.innerHTML = renderCareTimelineHtml(studentLogs);
        }

        // Cập nhật lại các Thẻ KPI
        updateKPICards(filteredTasks);

        // Thông báo thành công
        showToast(`🎉 Đã lưu kết quả chăm sóc cho sinh viên ${studentId} thành công!`, "success");

        btnSave.disabled = false;
        btnSave.innerHTML = `💾 Lưu Kết Quả Chăm Sóc`;

    } catch (error) {
        console.error("Lỗi khi lưu kết quả chăm sóc inline:", error);
        showToast(`❌ Lỗi khi lưu: ${error.message}`, "error");
        btnSave.disabled = false;
        btnSave.innerHTML = `💾 Lưu Kết Quả Chăm Sóc`;
    }
}

/**
 * Cập nhật DOM của Dòng chính (Master Row) ngay lập tức sau khi lưu
 */
function updateMasterRowDom(docId, record) {
    const row = document.getElementById(`row-${docId}`);
    if (!row) return;

    // 1. Cập nhật Badge Liên Lạc
    const tdContact = row.querySelector('.col-contact-status');
    if (tdContact) {
        let badgeClass = 'badge-contact-chua-ll';
        if (record.contact_status === 'Đã liên lạc') badgeClass = 'badge-contact-da-ll';
        else if (record.contact_status === 'Không nghe máy') badgeClass = 'badge-contact-khong-nghe';
        else if (record.contact_status === 'Sai số điện thoại') badgeClass = 'badge-contact-sai-so';
        tdContact.innerHTML = `<span class="badge-status ${badgeClass}">${record.contact_status}</span>`;
    }

    // 2. Cập nhật Badge Chăm Sóc
    const tdCare = row.querySelector('.col-care-status');
    if (tdCare) {
        let badgeClass = 'badge-care-none';
        if (record.care_status === 'Đã đi học') badgeClass = 'badge-care-da-di-hoc';
        else if (record.care_status === 'Sẽ đi học') badgeClass = 'badge-care-se-di-hoc';
        else if (record.care_status === 'Nghỉ học kỳ') badgeClass = 'badge-care-nghi-ky';
        else if (record.care_status === 'Lý do khác') badgeClass = 'badge-care-ly-do-khac';
        tdCare.innerHTML = `<span class="badge-status ${badgeClass}">${record.care_status}</span>`;
    }

    // 3. Cập nhật Lần CS Cuối
    const tdTime = row.querySelector('.col-care-time');
    if (tdTime) {
        tdTime.textContent = formatDateTime(record.last_care_date);
    }
}

/**
 * Helper render HTML Lịch Sử Chăm Sóc Timeline
 */
function renderCareTimelineHtml(logs) {
    if (!logs || logs.length === 0) {
        return `<p style="color: var(--text-secondary); font-size: 0.82rem; margin: 8px 0;">Chưa có lịch sử chăm sóc nào.</p>`;
    }

    return logs.map(log => `
        <div class="timeline-item">
            <div class="timeline-dot"></div>
            <div class="timeline-header">
                <span class="timeline-caregiver">👤 ${log.caregiver_id || 'GV'}</span>
                <span>🕒 ${formatDateTime(log.created_at)}</span>
            </div>
            <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">
                Trạng thái: <strong>${log.contact_status || '-'}</strong> | Kết quả: <strong>${log.care_status || '-'}</strong>
            </div>
            ${log.notes ? `<div class="timeline-notes">💬 ${log.notes}</div>` : ''}
        </div>
    `).join('');
}

/**
 * Helper Render Bố Cục 2 Tầng Môn Nợ & Môn Chưa Học (Phân Cấp 3 Mức CSS)
 */
function renderDebts2TierHtml(studentData, semester) {
    const debts = studentData.current_debts || [];
    const transcript = studentData.academic_transcript || {};
    const terms = studentData.transcript_terms || {};
    const lastSemester = studentData.last_transcript_semester || '';
    const lastUpdate = formatDateTime(studentData.last_transcript_update);
    const prevSemester = getPreviousSemester(semester || currentSemester);

    let infoHtml = '';
    if (lastSemester || lastUpdate !== '-') {
        infoHtml = `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 6px;">🕒 Dữ liệu nợ môn cập nhật: <strong>${lastSemester || 'Trước đây'}</strong> (${lastUpdate})</div>`;
    }

    // 1. Tầng 1: Phân Loại & Sắp Xếp Danh Sách Môn Nợ theo 3 Mức CSS
    let debtsHtml = '';
    if (debts.length > 0) {
        // Phân tích từng môn nợ
        const processedDebts = debts.map(code => {
            const subjectInfo = findSubjectData(code);
            const isPrerequisite = subjectInfo && subjectInfo.is_prerequisite === true;
            const debtTerm = terms[code] || '';
            const isRecent = debtTerm && prevSemester && debtTerm.toLowerCase().replace(/\s+/g, '') === prevSemester.toLowerCase().replace(/\s+/g, '');

            let priority = 3; // Mặc định: Bình thường
            let badgeClass = 'debt-badge-normal';
            let label = `❌ ${code}`;

            if (isPrerequisite) {
                priority = 1; // Ưu tiên cao nhất: Tiên quyết
                badgeClass = 'debt-badge-prerequisite';
                label = `⚡ ${code} (Tiên quyết)`;
            } else if (isRecent) {
                priority = 2; // Ưu tiên nhì: Mới nợ kỳ trước
                badgeClass = 'debt-badge-recent';
                label = `🕒 ${code} (${debtTerm || 'Kỳ trước'})`;
            }

            return { code, priority, badgeClass, label };
        });

        // Sắp xếp: Priority 1 (Tiên quyết) -> Priority 2 (Mới nợ) -> Priority 3 (Bình thường)
        processedDebts.sort((a, b) => a.priority - b.priority);

        debtsHtml = `
            <div class="debts-container">
                ${processedDebts.map(d => `<span class="${d.badgeClass}" title="${d.label}">${d.label}</span>`).join('')}
            </div>
        `;
    } else {
        debtsHtml = `
            <div style="font-size: 0.82rem; font-weight: 600; color: #198754; margin-bottom: 8px;">
                ✅ Sinh viên hiện không nợ môn nào.
            </div>
        `;
    }

    // 2. Tầng 2: Danh Sách Các Môn Chưa Học (Bỏ qua các môn đã Đạt)
    const unstudiedList = Object.keys(transcript).filter(c => transcript[c] === 'Chưa học');
    let unstudiedHtml = '';

    if (unstudiedList.length > 0) {
        unstudiedHtml = `
            <div class="unstudied-panel">
                <div class="unstudied-header">
                    <span>📚 CÁC MÔN CHƯA HỌC (${unstudiedList.length} môn)</span>
                </div>
                <div class="unstudied-chips-grid">
                    ${unstudiedList.map(code => `<span class="chip-unstudied">${code}</span>`).join('')}
                </div>
            </div>
        `;
    }

    return `
        ${infoHtml}
        ${debtsHtml}
        ${unstudiedHtml}
    `;
}

/**
 * Thuật toán Đánh giá Health Bars
 */
function calculateAttendanceHealth(absences, maxAllowed = 3) {
    if (absences >= maxAllowed) return { label: 'Báo Động', class: 'health-danger', percent: 25 };
    if (absences >= Math.ceil(maxAllowed / 2)) return { label: 'Cảnh Báo', class: 'health-warning', percent: 60 };
    return { label: 'Tốt', class: 'health-good', percent: 95 };
}

function calculateAcademicHealth(debtCount) {
    if (debtCount >= 3) return { label: 'Nguy Hiểm', class: 'health-danger', percent: 20 };
    if (debtCount >= 1) return { label: 'Cảnh Báo', class: 'health-warning', percent: 60 };
    return { label: 'An Toàn', class: 'health-good', percent: 100 };
}

function calculateResponseHealth(careLogs, currentContactStatus) {
    if (currentContactStatus === 'Sai số điện thoại') {
        return { label: 'Mất Liên Lạc', class: 'health-danger', percent: 15 };
    }
    if (currentContactStatus === 'Không nghe máy') {
        return { label: 'Khó Liên Lạc', class: 'health-warning', percent: 40 };
    }
    if (currentContactStatus === 'Đã liên lạc') {
        return { label: 'Tốt', class: 'health-good', percent: 90 };
    }
    if (careLogs && careLogs.length > 0) {
        const lastLog = careLogs[0];
        if (lastLog.contact_status === 'Đã liên lạc') return { label: 'Tốt', class: 'health-good', percent: 85 };
        if (lastLog.contact_status === 'Không nghe máy') return { label: 'Khó Liên Lạc', class: 'health-warning', percent: 45 };
    }
    return { label: 'Chưa Rõ', class: 'health-warning', percent: 50 };
}

/**
 * Trợ Lý AI: Tạo Kịch Bản Gợi Ý Chăm Sóc Dựa Trên Rule-Based
 */
function generateSmartSuggestion(absences, debtCount, careLogs, contactStatus) {
    if (contactStatus === 'Sai số điện thoại') {
        return {
            title: "🚨 Kịch bản: Thu thập lại thông tin liên lạc",
            text: "Số điện thoại hiện tại không đúng. Hãy tra cứu Email trường cấp hoặc liên hệ cán bộ quản lý lớp/bộ môn để xin lại số điện thoại phụ huynh."
        };
    }
    if (contactStatus === 'Không nghe máy') {
        return {
            title: "📞 Kịch bản: Gọi lại vào khung giờ khác & Nhắn tin",
            text: "Sinh viên hoặc phụ huynh không nghe máy. Gợi ý gửi tin nhắn SMS/Zalo lịch sự giới thiệu Giảng viên và hẹn giờ gọi lại (ví dụ 11h30 - 12h30 hoặc sau 17h30)."
        };
    }
    if (absences >= 3 && debtCount >= 2) {
        return {
            title: "⚠️ Kịch bản: Nguy cơ bỏ học / Quá tải tín chỉ",
            text: `Sinh viên vắng ${absences} buổi và nợ ${debtCount} môn. Khả năng cao sinh viên bị hổng kiến thức hoặc chán nản. Gợi ý: Lắng nghe khó khăn, động viên tập trung qua môn kỳ này trước, hỗ trợ hướng dẫn giảm tải tín chỉ kỳ sau.`
        };
    }
    if (absences >= 2 && debtCount === 0) {
        return {
            title: "❤️ Kịch bản: Thăm hỏi biến cố đột xuất",
            text: `Sinh viên có học lực tốt (không nợ môn) nhưng kỳ này vắng đột ngột ${absences} buổi. Hành động: Không trách mắng điểm danh. Hỏi thăm nhẹ nhàng về sức khỏe hoặc việc gia đình, hướng dẫn làm đơn bảo lưu nếu bất khả kháng.`
        };
    }
    if (absences >= 4) {
        return {
            title: "🚨 Kịch bản: Cận kề ngưỡng cấm thi",
            text: `Sinh viên đã vắng ${absences} buổi (rất gần hoặc đã chạm ngưỡng 20%). Nhắc nhở nghiêm túc về quy chế điểm danh, yêu cầu cam kết đi học 100% các buổi còn lại và hoàn thành bài tập bù.`
        };
    }
    return {
        title: "✨ Kịch bản: Động viên học tập thường quy",
        text: "Trao đổi nhẹ nhàng về tiến độ học tập trên lớp, kiểm tra xem sinh viên có vướng mắc về bài lab/assignment hay không để hỗ trợ kịp thời."
    };
}

/**
 * Hiển thị Toast thông báo nổi
 */
function showToast(message, type = 'success') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        toast.style.transition = 'all 0.25s ease';
        setTimeout(() => toast.remove(), 250);
    }, 3500);
}

/**
 * Format Date Time Tiếng Việt
 */
function formatDateTime(isoString) {
    if (!isoString) return '-';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '-';
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${minutes}`;
    } catch {
        return '-';
    }
}
