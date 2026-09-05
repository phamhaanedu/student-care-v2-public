// subjects.js - Quản lý Danh mục Môn học (Subjects Management) & Quét Khám Phá Môn Mới Theo Kỳ

import { db, collection, getDocs, doc, setDoc, deleteDoc, writeBatch, query, where } from './firebase-init.js';
import { checkAuth } from './auth.js';
import { SemesterService } from './services/semester-service.js';
import { SubjectService } from './services/subject-service.js';
import { StorageCache } from './utils/storage-cache.js';
import { showToast } from './utils/toast.js';
import { exportToExcel } from './utils/excel-exporter.js';
import { SYSTEM_ROLES } from './constants/index.js';


let allSubjects = []; // Danh sách môn học đã tải
let dirtyRows = new Set(); // Chứa các docId bị sửa
let currentSession = null;
let currentSemester = ''; // Kỳ học hiện tại
let missingSubjectsCache = []; // Danh sách môn thiếu sau khi quét

// DOM Elements
let tbody, loadingRow, inpSearchSubject, subjectCountBadge, btnSaveAll, txtCurrentSemester, btnScanMissing, selectScanSemester;
let modalScanMissing, modalSemester, missingSubjectsList, btnCloseModalScan, btnAddAllMissing;

function getDOMElements() {
    tbody = document.getElementById('subjectsTableBody');
    loadingRow = document.getElementById('loadingRow');
    inpSearchSubject = document.getElementById('inpSearchSubject');
    subjectCountBadge = document.getElementById('subjectCountBadge');
    btnSaveAll = document.getElementById('btnSaveAll');
    txtCurrentSemester = document.getElementById('txtCurrentSemester');
    btnScanMissing = document.getElementById('btnScanMissing');
    selectScanSemester = document.getElementById('selectScanSemester');

    // Modal elements
    modalScanMissing = document.getElementById('modalScanMissing');
    modalSemester = document.getElementById('modalSemester');
    missingSubjectsList = document.getElementById('missingSubjectsList');
    btnCloseModalScan = document.getElementById('btnCloseModalScan');
    btnAddAllMissing = document.getElementById('btnAddAllMissing');
}

/**
 * Hàm khởi tạo chính
 */
async function init() {
    getDOMElements();

    try {
        // 1. Kiểm tra xác thực (Chỉ Admin & Super Admin)
        const session = await checkAuth([SYSTEM_ROLES.ADMIN, SYSTEM_ROLES.SUPER_ADMIN]);
        if (!session) return;

        currentSession = session;


        // 2. Tải kỳ học hiện tại & Danh sách môn học
        await Promise.all([
            loadCurrentSemester(),
            loadSubjects()
        ]);

        // 3. Đăng ký sự kiện
        const btnAdd = document.getElementById('btnAddSubject');
        if (btnAdd) btnAdd.addEventListener('click', handleAddSubject);
        if (btnSaveAll) btnSaveAll.addEventListener('click', handleSaveAll);
        if (inpSearchSubject) inpSearchSubject.addEventListener('input', handleSearch);
        if (selectScanSemester) selectScanSemester.addEventListener('change', updateScanButtonText);
        if (btnScanMissing) btnScanMissing.addEventListener('click', handleScanMissing);

        // Sự kiện Modal Quét
        if (btnCloseModalScan) btnCloseModalScan.addEventListener('click', closeModalScan);
        if (btnAddAllMissing) btnAddAllMissing.addEventListener('click', handleAddAllMissing);

        // Sự kiện Excel
        const btnTemplate = document.getElementById('btnDownloadTemplate');
        if (btnTemplate) btnTemplate.addEventListener('click', downloadTemplate);
        const fileImport = document.getElementById('fileImportExcel');
        if (fileImport) fileImport.addEventListener('change', handleImportExcel);
        const btnExport = document.getElementById('btnExportExcel');
        if (btnExport) btnExport.addEventListener('click', exportExcel);

    } catch (error) {
        console.error("Lỗi khởi tạo module Subjects:", error);
    }
}

// Đảm bảo chạy init ngay cả khi DOMContentLoaded đã kích hoạt trước đó (ES Module CDN race condition)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

/**
 * Tải kỳ học hiện tại & Danh sách kỳ từ Configuration/Global
 */
async function loadCurrentSemester() {
    try {
        const config = await SemesterService.getGlobalConfig();
        currentSemester = config.current_semester || '';

        // Đổ danh sách kỳ vào Dropdown Quét Môn
        if (selectScanSemester && config.sorted_semesters) {
            selectScanSemester.innerHTML = config.sorted_semesters.map(sem => {
                const isCurrent = (sem === currentSemester);
                const label = isCurrent ? `📅 ${sem} (Hiện tại)` : `📅 ${sem}`;
                return `<option value="${sem}" ${isCurrent ? 'selected' : ''}>${label}</option>`;
            }).join('');
        }

        updateScanButtonText();
    } catch (e) {
        console.error("Lỗi khi đọc current_semester:", e);
    }
}

/**
 * Cập nhật nhãn của nút quét theo kỳ đang được chọn
 */
function updateScanButtonText() {
    const targetSem = selectScanSemester ? selectScanSemester.value : currentSemester;
    if (txtCurrentSemester) {
        txtCurrentSemester.textContent = targetSem || currentSemester || '...';
    }
}


/**
 * Tải danh sách môn học từ Cache / Firestore (Sắp xếp theo Mã môn từ A-Z)
 * @param {boolean} forceRefresh
 */
async function loadSubjects(forceRefresh = false) {
    if (loadingRow) loadingRow.style.display = 'table-row';
    if (tbody) tbody.querySelectorAll('.subject-row').forEach(r => r.remove());
    allSubjects = [];
    dirtyRows.clear();
    updateSaveAllButtonState();

    try {
        console.log("Đang tải danh mục môn học qua SubjectService...");
        const subMap = await SubjectService.getSubjectsMap(forceRefresh);
        
        subMap.forEach((data, docId) => {
            allSubjects.push({ ...data, docId: docId });
        });

        console.log(`Đã tải thành công ${allSubjects.length} môn học.`);

        // Sắp xếp theo Mã môn (docId) từ A-Z
        allSubjects.sort((a, b) => (a.docId || '').localeCompare(b.docId || ''));

        renderSubjects(allSubjects);
        updateCountBadge(allSubjects.length);


    } catch (error) {
        console.error("Lỗi tải danh mục môn học:", error);
        alert("❌ Lỗi tải danh sách Môn học: " + error.message);
    } finally {
        if (loadingRow) loadingRow.style.display = 'none';
    }
}

/**
 * Render danh sách môn học lên Table
 */
function renderSubjects(subjectsList) {
    if (!tbody) return;

    // Xóa các dòng dữ liệu cũ
    tbody.querySelectorAll('.subject-row').forEach(r => r.remove());

    if (subjectsList.length === 0) {
        const emptyTr = document.createElement('tr');
        emptyTr.className = 'subject-row';
        emptyTr.innerHTML = `
            <td colspan="8" class="text-center" style="padding: 24px; color: var(--text-secondary);">
                Chưa có môn học nào hoặc không tìm thấy kết quả phù hợp.
            </td>
        `;
        tbody.appendChild(emptyTr);
        return;
    }

    subjectsList.forEach(s => {
        const tr = document.createElement('tr');
        tr.className = 'subject-row';
        tr.dataset.id = s.docId;

        const totalSessions = s.total_sessions !== undefined ? s.total_sessions : 12;
        const maxAbsences = s.max_absences !== undefined ? s.max_absences : 2;
        const learningMode = s.learning_mode || 'Traditional';
        const isPrereq = s.is_prerequisite === true;

        tr.innerHTML = `
            <td data-label="Mã Môn">
                <input type="text" class="inp-field inp-docId" value="${s.docId}" disabled style="background-color: #f8fafc; font-weight: 700; color: var(--primary-color);">
            </td>
            <td data-label="Tên Môn Học">
                <input type="text" class="inp-field inp-course_name" value="${s.course_name || ''}" placeholder="Tên môn học">
            </td>
            <td data-label="Chuyên Ngành">
                <input type="text" class="inp-field inp-major" value="${s.major || ''}" placeholder="Chuyên ngành">
            </td>
            <td data-label="Hình Thức">
                <select class="inp-field inp-learning_mode">
                    <option value="Traditional" ${learningMode === 'Traditional' ? 'selected' : ''}>Traditional</option>
                    <option value="Blended" ${learningMode === 'Blended' ? 'selected' : ''}>Blended</option>
                    <option value="Online" ${learningMode === 'Online' ? 'selected' : ''}>Online</option>
                </select>
            </td>
            <td data-label="Tổng Buổi" class="text-center">
                <input type="number" class="inp-field inp-total_sessions" value="${totalSessions}" min="1" max="100" style="text-align: center;">
            </td>
            <td data-label="Vắng Tối Đa" class="text-center">
                <input type="number" class="inp-field inp-max_absences" value="${maxAbsences}" min="0" max="20" style="text-align: center;">
            </td>
            <td data-label="⚡ Tiên Quyết" class="text-center">
                <input type="checkbox" class="inp-field inp-is_prerequisite checkbox-prereq" ${isPrereq ? 'checked' : ''} title="Đánh dấu là Môn Tiên Quyết">
            </td>
            <td data-label="Thao tác" class="text-center">
                <button class="btn-icon btn-delete" data-id="${s.docId}" title="Xóa môn học này">🗑️</button>
            </td>
        `;


        // Gắn sự kiện theo dõi thay đổi (Dirty Tracking)
        tr.querySelectorAll('.inp-field').forEach(input => {
            input.addEventListener('change', () => markRowDirty(tr, s.docId));
            input.addEventListener('input', () => markRowDirty(tr, s.docId));
        });

        // Gắn sự kiện Xóa môn
        const btnDel = tr.querySelector('.btn-delete');
        if (btnDel) {
            btnDel.addEventListener('click', () => handleDeleteSubject(s.docId, s.course_name));
        }

        tbody.appendChild(tr);
    });
}

/**
 * Đánh dấu dòng bị sửa đổi
 */
function markRowDirty(tr, docId) {
    tr.classList.add('row-dirty');
    dirtyRows.add(docId);
    updateSaveAllButtonState();
}

/**
 * Cập nhật trạng thái nút Lưu Tất Cả
 */
function updateSaveAllButtonState() {
    if (!btnSaveAll) return;
    if (dirtyRows.size > 0) {
        btnSaveAll.disabled = false;
        btnSaveAll.textContent = `💾 Lưu ${dirtyRows.size} Môn Bị Đổi`;
    } else {
        btnSaveAll.disabled = true;
        btnSaveAll.textContent = `💾 Lưu Tất Cả Các Dòng Bị Đổi`;
    }
}

/**
 * Cập nhật số lượng môn học hiển thị
 */
function updateCountBadge(count) {
    if (subjectCountBadge) {
        subjectCountBadge.textContent = `${count} môn học`;
    }
}

/**
 * Xử lý Quét Môn Chưa Có theo Học Kỳ Được Chọn (No Full Table Scan - Lọc theo semester)
 */
async function handleScanMissing() {
    const targetSemester = selectScanSemester ? selectScanSemester.value : currentSemester;
    if (!targetSemester) {
        alert("Chưa chọn học kỳ để quét! Vui lòng kiểm tra Configuration/Global.");
        return;
    }

    btnScanMissing.disabled = true;
    btnScanMissing.textContent = "⏳ Đang quét môn...";

    try {
        // 1. Truy vấn AcademicRecords chỉ trong kỳ được chọn
        const q = query(
            collection(db, "AcademicRecords"),
            where("semester", "==", targetSemester)
        );

        const snap = await getDocs(q);
        if (snap.empty) {
            alert(`ℹ️ Không có ca học nào trong kỳ "${targetSemester}" để quét!`);
            return;
        }

        // 2. Thống kê toàn bộ mã môn học xuất hiện trong kỳ
        const subjectStats = new Map(); // course_code -> { count, classes: Set() }

        snap.forEach(docSnap => {
            const data = docSnap.data();
            const rawCode = (data.course_code || '').trim();
            if (rawCode) {
                if (!subjectStats.has(rawCode)) {
                    subjectStats.set(rawCode, { count: 0, classes: new Set() });
                }
                const stat = subjectStats.get(rawCode);
                stat.count++;
                if (data.class_name || data.class_id) {
                    stat.classes.add(data.class_name || data.class_id);
                }
            }
        });

        // 3. So khớp với danh mục Subjects hiện có
        missingSubjectsCache = [];

        subjectStats.forEach((stat, rawCode) => {
            // Bỏ qua nếu là Unknown Course
            if (rawCode.toLowerCase().includes('unknown')) return;

            // Kiểm tra xem môn này đã có trong allSubjects chưa
            const baseCode = rawCode.split(' ')[0].split('(')[0].trim().toLowerCase();
            const exists = allSubjects.some(s => {
                const sDocId = (s.docId || '').toLowerCase();
                const sBaseCode = sDocId.split(' ')[0].split('(')[0].trim();
                return sDocId === rawCode.toLowerCase() || sBaseCode === baseCode;
            });

            if (!exists) {
                missingSubjectsCache.push({
                    code: rawCode,
                    count: stat.count,
                    classes: Array.from(stat.classes).slice(0, 3).join(', ') + (stat.classes.size > 3 ? '...' : '')
                });
            }
        });

        // 4. Xử lý kết quả
        if (missingSubjectsCache.length === 0) {
            alert(`🎉 Tuyệt vời! Toàn bộ ${subjectStats.size} môn học trong kỳ "${targetSemester}" đều ĐÃ ĐƯỢC CẤU HÌNH ĐẦY ĐỦ trong danh mục Subjects.`);
            return;
        }

        // 5. Hiển thị Modal Cảnh báo & Thêm nhanh
        if (modalSemester) modalSemester.textContent = targetSemester;
        renderMissingModalList(missingSubjectsCache);
        if (modalScanMissing) modalScanMissing.style.display = 'flex';

    } catch (e) {
        console.error("Lỗi khi quét môn học thiếu:", e);
        alert(`❌ Lỗi khi quét môn học: ${e.message}`);
    } finally {
        btnScanMissing.disabled = false;
        btnScanMissing.innerHTML = `🔍 Quét Môn Chưa Có (<span id="txtCurrentSemester">${targetSemester || '...'}</span>)`;
    }
}

/**
 * Render danh sách môn thiếu vào Modal
 */
function renderMissingModalList(missingList) {
    if (!missingSubjectsList) return;

    missingSubjectsList.innerHTML = missingList.map(m => `
        <div class="missing-subject-card">
            <div class="missing-subject-info">
                <strong>📖 ${m.code}</strong>
                <div class="missing-subject-meta">
                    🏫 Các lớp: ${m.classes || 'Chưa rõ lớp'}
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge-missing-count">${m.count} ca SV</span>
            </div>
        </div>
    `).join('');
}

/**
 * Đóng Modal Quét Môn
 */
function closeModalScan() {
    if (modalScanMissing) modalScanMissing.style.display = 'none';
}

/**
 * Thêm Nhanh Tất Cả Môn Thiếu Vào Danh Mục Subjects (1-Click Batch Write)
 */
async function handleAddAllMissing() {
    if (missingSubjectsCache.length === 0) return;

    btnAddAllMissing.disabled = true;
    btnAddAllMissing.textContent = "⏳ Đang tạo môn học...";

    try {
        const batch = writeBatch(db);
        const newAddedList = [];

        missingSubjectsCache.forEach(m => {
            const docId = m.code;
            const newDocRef = doc(db, "Subjects", docId);
            const subjectData = {
                course_name: docId.split(' ')[0].split('(')[0].trim(), // Tên tạm
                major: '',
                learning_mode: 'Traditional',
                total_sessions: 12,
                max_absences: 2,
                is_prerequisite: false
            };

            batch.set(newDocRef, subjectData, { merge: true });

            subjectData.docId = docId;
            newAddedList.push(subjectData);
        });

        await batch.commit();

        // Cập nhật local memory
        allSubjects.push(...newAddedList);
        allSubjects.sort((a, b) => a.docId.localeCompare(b.docId));

        // Render lại bảng môn học
        renderSubjects(allSubjects);
        updateCountBadge(allSubjects.length);

        // Đóng modal
        closeModalScan();

        alert(`🎉 Đã thêm thành công ${newAddedList.length} môn mới vào Danh mục Subjects!\n\nVui lòng kiểm tra lại bảng danh sách để chỉnh sửa Tên môn học, Ngưỡng vắng hoặc Môn Tiên Quyết nếu cần.`);

    } catch (e) {
        console.error("Lỗi khi thêm nhanh môn học:", e);
        alert(`❌ Lỗi khi thêm nhanh môn học: ${e.message}`);
    } finally {
        btnAddAllMissing.disabled = false;
        btnAddAllMissing.textContent = "⚡ Thêm Nhanh Tất Cả Vào Danh Mục";
    }
}

/**
 * Xử lý Thêm Môn Học Mới Trực Tiếp tại Dòng 1 (row-add)
 */
async function handleAddSubject() {
    const inpDocId = document.getElementById('new_docId');
    const inpName = document.getElementById('new_course_name');
    const inpMajor = document.getElementById('new_major');
    const selectMode = document.getElementById('new_learning_mode');
    const inpSessions = document.getElementById('new_total_sessions');
    const inpAbsences = document.getElementById('new_max_absences');
    const inpIsPrereq = document.getElementById('new_is_prerequisite');
    const btnAdd = document.getElementById('btnAddSubject');

    const rawDocId = inpDocId.value.trim();
    const docId = SubjectService.standardizeCourseCode(rawDocId);
    const course_name = inpName.value.trim();
    const major = inpMajor.value.trim();
    const learning_mode = selectMode.value;
    const total_sessions = parseInt(inpSessions.value, 10) || 12;
    const max_absences = parseInt(inpAbsences.value, 10) || 2;
    const is_prerequisite = inpIsPrereq ? inpIsPrereq.checked : false;

    if (!docId) {
        alert("Vui lòng nhập Mã Môn (Doc ID)!\nVí dụ: GAM108 (GAM108) hoặc GAM108");
        inpDocId.focus();
        return;
    }

    if (!course_name) {
        alert("Vui lòng nhập Tên Môn Học!");
        inpName.focus();
        return;
    }

    // Kiểm tra xem mã môn đã tồn tại chưa
    if (allSubjects.some(s => s.docId.toLowerCase() === docId.toLowerCase())) {
        alert(`Mã môn "${docId}" đã tồn tại trong hệ thống! Vui lòng kiểm tra lại.`);
        inpDocId.focus();
        return;
    }

    btnAdd.disabled = true;
    btnAdd.textContent = "⏳";

    try {
        const newSubjectData = {
            course_name: course_name,
            major: major,
            learning_mode: learning_mode,
            total_sessions: total_sessions,
            max_absences: max_absences,
            is_prerequisite: is_prerequisite
        };

        // Lưu vào Firestore
        await setDoc(doc(db, "Subjects", docId), newSubjectData);

        // Xóa cache danh mục môn học
        StorageCache.removeLocal(SubjectService.CACHE_KEY);

        newSubjectData.docId = docId;
        allSubjects.push(newSubjectData);
        allSubjects.sort((a, b) => a.docId.localeCompare(b.docId));

        // Reset form nhập
        inpDocId.value = '';
        inpName.value = '';
        inpMajor.value = '';
        inpSessions.value = '';
        inpAbsences.value = '';
        if (inpIsPrereq) inpIsPrereq.checked = false;

        // Render lại bảng
        renderSubjects(allSubjects);
        updateCountBadge(allSubjects.length);

        alert(`🎉 Đã thêm thành công môn học "${docId} - ${course_name}"!`);

    } catch (e) {
        console.error("Lỗi thêm môn học:", e);
        alert(`❌ Lỗi khi thêm môn học: ${e.message}`);
    } finally {
        btnAdd.disabled = false;
        btnAdd.textContent = "+";
    }
}

/**
 * Xử lý Xóa Môn Học
 */
async function handleDeleteSubject(docId, courseName) {
    const confirmDelete = confirm(`⚠️ CẢNH BÁO: Bạn có chắc chắn muốn xóa môn học:\n"${docId} - ${courseName || ''}" không?`);
    if (!confirmDelete) return;

    try {
        await deleteDoc(doc(db, "Subjects", docId));
        StorageCache.removeLocal(SubjectService.CACHE_KEY);

        allSubjects = allSubjects.filter(s => s.docId !== docId);
        dirtyRows.delete(docId);
        
        renderSubjects(allSubjects);
        updateCountBadge(allSubjects.length);
        updateSaveAllButtonState();

        alert(`🗑️ Đã xóa môn học "${docId}" thành công!`);
    } catch (e) {
        console.error("Lỗi xóa môn học:", e);
        alert(`❌ Lỗi khi xóa môn học: ${e.message}`);
    }
}

/**
 * Xử lý Lưu Tất Cả Các Dòng Bị Đổi (Batch Save)
 */
async function handleSaveAll() {
    if (dirtyRows.size === 0) return;

    btnSaveAll.disabled = true;
    btnSaveAll.textContent = "⏳ Đang lưu dữ liệu...";

    try {
        const batch = writeBatch(db);

        dirtyRows.forEach(docId => {
            const tr = tbody.querySelector(`tr[data-id="${docId}"]`);
            if (tr) {
                const course_name = tr.querySelector('.inp-course_name').value.trim();
                const major = tr.querySelector('.inp-major').value.trim();
                const learning_mode = tr.querySelector('.inp-learning_mode').value;
                const total_sessions = parseInt(tr.querySelector('.inp-total_sessions').value, 10) || 12;
                const max_absences = parseInt(tr.querySelector('.inp-max_absences').value, 10) || 2;
                
                const inpIsPrereq = tr.querySelector('.inp-is_prerequisite');
                const is_prerequisite = inpIsPrereq ? inpIsPrereq.checked : false;

                const docRef = doc(db, "Subjects", docId);
                batch.set(docRef, {
                    course_name,
                    major,
                    learning_mode,
                    total_sessions,
                    max_absences,
                    is_prerequisite
                }, { merge: true });

                // Cập nhật local memory
                const localSub = allSubjects.find(s => s.docId === docId);
                if (localSub) {
                    localSub.course_name = course_name;
                    localSub.major = major;
                    localSub.learning_mode = learning_mode;
                    localSub.total_sessions = total_sessions;
                    localSub.max_absences = max_absences;
                    localSub.is_prerequisite = is_prerequisite;
                }
            }
        });

        await batch.commit();

        // Xóa cache danh mục môn học
        StorageCache.removeLocal(SubjectService.CACHE_KEY);

        // Xóa dirty state trên DOM
        tbody.querySelectorAll('.row-dirty').forEach(tr => tr.classList.remove('row-dirty'));
        dirtyRows.clear();
        updateSaveAllButtonState();

        alert(`🎉 Đã lưu thành công tất cả các thay đổi!`);

    } catch (e) {
        console.error("Lỗi khi lưu hàng loạt:", e);
        alert(`❌ Lỗi khi lưu thay đổi: ${e.message}`);
        updateSaveAllButtonState();
    }
}


/**
 * Tìm kiếm Môn học Tức thì
 */
function handleSearch() {
    const query = inpSearchSubject.value.trim().toLowerCase();
    if (!query) {
        renderSubjects(allSubjects);
        updateCountBadge(allSubjects.length);
        return;
    }

    const filtered = allSubjects.filter(s => 
        (s.docId && s.docId.toLowerCase().includes(query)) ||
        (s.course_name && s.course_name.toLowerCase().includes(query)) ||
        (s.major && s.major.toLowerCase().includes(query))
    );

    renderSubjects(filtered);
    updateCountBadge(filtered.length);
}

/**
 * Tải File Mẫu Excel
 */
function downloadTemplate() {
    if (typeof XLSX === 'undefined') {
        alert("Lỗi: Thư viện XLSX chưa sẵn sàng.");
        return;
    }

    const templateData = [
        {
            "Mã Môn (Doc ID)": "GAM104 (GAM104)",
            "Tên Môn Học": "Lập trình C# nâng cao",
            "Chuyên Ngành": "LTGame",
            "Hình Thức Học": "Traditional",
            "Tổng Số Buổi": 12,
            "Vắng Tối Đa": 2,
            "Môn Tiên Quyết (Có/Không)": "Có"
        },
        {
            "Mã Môn (Doc ID)": "COM1071 (COM107)",
            "Tên Môn Học": "Tin học cơ sở",
            "Chuyên Ngành": "Toàn trường",
            "Hình Thức Học": "Blended",
            "Tổng Số Buổi": 16,
            "Vắng Tối Đa": 3,
            "Môn Tiên Quyết (Có/Không)": "Không"
        }
    ];

    const ws = XLSX.utils.json_to_sheet(templateData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Mau_Mon_Hoc");
    XLSX.writeFile(wb, "Mau_Danh_Muc_Mon_Hoc.xlsx");
}

/**
 * Xuất Danh sách Môn học ra Excel
 */
function exportExcel() {
    if (typeof XLSX === 'undefined') {
        alert("Lỗi: Thư viện XLSX chưa sẵn sàng.");
        return;
    }

    if (allSubjects.length === 0) {
        alert("Không có dữ liệu môn học để xuất Excel!");
        return;
    }

    const exportData = allSubjects.map(s => {
        return {
            "Mã Môn (Doc ID)": s.docId,
            "Tên Môn Học": s.course_name || '',
            "Chuyên Ngành": s.major || '',
            "Hình Thức Học": s.learning_mode || 'Traditional',
            "Tổng Số Buổi": s.total_sessions !== undefined ? s.total_sessions : 12,
            "Vắng Tối Đa": s.max_absences !== undefined ? s.max_absences : 2,
            "Môn Tiên Quyết (Có/Không)": s.is_prerequisite ? "Có" : "Không"
        };
    });

    try {
        exportToExcel(`Danh_Muc_Mon_Hoc_${new Date().toISOString().slice(0, 10)}.xlsx`, [
            { sheetName: "Danh_Sach_Mon_Hoc", data: exportData }
        ]);
        showToast("Xuất file Excel thành công!", "success");
    } catch (e) {
        showToast("Lỗi khi xuất Excel: " + e.message, "error");
    }
}


/**
 * Nhập Danh sách Môn học từ Excel
 */
function handleImportExcel(e) {
    const file = e.target.files[0];
    if (!file) return;

    if (typeof XLSX === 'undefined') {
        alert("Lỗi: Thư viện XLSX chưa sẵn sàng.");
        return;
    }

    const reader = new FileReader();
    reader.onload = async (evt) => {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);

            if (!jsonData || jsonData.length === 0) {
                alert("File Excel trống hoặc không đúng định dạng!");
                return;
            }

            const confirmImport = confirm(`Tìm thấy ${jsonData.length} môn học trong file Excel. Bạn có chắc chắn muốn nhập vào hệ thống?`);
            if (!confirmImport) return;

            if (loadingRow) loadingRow.style.display = 'table-row';
            const batch = writeBatch(db);
            let count = 0;

            jsonData.forEach(row => {
                const rawDocId = (row["Mã Môn"] || row["Mã Môn (Doc ID)"] || row["docId"] || '').toString().trim();
                const docId = SubjectService.standardizeCourseCode(rawDocId);
                const course_name = (row["Tên Môn Học"] || row["course_name"] || '').toString().trim();
                const major = (row["Chuyên Ngành"] || row["major"] || '').toString().trim();
                const learning_mode = (row["Hình Thức"] || row["Hình Thức Học"] || row["learning_mode"] || 'Traditional').toString().trim();
                const total_sessions = parseInt(row["Tổng Buổi"] || row["Tổng Số Buổi"] || row["total_sessions"], 10) || 12;
                const max_absences = parseInt(row["Vắng Tối Đa"] || row["max_absences"], 10) || 2;
                
                const prereqRaw = (row["Môn Tiên Quyết (Có/Không)"] || row["Môn Tiên Quyết"] || row["Tiên Quyết"] || row["is_prerequisite"] || '').toString().trim().toLowerCase();
                const is_prerequisite = ['có', 'co', 'yes', 'true', '1', 'x', 'tiên quyết', 'tien quyet'].includes(prereqRaw);

                if (docId && course_name) {
                    const docRef = doc(db, "Subjects", docId);
                    batch.set(docRef, {
                        course_name,
                        major,
                        learning_mode,
                        total_sessions,
                        max_absences,
                        is_prerequisite
                    }, { merge: true });
                    count++;
                }
            });

            await batch.commit();

            // Xóa cache danh mục
            StorageCache.removeLocal(SubjectService.CACHE_KEY);

            alert(`🎉 Đã nhập thành công ${count} môn học từ file Excel!`);
            await loadSubjects();

        } catch (err) {
            console.error("Lỗi khi đọc file Excel:", err);
            alert("❌ Lỗi khi đọc file Excel: " + err.message);
        } finally {
            e.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

