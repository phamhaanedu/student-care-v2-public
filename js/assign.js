// assign.js - Logic Phân Công Chăm Sóc Sinh Viên

import { db, doc, getDoc, getDocs, collection, query, where, writeBatch, Timestamp } from './firebase-init.js';
import { checkAuth } from './auth.js';

// State
let globalConfig = { available_semesters: [], current_semester: '' };
let currentSemester = '';
let allSemesterRecords = []; // Toàn bộ records của kỳ đã chọn
let displayedRecords = []; // Records hiển thị sau khi lọc mức độ vắng
let dirtyRecords = new Map(); // docId -> caregiver_id
let careLogsMap = new Map(); // student_id -> { care_time, care_count, last_care_summary }
let currentSession = null;

// DOM Elements
const selectSemester = document.getElementById('selectSemester');
const selectAbsenceFilter = document.getElementById('selectAbsenceFilter');
const inpTeacherList = document.getElementById('inpTeacherList');
const btnAutoAssign = document.getElementById('btnAutoAssign');
const btnSaveAssign = document.getElementById('btnSaveAssign');
const summaryBanner = document.getElementById('summaryBanner');
const recordCountEl = document.getElementById('recordCount');
const assignTableBody = document.getElementById('assignTableBody');

document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 1. Kiểm tra xác thực (Chỉ Admin và Super Admin được phép truy cập)
        currentSession = await checkAuth(['Admin', 'Super Admin']);
        if (!currentSession) return;

        // 2. Khởi tạo cấu hình kỳ học
        await initSemesterConfig();

        // 3. Đăng ký sự kiện
        selectSemester.addEventListener('change', handleSemesterChange);
        selectAbsenceFilter.addEventListener('change', handleFilterChange);
        btnAutoAssign.addEventListener('click', handleAutoAssign);
        btnSaveAssign.addEventListener('click', handleSaveAssign);

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
 * Xử lý khi thay đổi Mức độ vắng
 */
function handleFilterChange() {
    applyFilterAndRender();
}

/**
 * Lọc mảng allSemesterRecords theo mức độ vắng và Render
 */
function applyFilterAndRender() {
    const filterVal = selectAbsenceFilter.value;

    displayedRecords = allSemesterRecords.filter(r => {
        const absences = r.total_absences || 0;
        if (filterVal === 'all_risk') {
            // Nguy hiểm: Vắng >= 2 buổi
            return absences >= 2;
        } else if (filterVal === '1') {
            return absences === 1;
        } else if (filterVal === '2') {
            return absences === 2;
        } else if (filterVal === '3') {
            return absences === 3;
        } else if (filterVal === 'gte4') {
            return absences >= 4;
        } else if (filterVal === 'all') {
            return true;
        }
        return true;
    });

    // Cập nhật banner số lượng
    recordCountEl.textContent = displayedRecords.length;
    summaryBanner.style.display = 'flex';

    renderTable();
}

/**
 * Format thời gian DD/MM/YYYY HH:mm
 */
function formatDateTime(timeVal) {
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

        // Hiển thị môn học (course_code và course_name nếu có)
        const courseDisplay = record.course_name ? `${record.course_code} (${record.course_name})` : record.course_code;
        const classDisplay = record.class_name || record.class_id || '-';
        const careTimeDisplay = formatDateTime(record.care_time);
        const careCountDisplay = record.care_count || 0;
        const careHistoryDisplay = record.last_care_summary || '-';

        html += `
            <tr class="${isDirty ? 'row-dirty' : ''}" data-id="${record.docId}">
                <td class="col-student-id" data-label="Mã SV">${record.student_id}</td>
                <td class="col-name" data-label="Họ Tên">${record.name || '-'}</td>
                <td class="col-course" data-label="Mã Môn">${courseDisplay}</td>
                <td class="col-class" data-label="Lớp">${classDisplay}</td>
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
