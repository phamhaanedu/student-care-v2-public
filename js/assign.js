// assign.js - Logic Phân Công Chăm Sóc Sinh Viên

import { db, doc, getDoc, getDocs, collection, query, where, writeBatch, Timestamp } from './firebase-init.js';
import { checkAuth } from './auth.js';
import { SemesterService } from './services/semester-service.js';
import { AcademicService } from './services/academic-service.js';
import { formatDateTime } from './utils/date-helpers.js';
import { showToast } from './utils/toast.js';
import { getAbsenceBadgeClass, getBlockBadgeHtml, getClassStatusIcon } from './utils/dom-helpers.js';
import { SYSTEM_ROLES, CLASS_STATUS, BLOCK_TYPES, ABSENCE_FILTERS } from './constants/index.js';

// State
let globalConfig = { available_semesters: [], current_semester: '' };
let currentSemester = '';
let allSemesterRecords = []; // Toàn bộ records của kỳ đã chọn
let displayedRecords = []; // Records hiển thị sau khi lọc
let dirtyRecords = new Map(); // docId -> caregiver_id
let careLogsMap = new Map(); // student_id -> { care_time, care_count, last_care_summary }
let currentSession = null;
let modalClassesList = []; // Danh sách lớp trong Modal quản lý vòng đời

// DOM Elements
const selectSemester = document.getElementById('selectSemester');
const selectBlockFilter = document.getElementById('selectBlockFilter');
const selectClassStatusFilter = document.getElementById('selectClassStatusFilter');
const selectAbsenceFilter = document.getElementById('selectAbsenceFilter');
const inpTeacherList = document.getElementById('inpTeacherList');
const btnAutoAssign = document.getElementById('btnAutoAssign');
const btnSaveAssign = document.getElementById('btnSaveAssign');
const summaryBanner = document.getElementById('summaryBanner');
const recordCountEl = document.getElementById('recordCount');
const assignTableBody = document.getElementById('assignTableBody');

// Modal Elements
const btnOpenClassManager = document.getElementById('btnOpenClassManager');
const modalClassLifecycle = document.getElementById('modalClassLifecycle');
const btnCloseClassManager = document.getElementById('btnCloseClassManager');
const btnCancelClassManager = document.getElementById('btnCancelClassManager');
const btnSaveClassLifecycle = document.getElementById('btnSaveClassLifecycle');
const inpSearchModalClasses = document.getElementById('inpSearchModalClasses');
const btnSetBlock1Completed = document.getElementById('btnSetBlock1Completed');
const btnSetBlock2Ongoing = document.getElementById('btnSetBlock2Ongoing');
const btnSetAllOngoing = document.getElementById('btnSetAllOngoing');
const modalClassesTableBody = document.getElementById('modalClassesTableBody');
const modalClassesSummaryText = document.getElementById('modalClassesSummaryText');
const modalSemesterLabel = document.getElementById('modalSemesterLabel');

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Kiểm tra xác thực (Chỉ Super Admin được phép truy cập và thực hiện phân công)
        currentSession = await checkAuth([SYSTEM_ROLES.SUPER_ADMIN]);
        if (!currentSession) return;

        // 2. Khởi tạo cấu hình kỳ học
        await initSemesterConfig();


        // 3. Đăng ký sự kiện bộ lọc
        selectSemester.addEventListener('change', handleSemesterChange);
        if (selectBlockFilter) selectBlockFilter.addEventListener('change', handleFilterChange);
        if (selectClassStatusFilter) selectClassStatusFilter.addEventListener('change', handleFilterChange);
        selectAbsenceFilter.addEventListener('change', handleFilterChange);
        btnAutoAssign.addEventListener('click', handleAutoAssign);
        btnSaveAssign.addEventListener('click', handleSaveAssign);

        // 4. Đăng ký sự kiện Modal Quản lý Lớp
        if (btnOpenClassManager) btnOpenClassManager.addEventListener('click', openClassLifecycleModal);
        if (btnCloseClassManager) btnCloseClassManager.addEventListener('click', closeClassLifecycleModal);
        if (btnCancelClassManager) btnCancelClassManager.addEventListener('click', closeClassLifecycleModal);
        if (btnSaveClassLifecycle) btnSaveClassLifecycle.addEventListener('click', handleSaveClassLifecycle);
        if (inpSearchModalClasses) inpSearchModalClasses.addEventListener('input', renderModalClassesTable);

        if (btnSetBlock1Completed) {
            btnSetBlock1Completed.addEventListener('click', () => setBulkModalStatus('Block 1', 'Completed'));
        }
        if (btnSetBlock2Ongoing) {
            btnSetBlock2Ongoing.addEventListener('click', () => setBulkModalStatus('Block 2', 'Ongoing'));
        }
        if (btnSetAllOngoing) {
            btnSetAllOngoing.addEventListener('click', () => setBulkModalStatus('all', 'Ongoing'));
        }

    } catch (error) {
        console.error("Lỗi khởi tạo:", error);
    }
});

/**
 * Nạp cấu hình kỳ học từ Firestore
 */
async function initSemesterConfig() {
    try {
        const docRef = doc(db, 'Configuration', 'Global');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            globalConfig = docSnap.data();
            const semesters = globalConfig.available_semesters || [];
            currentSemester = globalConfig.current_semester || (semesters.length > 0 ? semesters[0] : '');

            // Render dropdown kỳ học
            selectSemester.innerHTML = semesters.map(s => `
                <option value="${s}" ${s === currentSemester ? 'selected' : ''}>${s}</option>
            `).join('');

            if (!currentSemester && semesters.length > 0) {
                currentSemester = semesters[0];
            }
        } else {
            selectSemester.innerHTML = '<option value="">Chưa có kỳ học</option>';
        }

        // Tải dữ liệu của kỳ hiện tại
        if (currentSemester) {
            await loadAcademicRecords(currentSemester);
        } else {
            renderEmptyState("Hệ thống chưa thiết lập kỳ học nào trong Cấu hình Hệ thống.");
        }

    } catch (error) {
        console.error("Lỗi tải kỳ học:", error);
        selectSemester.innerHTML = '<option value="">Lỗi tải kỳ học</option>';
        renderEmptyState("Lỗi tải dữ liệu kỳ học: " + error.message);
    }
}

/**
 * Xử lý khi người dùng đổi Kỳ học
 */
async function handleSemesterChange(e) {
    currentSemester = e.target.value;
    if (!currentSemester) return;

    if (dirtyRecords.size > 0) {
        const confirmChange = confirm("Bạn có các phân công chưa lưu! Nếu chuyển kỳ học, các thay đổi chưa lưu sẽ bị hủy. Bạn có muốn tiếp tục?");
        if (!confirmChange) {
            selectSemester.value = currentSemester;
            return;
        }
    }

    dirtyRecords.clear();
    await loadAcademicRecords(currentSemester);
}

/**
 * Tải danh sách AcademicRecords theo kỳ học
 */
async function loadAcademicRecords(semester) {
    showLoading();
    dirtyRecords.clear();

    try {
        // 1. Tải AcademicRecords của kỳ
        const qRecords = query(collection(db, 'AcademicRecords'), where('semester', '==', semester));
        const recordsSnapshot = await getDocs(qRecords);

        // 2. Tải CareLogs của kỳ để lấy số lần CS, thời gian và tóm tắt
        await loadCareLogsForSemester(semester);

        const records = [];
        recordsSnapshot.forEach(docSnap => {
            const data = docSnap.data();
            data.docId = docSnap.id;
            // Chuẩn hóa total_absences thành Number
            data.total_absences = parseInt(data.total_absences) || 0;

            // Bổ sung dữ liệu Care nếu có
            const careInfo = careLogsMap.get(data.student_id) || {};
            data.care_time = careInfo.care_time || data.care_time || null;
            data.care_count = careInfo.care_count !== undefined ? careInfo.care_count : (data.care_count || 0);
            data.last_care_summary = careInfo.last_care_summary || data.last_care_summary || '-';

            records.push(data);
        });

        // Sắp xếp tăng dần theo Mã Sinh Viên (student_id)
        records.sort((a, b) => (a.student_id || '').localeCompare(b.student_id || ''));
        allSemesterRecords = records;

        // Áp dụng bộ lọc vắng và render
        applyFilterAndRender();

    } catch (error) {
        console.error("Lỗi tải AcademicRecords:", error);
        renderEmptyState("Lỗi tải danh sách sinh viên: " + error.message);
    }
}

/**
 * Tải CareLogs để tổng hợp lịch sử chăm sóc
 */
async function loadCareLogsForSemester(semester) {
    careLogsMap.clear();
    try {
        const qLogs = query(collection(db, 'CareLogs'), where('semester', '==', semester));
        const logsSnapshot = await getDocs(qLogs);

        const logsByStudent = new Map();
        logsSnapshot.forEach(docSnap => {
            const log = docSnap.data();
            const sId = log.student_id;
            if (!sId) return;

            if (!logsByStudent.has(sId)) {
                logsByStudent.set(sId, []);
            }
            logsByStudent.get(sId).push(log);
        });

        // Xử lý từng sinh viên
        logsByStudent.forEach((logs, sId) => {
            // Sắp xếp log mới nhất lên đầu
            logs.sort((a, b) => {
                const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
                const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
                return timeB - timeA;
            });

            const latestLog = logs[0];
            const careCount = logs.length;
            const careTime = latestLog.timestamp || latestLog.created_at || null;
            
            // Format tóm tắt: [DD-MM] contact_status - care_status / notes
            let summary = '-';
            if (latestLog) {
                let dateStr = '';
                if (careTime) {
                    const d = new Date(careTime);
                    const dd = String(d.getDate()).padStart(2, '0');
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    dateStr = `[${dd}-${mm}] `;
                }
                const statusPart = [latestLog.contact_status, latestLog.care_status || latestLog.notes].filter(Boolean).join(' - ');
                summary = dateStr + (statusPart || 'Đã liên lạc');
            }

            careLogsMap.set(sId, {
                care_time: careTime,
                care_count: careCount,
                last_care_summary: summary
            });
        });

    } catch (e) {
        console.warn("Không thể tải CareLogs (có thể chưa có collection hoặc quyền đọc):", e);
    }
}

/**
 * Xử lý khi thay đổi Bộ lọc (Kỳ, Block, Trạng thái lớp, Mức độ vắng)
 */
function handleFilterChange() {
    applyFilterAndRender();
}

/**
 * Lọc mảng allSemesterRecords theo Block, Trạng thái lớp, Mức độ vắng và Render
 */
function applyFilterAndRender() {
    const filterAbsenceVal = selectAbsenceFilter ? selectAbsenceFilter.value : 'all_risk';
    const filterBlockVal = selectBlockFilter ? selectBlockFilter.value : 'all';
    const filterStatusVal = selectClassStatusFilter ? selectClassStatusFilter.value : 'Ongoing';

    displayedRecords = allSemesterRecords.filter(r => {
        // 1. Mức độ vắng
        const absences = r.total_absences || 0;
        let matchAbsence = true;
        if (filterAbsenceVal === 'all_risk') {
            matchAbsence = absences >= 2;
        } else if (filterAbsenceVal === '1') {
            matchAbsence = absences === 1;
        } else if (filterAbsenceVal === '2') {
            matchAbsence = absences === 2;
        } else if (filterAbsenceVal === '3') {
            matchAbsence = absences === 3;
        } else if (filterAbsenceVal === 'gte4') {
            matchAbsence = absences >= 4;
        }

        // 2. Block
        const rBlock = r.block || 'Block 1';
        let matchBlock = (filterBlockVal === 'all') || (rBlock === filterBlockVal);

        // 3. Trạng thái lớp (Mặc định Ongoing - Đang học)
        const rStatus = r.class_status || 'Ongoing';
        let matchStatus = (filterStatusVal === 'all') || (rStatus === filterStatusVal);

        return matchAbsence && matchBlock && matchStatus;
    });

    // Cập nhật banner số lượng
    recordCountEl.textContent = displayedRecords.length;
    summaryBanner.style.display = 'flex';

    renderTable();
}


/**
 * Render bảng danh sách sinh viên
 */
function renderTable() {
    if (displayedRecords.length === 0) {
        renderEmptyState("Không tìm thấy sinh viên nào phù hợp với bộ lọc hiện tại.");
        return;
    }

    let html = '';

    displayedRecords.forEach(record => {
        const absences = record.total_absences || 0;
        
        // Badge vắng: Đỏ nếu >= 3, cam nếu = 2, vàng nếu = 1
        let badgeClass = 'badge-absence-safe';
        if (absences >= 3) {
            badgeClass = 'badge-absence-danger';
        } else if (absences === 2) {
            badgeClass = 'badge-absence-warning';
        }

        // Mã GV caregiver: lấy từ dirty nếu có, không thì lấy từ record
        const caregiverVal = dirtyRecords.has(record.docId) ? dirtyRecords.get(record.docId) : (record.caregiver_id || '');
        const isDirty = dirtyRecords.has(record.docId);

        // Hiển thị môn học
        const courseDisplay = record.course_name ? `${record.course_code} (${record.course_name})` : record.course_code;
        
        // Hiển thị Lớp, Block & Trạng thái
        const clsName = record.class_name || record.class_id || '-';
        const blockName = record.block || 'Block 1';
        const blockClass = blockName === 'Block 2' ? 'badge-block-2' : (blockName === 'Full' ? 'badge-block-full' : 'badge-block-1');
        const statusIcon = record.class_status === 'Completed' ? '🏁' : (record.class_status === 'Upcoming' ? '🕒' : '🟢');

        const classDisplay = `
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span>${statusIcon} <strong>${clsName}</strong></span>
                <span class="badge-block ${blockClass}">${blockName}</span>
            </div>
        `;

        const careTimeDisplay = formatDateTime(record.care_time);
        const careCountDisplay = record.care_count || 0;
        const careHistoryDisplay = record.last_care_summary || '-';

        html += `
            <tr class="${isDirty ? 'row-dirty' : ''}" data-id="${record.docId}">
                <td class="col-student-id" data-label="Mã SV"><strong>${record.student_id}</strong></td>
                <td class="col-name" data-label="Họ Tên">${record.name || '-'}</td>
                <td class="col-course" data-label="Mã Môn">${courseDisplay}</td>
                <td class="col-class" data-label="Lớp & Block">${classDisplay}</td>
                <td class="col-absence" data-label="Vắng">
                    <span class="badge-absence ${badgeClass}">${absences}/3</span>
                </td>
                <td class="col-caregiver" data-label="Mã GV Chăm Sóc">
                    <input type="text" 
                           class="inp-caregiver" 
                           data-id="${record.docId}" 
                           value="${caregiverVal}" 
                           placeholder="Mã GV">
                </td>
                <td class="col-care-time" data-label="Thời gian CS">${careTimeDisplay}</td>
                <td class="col-care-count" data-label="Số lần CS">${careCountDisplay}</td>
                <td class="col-care-history" data-label="Lịch sử CS">${careHistoryDisplay}</td>
            </tr>
        `;
    });

    assignTableBody.innerHTML = html;

    // Gắn sự kiện sửa ô input Mã GV Chăm Sóc
    const caregiverInputs = assignTableBody.querySelectorAll('.inp-caregiver');
    caregiverInputs.forEach(input => {
        input.addEventListener('input', (e) => {
            const docId = e.target.dataset.id;
            const newVal = e.target.value.trim();
            dirtyRecords.set(docId, newVal);

            const tr = assignTableBody.querySelector(`tr[data-id="${docId}"]`);
            if (tr) tr.classList.add('row-dirty');
        });
    });
}

// ==========================================================================
// QUẢN LÝ VÒNG ĐỜI LỚP HỌC (CLASS LIFECYCLE MODAL MANAGEMENT)
// ==========================================================================

/**
 * Trích xuất danh sách lớp duy nhất từ allSemesterRecords
 */
function extractClassesLifecycle() {
    const classMap = new Map();

    allSemesterRecords.forEach(r => {
        const cls = r.class_name || r.class_id || 'Chưa rõ lớp';
        const code = r.course_code || 'Chưa rõ môn';
        const key = `${cls}___${code}`;

        const dateRange = r.date_range || '';
        const startDate = r.start_date || '';
        const endDate = r.end_date || '';
        const block = r.block || 'Block 1';
        const status = r.class_status || 'Ongoing';

        if (!classMap.has(key)) {
            classMap.set(key, {
                key: key,
                class_id: r.class_id || cls,
                class_name: cls,
                course_code: code,
                course_name: r.course_name || code,
                date_range: dateRange,
                start_date: startDate,
                end_date: endDate,
                block: block,
                class_status: status,
                count: 1
            });
        } else {
            const item = classMap.get(key);
            item.count++;
            if (!item.date_range && dateRange) item.date_range = dateRange;
            if (!item.start_date && startDate) item.start_date = startDate;
            if (!item.end_date && endDate) item.end_date = endDate;
        }
    });

    modalClassesList = Array.from(classMap.values()).sort((a, b) => {
        const comp = (a.block || '').localeCompare(b.block || '');
        if (comp !== 0) return comp;
        return a.class_name.localeCompare(b.class_name);
    });
}

/**
 * Mở Modal Quản Lý Vòng Đời Lớp
 */
function openClassLifecycleModal() {
    if (!modalClassLifecycle) return;
    extractClassesLifecycle();

    if (modalSemesterLabel) modalSemesterLabel.textContent = currentSemester || 'Chưa chọn';
    if (inpSearchModalClasses) inpSearchModalClasses.value = '';

    renderModalClassesTable();
    modalClassLifecycle.style.display = 'flex';
}

/**
 * Đóng Modal
 */
function closeClassLifecycleModal() {
    if (modalClassLifecycle) modalClassLifecycle.style.display = 'none';
}

/**
 * Render bảng danh sách lớp trong Modal
 */
function renderModalClassesTable() {
    if (!modalClassesTableBody) return;

    const searchVal = inpSearchModalClasses ? inpSearchModalClasses.value.trim().toLowerCase() : '';
    const filtered = modalClassesList.filter(c => {
        return !searchVal || 
            (c.course_code && c.course_code.toLowerCase().includes(searchVal)) ||
            (c.course_name && c.course_name.toLowerCase().includes(searchVal)) ||
            (c.class_name && c.class_name.toLowerCase().includes(searchVal));
    });

    if (filtered.length === 0) {
        modalClassesTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted" style="padding: 25px;">Không tìm thấy lớp nào phù hợp.</td></tr>`;
        updateModalSummary(modalClassesList);
        return;
    }

    let html = '';
    filtered.forEach(c => {
        const blockClass = c.block === 'Block 2' ? 'badge-block-2' : (c.block === 'Full' ? 'badge-block-full' : 'badge-block-1');
        const timeDisplay = c.date_range || (c.start_date && c.end_date ? `${c.start_date} - ${c.end_date}` : 'Theo lịch kỳ');

        html += `
            <tr data-key="${c.key}">
                <td><strong>${c.course_code}</strong></td>
                <td>${c.course_name}</td>
                <td><strong>${c.class_name}</strong></td>
                <td><span style="font-size: 0.8rem; color: #64748b;">📅 ${timeDisplay}</span></td>
                <td class="text-center">
                    <span class="badge-block ${blockClass}">${c.block || 'Block 1'}</span>
                </td>
                <td class="text-center"><strong>${c.count}</strong> SV</td>
                <td>
                    <select class="status-select-sm" data-key="${c.key}" data-status="${c.class_status}">
                        <option value="Ongoing" ${c.class_status === 'Ongoing' ? 'selected' : ''}>🟢 Đang học</option>
                        <option value="Upcoming" ${c.class_status === 'Upcoming' ? 'selected' : ''}>🕒 Chưa học</option>
                        <option value="Completed" ${c.class_status === 'Completed' ? 'selected' : ''}>🏁 Đã hoàn thành</option>
                    </select>
                </td>
            </tr>
        `;
    });

    modalClassesTableBody.innerHTML = html;

    // Gắn sự kiện đổi dropdown trạng thái
    const selects = modalClassesTableBody.querySelectorAll('.status-select-sm');
    selects.forEach(sel => {
        sel.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            const newStatus = e.target.value;
            e.target.setAttribute('data-status', newStatus);

            const targetObj = modalClassesList.find(item => item.key === key);
            if (targetObj) targetObj.class_status = newStatus;

            updateModalSummary(modalClassesList);
        });
    });

    updateModalSummary(modalClassesList);
}

/**
 * Cập nhật dòng tóm tắt số lượng trong Modal
 */
function updateModalSummary(list) {
    if (!modalClassesSummaryText) return;
    const total = list.length;
    const ongoing = list.filter(c => c.class_status === 'Ongoing').length;
    const upcoming = list.filter(c => c.class_status === 'Upcoming').length;
    const completed = list.filter(c => c.class_status === 'Completed').length;

    modalClassesSummaryText.innerHTML = `
        Tổng: <strong>${total}</strong> lớp (🟢 <strong>${ongoing}</strong> Đang học, 🕒 <strong>${upcoming}</strong> Chưa học, 🏁 <strong>${completed}</strong> Đã hoàn thành)
    `;
}

/**
 * Thao tác nhanh đổi trạng thái hàng loạt trong Modal
 */
function setBulkModalStatus(targetBlock, targetStatus) {
    modalClassesList.forEach(c => {
        if (targetBlock === 'all' || c.block === targetBlock) {
            c.class_status = targetStatus;
        }
    });

    renderModalClassesTable();
}

/**
 * Lưu cấu hình trạng thái vòng đời lớp học vào CSDL (Batch Write)
 */
async function handleSaveClassLifecycle() {
    if (!btnSaveClassLifecycle) return;
    btnSaveClassLifecycle.disabled = true;
    btnSaveClassLifecycle.textContent = "Đang lưu cấu hình...";

    try {
        const statusMap = new Map();
        modalClassesList.forEach(c => {
            statusMap.set(c.key, { block: c.block, class_status: c.class_status });
        });

        // 1. Cập nhật các bản ghi trong allSemesterRecords
        const recordsToUpdate = [];
        allSemesterRecords.forEach(r => {
            const cls = r.class_name || r.class_id || 'Chưa rõ lớp';
            const code = r.course_code || 'Chưa rõ môn';
            const key = `${cls}___${code}`;

            const newInfo = statusMap.get(key);
            if (newInfo && (r.class_status !== newInfo.class_status || r.block !== newInfo.block)) {
                r.class_status = newInfo.class_status;
                r.block = newInfo.block;
                recordsToUpdate.push({
                    docId: r.docId,
                    class_status: newInfo.class_status,
                    block: newInfo.block
                });
            }
        });

        // 2. Batch write lên Firestore collection AcademicRecords
        if (recordsToUpdate.length > 0) {
            const CHUNK_SIZE = 450;
            for (let i = 0; i < recordsToUpdate.length; i += CHUNK_SIZE) {
                const chunk = recordsToUpdate.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                chunk.forEach(item => {
                    const docRef = doc(db, 'AcademicRecords', item.docId);
                    batch.set(docRef, {
                        class_status: item.class_status,
                        block: item.block,
                        updated_at: Timestamp.now()
                    }, { merge: true });
                });

                await batch.commit();
            }
        }

        // 3. Batch write lên bảng Classes
        const batchClasses = writeBatch(db);
        modalClassesList.forEach(c => {
            const classDocId = `${currentSemester}_${c.course_code}_${c.class_id || c.class_name}`;
            const classRef = doc(db, 'Classes', classDocId);
            batchClasses.set(classRef, {
                class_id: c.class_id || c.class_name,
                class_name: c.class_name,
                course_code: c.course_code,
                course_name: c.course_name,
                semester: currentSemester,
                block: c.block,
                class_status: c.class_status,
                is_finished: (c.class_status === 'Completed'),
                updated_at: Timestamp.now()
            }, { merge: true });
        });
        await batchClasses.commit();

        closeClassLifecycleModal();
        applyFilterAndRender();
        alert(`✅ Đã lưu cấu hình vòng đời thành công cho ${modalClassesList.length} lớp học!`);

    } catch (error) {
        console.error("Lỗi lưu trạng thái lớp:", error);
        alert("Lỗi khi lưu trạng thái lớp: " + error.message);
    } finally {
        btnSaveClassLifecycle.disabled = false;
        btnSaveClassLifecycle.textContent = "💾 Lưu Trạng Thái Lớp";
    }
}

/**
 * Thuật toán Tự động chia đều thông minh (Chỉ chia trên các chỗ trống)
 * Quy tắc:
 * 1. Chỉ tìm các sinh viên/bản ghi CHƯA CÓ GV chăm sóc (chỗ trống) trong danh sách hiển thị.
 * 2. Giữ nguyên 100% các sinh viên đã được phân công từ trước.
 * 3. Chia đều các chỗ trống cho danh sách GV được nhập.
 * 4. ĐẢM BẢO TÍNH TOÀN VẸN: Nếu sinh viên ở bản ghi trống tiếp theo trùng student_id với sinh viên trước,
 *    gán tiếp cho cùng một giảng viên để 1 sinh viên chỉ do 1 GV chăm sóc.
 */
function handleAutoAssign() {
    const rawTeachers = inpTeacherList.value.trim();
    if (!rawTeachers) {
        alert("Vui lòng nhập danh sách Mã GV chăm sóc (cách nhau bởi dấu phẩy)!\nVí dụ: anph21, lapnv6, huannv");
        inpTeacherList.focus();
        return;
    }

    // Tách danh sách GV
    const teachers = rawTeachers.split(/[,;\s]+/).map(t => t.trim()).filter(Boolean);
    if (teachers.length === 0) {
        alert("Danh sách Mã GV không hợp lệ!");
        return;
    }

    if (displayedRecords.length === 0) {
        alert("Không có bản ghi nào trong danh sách để phân công!");
        return;
    }

    // 1. Lọc ra các bản ghi CHƯA ĐƯỢC PHÂN CÔNG (chỗ trống)
    const emptyRecords = displayedRecords.filter(record => {
        const currentCaregiver = dirtyRecords.has(record.docId) ? dirtyRecords.get(record.docId) : (record.caregiver_id || '');
        return !currentCaregiver || currentCaregiver.trim() === '';
    });

    if (emptyRecords.length === 0) {
        alert("ℹ️ Toàn bộ sinh viên trong danh sách hiện tại đều ĐÃ ĐƯỢC PHÂN CÔNG!\nKhông có chỗ trống nào để chia tự động.");
        return;
    }

    const totalEmpty = emptyRecords.length;
    const numTeachers = teachers.length;
    const targetQuota = Math.ceil(totalEmpty / numTeachers);

    let currentTeacherIdx = 0;
    let assignedForCurrentTeacher = 0;

    for (let i = 0; i < emptyRecords.length; i++) {
        const currentRecord = emptyRecords[i];
        const prevRecord = i > 0 ? emptyRecords[i - 1] : null;

        // Kiểm tra xem đã đủ quota và có thể chuyển sang GV tiếp theo hay chưa
        if (assignedForCurrentTeacher >= targetQuota && currentTeacherIdx < numTeachers - 1) {
            // Quy tắc đặc biệt: Nếu cùng 1 sinh viên (trùng student_id với record trống trước), giữ nguyên GV trước
            if (prevRecord && currentRecord.student_id === prevRecord.student_id) {
                // Giữ nguyên currentTeacherIdx
            } else {
                // Chuyển sang GV kế tiếp
                currentTeacherIdx++;
                assignedForCurrentTeacher = 0;
            }
        }

        const assignedTeacher = teachers[currentTeacherIdx];
        dirtyRecords.set(currentRecord.docId, assignedTeacher);
        assignedForCurrentTeacher++;
    }

    // Cập nhật giá trị lên giao diện (DOM) chỉ cho các bản ghi vừa được phân công
    emptyRecords.forEach(record => {
        const tr = assignTableBody.querySelector(`tr[data-id="${record.docId}"]`);
        if (tr) {
            tr.classList.add('row-dirty');
            const inp = tr.querySelector('.inp-caregiver');
            if (inp) {
                inp.value = dirtyRecords.get(record.docId) || '';
            }
        }
    });

    alert(`🎉 Đã tự động chia đều ${emptyRecords.length} chỗ trống cho ${teachers.length} giảng viên!\n(Các sinh viên đã có phân công từ trước vẫn được giữ nguyên).\n\nLưu ý: Dữ liệu chưa được lưu. Vui lòng kiểm tra và bấm "Lưu phân công" để hoàn tất.`);
}

/**
 * Lưu phân công vào Firestore (Batch Write)
 */
async function handleSaveAssign() {
    if (dirtyRecords.size === 0) {
        alert("Không có thay đổi phân công nào cần lưu!");
        return;
    }

    const confirmSave = confirm(`Bạn có chắc chắn muốn lưu phân công cho ${dirtyRecords.size} bản ghi đã thay đổi?`);
    if (!confirmSave) return;

    btnSaveAssign.disabled = true;
    btnSaveAssign.textContent = "Đang lưu...";

    try {
        const entries = Array.from(dirtyRecords.entries());
        const CHUNK_SIZE = 450;
        let savedCount = 0;

        for (let i = 0; i < entries.length; i += CHUNK_SIZE) {
            const chunk = entries.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach(([docId, caregiverId]) => {
                const docRef = doc(db, 'AcademicRecords', docId);
                batch.set(docRef, {
                    caregiver_id: caregiverId,
                    assigned_at: Timestamp.now(),
                    assigned_by: currentSession.email || currentSession.uid
                }, { merge: true });
            });

            await batch.commit();
            savedCount += chunk.length;
        }

        // Cập nhật lại cache dữ liệu
        dirtyRecords.forEach((caregiverId, docId) => {
            const rec = allSemesterRecords.find(r => r.docId === docId);
            if (rec) rec.caregiver_id = caregiverId;
        });

        dirtyRecords.clear();

        // Xóa trạng thái dirty trên UI
        assignTableBody.querySelectorAll('tr.row-dirty').forEach(tr => {
            tr.classList.remove('row-dirty');
        });

        alert(`✅ Đã lưu phân công thành công cho ${savedCount} bản ghi!`);

    } catch (error) {
        console.error("Lỗi khi lưu phân công:", error);
        alert("Lỗi khi lưu phân công: " + error.message);
    } finally {
        btnSaveAssign.disabled = false;
        btnSaveAssign.textContent = "Lưu phân công";
    }
}

/**
 * Hiển thị loader trong bảng
 */
function showLoading() {
    summaryBanner.style.display = 'none';
    assignTableBody.innerHTML = `
        <tr>
            <td colspan="9" class="loader-container">
                <div class="loader-spinner"></div>
            </td>
        </tr>
    `;
}

/**
 * Hiển thị trạng thái rỗng / lỗi
 */
function renderEmptyState(message) {
    summaryBanner.style.display = 'none';
    assignTableBody.innerHTML = `
        <tr>
            <td colspan="9" class="empty-state">
                <p>${message}</p>
            </td>
        </tr>
    `;
}
