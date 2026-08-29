import { db, collection, getDocs, doc, setDoc, query, limit, startAfter, writeBatch, Timestamp, orderBy } from './firebase-init.js';
import { checkAuth } from './auth.js';

let allTeachers = []; // Mảng chứa dữ liệu giáo viên đã load
let dirtyRows = new Set(); // Chứa danh sách docId bị sửa
let lastVisible = null; // Dùng cho phân trang (Lazyload)
const limitCount = 10; // Mỗi lần load 40 GV
let isEndOfData = false;

// Trạng thái modal ACL
let currentAclTeacherId = null;

let currentSession = null;

// Chờ DOM load
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Kiểm tra xác thực (Chỉ Admin/Super Admin mới được vào)
    currentSession = await checkAuth(['Admin', 'Super Admin']);
    if (!currentSession) return;

    // Khóa trường phân quyền ở dòng thêm mới nếu không phải Super Admin
    const isSuperAdmin = currentSession.role === 'Super Admin';
    if (!isSuperAdmin) {
        const newSysRole = document.getElementById('new_system_role');
        if (newSysRole) {
            newSysRole.disabled = true;
            newSysRole.title = "Chỉ Super Admin mới được thay đổi Quyền hạn";
            newSysRole.style.backgroundColor = "#f1f3f5";
            newSysRole.style.cursor = "not-allowed";
        }
    }

    // 2. Load dữ liệu ban đầu
    await loadTeachers(false);

    // 3. Đăng ký sự kiện
    document.getElementById('btnAddTeacher').addEventListener('click', handleAddTeacher);
    document.getElementById('btnSaveAll').addEventListener('click', handleSaveAll);
    document.getElementById('btnLoadMore').addEventListener('click', () => loadTeachers(true));

    // Sự kiện Excel
    document.getElementById('btnDownloadTemplate').addEventListener('click', downloadTemplate);
    document.getElementById('fileImportExcel').addEventListener('change', handleImportExcel);
    document.getElementById('btnExportExcel').addEventListener('click', exportExcel);

    // Sự kiện Modal ACL
    document.getElementById('btnCancelAcl').addEventListener('click', closeAclModal);
    document.getElementById('btnSaveAcl').addEventListener('click', saveAclModal);
});

/**
 * Hàm hỗ trợ convert Timestamp <-> String YYYY-MM-DD
 */
function timestampToDateString(ts) {
    if (!ts) return "";
    // ts có thể là kiểu Timestamp của Firebase (có hàm toDate())
    let dateObj;
    if (ts && typeof ts.toDate === 'function') {
        dateObj = ts.toDate();
    } else if (ts.seconds) {
        dateObj = new Date(ts.seconds * 1000);
    } else {
        return ""; // format lạ
    }
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function dateStringToTimestamp(dateStr) {
    if (!dateStr) return null;
    const dateObj = new Date(dateStr);
    // Nếu ngày hợp lệ
    if (!isNaN(dateObj.getTime())) {
        return Timestamp.fromDate(dateObj);
    }
    return null;
}

/**
 * Fetch dữ liệu Giảng viên từ Firestore
 */
async function loadTeachers(isLoadMore = false) {
    const loadingRow = document.getElementById('loadingRow');
    const loadMoreContainer = document.getElementById('loadMoreContainer');

    if (!isLoadMore) {
        loadingRow.style.display = 'table-row';
        allTeachers = [];
        lastVisible = null;
        isEndOfData = false;
        document.getElementById('teachersTableBody').querySelectorAll('.teacher-row').forEach(tr => tr.remove());
    } else {
        loadMoreContainer.style.display = 'none';
        loadingRow.style.display = 'table-row';
    }

    try {
        let q;
        if (lastVisible) {
            q = query(collection(db, "Teachers"), orderBy("is_lock", "asc"), orderBy("__name__"), startAfter(lastVisible), limit(limitCount));
        } else {
            q = query(collection(db, "Teachers"), orderBy("is_lock", "asc"), orderBy("__name__"), limit(limitCount));
        }

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            isEndOfData = true;
        } else {
            lastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];

            const newTeachers = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data();
                data.docId = docSnap.id;
                newTeachers.push(data);
                allTeachers.push(data);
            });

            renderTeachers(newTeachers);
        }

        loadingRow.style.display = 'none';

        // Hiện nút tải thêm nếu chưa hết dữ liệu
        if (!isEndOfData && querySnapshot.docs.length === limitCount) {
            loadMoreContainer.style.display = 'block';
        }

    } catch (error) {
        console.error("Lỗi khi load Giảng viên:", error);
        alert("Lỗi tải danh sách Giảng viên: " + error.message);
        loadingRow.style.display = 'none';
    }
}

/**
 * Render HTML cho mảng giáo viên
 */
function renderTeachers(teachersList) {
    const tbody = document.getElementById('teachersTableBody');
    const loadingRow = document.getElementById('loadingRow');

    teachersList.forEach(t => {
        const tr = document.createElement('tr');
        tr.className = 'teacher-row';
        tr.dataset.id = t.docId;

        const dobString = timestampToDateString(t.dob);

        // Map system_role chuẩn sang select option
        let sysRoleValue = t.system_role;
        // Chữa cháy nếu DB cũ lưu tiếng việt
        if (sysRoleValue === 'Giảng viên') sysRoleValue = 'Teacher';
        if (!['Teacher', 'Admin', 'Super Admin'].includes(sysRoleValue)) sysRoleValue = 'Teacher';

        const isSuperAdmin = currentSession && currentSession.role === 'Super Admin';

        tr.innerHTML = `
            <td data-label="Thông tin chung">
                <div class="stacked-inputs">
                    <input type="text" value="${t.docId}" disabled title="Không thể sửa Mã GV">
                    <input type="text" class="inp-name" value="${t.name || ''}" placeholder="Họ và Tên">
                    <input type="email" class="inp-email" value="${t.email || ''}" placeholder="Email">
                </div>
            </td>
            <td data-label="Công tác">
                <div class="stacked-inputs">
                    <select class="inp-type" title="Loại Giảng viên">
                        <option value="Full time" ${t.type === 'Full time' ? 'selected' : ''}>Full time</option>
                        <option value="Part time" ${t.type === 'Part time' ? 'selected' : ''}>Part time</option>
                    </select>
                    <select class="inp-role" title="Chức vụ">
                        <option value="Giảng viên" ${t.role === 'Giảng viên' ? 'selected' : ''}>Giảng viên</option>
                        <option value="Trưởng môn" ${t.role === 'Trưởng môn' ? 'selected' : ''}>Trưởng môn</option>
                        <option value="Chủ nhiệm bộ môn" ${t.role === 'Chủ nhiệm bộ môn' ? 'selected' : ''}>Chủ nhiệm bộ môn</option>
                    </select>
                </div>
            </td>
            <td data-label="Quyền hạn">
                <div class="stacked-inputs" style="align-items: center;">
                    <select class="inp-system_role" title="${isSuperAdmin ? 'Phân quyền (RBAC)' : 'Chỉ Super Admin mới được thay đổi Quyền hạn'}" ${!isSuperAdmin ? 'disabled style="background-color: #f1f3f5; cursor: not-allowed;"' : ''}>
                        <option value="Teacher" ${sysRoleValue === 'Teacher' ? 'selected' : ''}>Teacher</option>
                        <option value="Admin" ${sysRoleValue === 'Admin' ? 'selected' : ''}>Admin</option>
                        <option value="Super Admin" ${sysRoleValue === 'Super Admin' ? 'selected' : ''}>Super Admin</option>
                    </select>
                    <button class="btn-icon btn-acl" title="${isSuperAdmin ? 'Cấu hình ngoại lệ (ACL)' : 'Chỉ Super Admin mới có quyền cấu hình ACL'}" data-id="${t.docId}" ${!isSuperAdmin ? 'disabled style="opacity: 0.4; cursor: not-allowed;"' : ''}>⚙️</button>
                </div>
            </td>
            <td data-label="Mã NV"><input type="text" class="inp-emp_id" value="${t.emp_id || ''}"></td>
            <td data-label="Trình độ"><input type="text" class="inp-degree" value="${t.degree || ''}"></td>
            <td data-label="NVSP" class="text-center"><input type="checkbox" class="inp-pedagogy" ${t.pedagogy ? 'checked' : ''}></td>
            <td data-label="IBSTPI" class="text-center"><input type="checkbox" class="inp-ibstpi" ${t.ibstpi ? 'checked' : ''}></td>
            <td data-label="Ngày sinh"><input type="date" class="inp-dob" value="${dobString}"></td>
            <td data-label="SĐT"><input type="text" class="inp-phone" value="${t.phone || ''}"></td>
            <td data-label="Khóa" class="text-center"><input type="checkbox" class="inp-lock" ${t.is_lock ? 'checked' : ''} ${!isSuperAdmin ? 'disabled title="Chỉ Super Admin mới được khóa tài khoản"' : ''}></td>
            <td data-label="Thao tác" class="text-center">
                <button class="btn-icon btn-save-row" title="Lưu dòng này" data-id="${t.docId}" disabled>💾</button>
            </td>
        `;

        // Gắn sự kiện onChange
        const inputs = tr.querySelectorAll('input:not([disabled]), select:not([disabled])');
        inputs.forEach(inp => {
            inp.addEventListener('change', () => markRowDirty(t.docId));
        });

        // Gắn sự kiện Save riêng cho dòng
        tr.querySelector('.btn-save-row').addEventListener('click', () => saveSingleRow(t.docId));

        // Gắn sự kiện mở ACL Modal (chỉ gắn nếu là Super Admin)
        if (isSuperAdmin) {
            tr.querySelector('.btn-acl').addEventListener('click', () => openAclModal(t.docId, t.name, t.acl || {}));
        }

        // Chèn trước loading row
        tbody.insertBefore(tr, loadingRow);
    });
}

/**
 * Đánh dấu dòng bị sửa
 */
function markRowDirty(docId) {
    dirtyRows.add(docId);

    // Đổi UI
    const tr = document.querySelector(`tr[data-id="${docId}"]`);
    if (tr) {
        tr.classList.add('row-dirty');
        const saveBtn = tr.querySelector('.btn-save-row');
        if (saveBtn) saveBtn.removeAttribute('disabled');
    }

    // Bật nút Lưu tất cả
    if (dirtyRows.size > 0) {
        document.getElementById('btnSaveAll').removeAttribute('disabled');
    }
}

/**
 * Xóa đánh dấu dòng sau khi lưu
 */
function markRowClean(docId) {
    dirtyRows.delete(docId);

    const tr = document.querySelector(`tr[data-id="${docId}"]`);
    if (tr) {
        tr.classList.remove('row-dirty');
        const saveBtn = tr.querySelector('.btn-save-row');
        if (saveBtn) saveBtn.setAttribute('disabled', 'true');
    }

    if (dirtyRows.size === 0) {
        document.getElementById('btnSaveAll').setAttribute('disabled', 'true');
    }
}

/**
 * Thu thập dữ liệu từ 1 dòng HTML (dùng cho update)
 */
function collectRowData(docId) {
    const tr = document.querySelector(`tr[data-id="${docId}"]`);
    if (!tr) return null;

    const dateStr = tr.querySelector('.inp-dob').value;
    const isSuperAdmin = currentSession && currentSession.role === 'Super Admin';
    const existingTeacher = allTeachers.find(t => t.docId === docId);

    // Chỉ Super Admin mới được cập nhật system_role và is_lock
    let finalSystemRole = existingTeacher ? (existingTeacher.system_role || 'Teacher') : 'Teacher';
    if (isSuperAdmin) {
        const sysRoleInp = tr.querySelector('.inp-system_role');
        if (sysRoleInp) finalSystemRole = sysRoleInp.value;
    }

    let finalLock = existingTeacher ? !!existingTeacher.is_lock : false;
    if (isSuperAdmin) {
        const lockInp = tr.querySelector('.inp-lock');
        if (lockInp) finalLock = lockInp.checked;
    }

    return {
        name: tr.querySelector('.inp-name').value.trim(),
        email: tr.querySelector('.inp-email').value.trim(),
        type: tr.querySelector('.inp-type').value,
        role: tr.querySelector('.inp-role').value,
        system_role: finalSystemRole,
        emp_id: tr.querySelector('.inp-emp_id').value.trim(),
        degree: tr.querySelector('.inp-degree').value.trim(),
        pedagogy: tr.querySelector('.inp-pedagogy').checked,
        ibstpi: tr.querySelector('.inp-ibstpi').checked,
        dob: dateStringToTimestamp(dateStr),
        phone: tr.querySelector('.inp-phone').value.trim(),
        is_lock: finalLock
    };
}

/**
 * Thêm giáo viên mới
 */
async function handleAddTeacher() {
    const docId = document.getElementById('new_docId').value.trim();
    const name = document.getElementById('new_name').value.trim();
    const email = document.getElementById('new_email').value.trim();
    const emp_id = document.getElementById('new_emp_id').value.trim();

    // Basic validation
    if (!docId || !name || !email) {
        alert("Mã GV, Tên và Email là bắt buộc!");
        return;
    }

    // Validation unique
    const isDupDocId = allTeachers.some(t => t.docId.toLowerCase() === docId.toLowerCase());
    const isDupEmail = allTeachers.some(t => t.email.toLowerCase() === email.toLowerCase());
    const isDupEmp = emp_id && allTeachers.some(t => t.emp_id === emp_id);

    if (isDupDocId) return alert("Lỗi: Mã GV này đã tồn tại!");
    if (isDupEmail) return alert("Lỗi: Email này đã tồn tại trong hệ thống!");
    if (isDupEmp) return alert("Lỗi: Mã NV này đã tồn tại!");

    const dateStr = document.getElementById('new_dob').value;
    const isSuperAdmin = currentSession && currentSession.role === 'Super Admin';

    const newData = {
        name: name,
        email: email,
        type: document.getElementById('new_type').value,
        role: document.getElementById('new_role').value,
        system_role: isSuperAdmin ? document.getElementById('new_system_role').value : 'Teacher',
        emp_id: emp_id,
        degree: document.getElementById('new_degree').value.trim(),
        pedagogy: document.getElementById('new_pedagogy').checked,
        ibstpi: document.getElementById('new_ibstpi').checked,
        dob: dateStringToTimestamp(dateStr),
        phone: document.getElementById('new_phone').value.trim(),
        is_lock: false,
        timestamp: Timestamp.now()
    };

    const btn = document.getElementById('btnAddTeacher');
    btn.textContent = '...';
    btn.disabled = true;

    try {
        await setDoc(doc(db, "Teachers", docId), newData);

        // Cập nhật mảng cache
        newData.docId = docId;
        allTeachers.push(newData);

        alert("Thêm Giáo viên thành công!");

        // Xóa form
        document.querySelectorAll('.row-add input[type="text"], .row-add input[type="email"], .row-add input[type="date"]').forEach(el => el.value = '');
        document.querySelectorAll('.row-add input[type="checkbox"]').forEach(el => el.checked = false);

        // Render thẳng lên top bảng
        renderTeachers([newData]); // append
    } catch (err) {
        alert("Lỗi thêm GV: " + err.message);
    } finally {
        btn.textContent = '+';
        btn.disabled = false;
    }
}

/**
 * Lưu 1 dòng
 */
async function saveSingleRow(docId) {
    const data = collectRowData(docId);
    if (!data) return;

    try {
        await setDoc(doc(db, "Teachers", docId), data, { merge: true });
        markRowClean(docId);
        // Cập nhật cache allTeachers
        const idx = allTeachers.findIndex(t => t.docId === docId);
        if (idx !== -1) {
            allTeachers[idx] = { ...allTeachers[idx], ...data };
        }
    } catch (err) {
        alert("Lỗi lưu dữ liệu GV: " + err.message);
    }
}

/**
 * Lưu tất cả các dòng Dirty (Sử dụng Batch Write)
 */
async function handleSaveAll() {
    if (dirtyRows.size === 0) return;

    const btn = document.getElementById('btnSaveAll');
    btn.textContent = "Đang lưu...";
    btn.disabled = true;

    try {
        const batch = writeBatch(db);

        dirtyRows.forEach(docId => {
            const data = collectRowData(docId);
            if (data) {
                const ref = doc(db, "Teachers", docId);
                batch.set(ref, data, { merge: true });
                // Cập nhật cache local
                const idx = allTeachers.findIndex(t => t.docId === docId);
                if (idx !== -1) {
                    allTeachers[idx] = { ...allTeachers[idx], ...data };
                }
            }
        });

        await batch.commit();

        // Xóa hết trạng thái dirty trên UI
        Array.from(dirtyRows).forEach(docId => {
            markRowClean(docId);
        });

        alert(`Đã lưu thành công ${dirtyRows.size} giảng viên!`);
        dirtyRows.clear();

    } catch (err) {
        alert("Lỗi lưu Batch: " + err.message);
        document.getElementById('btnSaveAll').removeAttribute('disabled');
    } finally {
        btn.textContent = "Lưu Tất Cả Các Dòng Bị Đổi";
    }
}

/**
 * ACL Modal Logic
 */
function openAclModal(docId, teacherName, currentAcl) {
    if (!currentSession || currentSession.role !== 'Super Admin') {
        alert("Chỉ Super Admin mới có quyền cấu hình ngoại lệ (ACL)!");
        return;
    }

    currentAclTeacherId = docId;
    document.getElementById('aclTeacherName').textContent = teacherName || docId;

    // Set giá trị mặc định cho checkbox (nếu có ACL)
    document.getElementById('acl_export').checked = currentAcl.allow_export || false;
    document.getElementById('acl_manage_subjects').checked = currentAcl.allow_manage_subjects || false;
    document.getElementById('acl_delete_students').checked = currentAcl.allow_delete_students || false;

    document.getElementById('aclModal').style.display = 'flex';
}

function closeAclModal() {
    document.getElementById('aclModal').style.display = 'none';
    currentAclTeacherId = null;
}

function saveAclModal() {
    if (!currentSession || currentSession.role !== 'Super Admin') {
        alert("Chỉ Super Admin mới có quyền lưu quyền ngoại lệ (ACL)!");
        return;
    }
    if (!currentAclTeacherId) return;

    // Lấy dữ liệu
    const aclData = {
        allow_export: document.getElementById('acl_export').checked,
        allow_manage_subjects: document.getElementById('acl_manage_subjects').checked,
        allow_delete_students: document.getElementById('acl_delete_students').checked,
    };

    // Lưu vào cache
    const idx = allTeachers.findIndex(t => t.docId === currentAclTeacherId);
    if (idx !== -1) {
        allTeachers[idx].acl = aclData;
    }

    const ref = doc(db, "Teachers", currentAclTeacherId);
    setDoc(ref, { acl: aclData }, { merge: true })
        .then(() => {
            closeAclModal();
        })
        .catch(err => {
            alert("Lỗi lưu Quyền ngoại lệ: " + err.message);
        });
}

/**
 * ===================== EXCEL MODULE =====================
 */

const EXCEL_HEADERS = [
    "Mã GV*",
    "Họ và Tên*",
    "Email*",
    "Mã NV",
    "Loại (Full time/Part time)",
    "Chức vụ (Giảng viên/Trưởng môn/Chủ nhiệm bộ môn)",
    "Phân quyền (Teacher/Admin/Super Admin)",
    "Trình độ",
    "NVSP (Có/Không)",
    "IBSTPI (Có/Không)",
    "Ngày sinh (YYYY-MM-DD)",
    "SĐT",
    "Khóa (Có/Không)"
];

/**
 * 1. Tải file mẫu
 */
function downloadTemplate() {
    // Tạo 1 dòng data ví dụ
    const sampleData = [
        ["GV01", "Nguyễn Văn A", "nva@fpt.edu.vn", "001234", "Full time", "Giảng viên", "Teacher", "Thạc sĩ", "Có", "Không", "1990-05-15", "0912345678", "Không"]
    ];

    const ws_data = [EXCEL_HEADERS, ...sampleData];
    const ws = XLSX.utils.aoa_to_sheet(ws_data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");

    // Thay đổi độ rộng cột cho đẹp
    const wscols = [
        { wch: 15 }, { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 25 },
        { wch: 45 }, { wch: 35 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
        { wch: 25 }, { wch: 15 }, { wch: 15 }
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, "Template_Import_GiangVien.xlsx");
}

/**
 * 2. Xử lý Import Excel
 */
async function handleImportExcel(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Đọc file excel
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];

            // Chuyển sheet sang dạng mảng JSON
            // raw: false để XLSX tự định dạng lại Date thành string (phụ thuộc vào hiển thị excel)
            const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });

            // Bỏ qua dòng header (dòng 0)
            if (rows.length <= 1) {
                alert("File Excel không có dữ liệu!");
                return;
            }

            const confirmImport = confirm(`Tìm thấy ${rows.length - 1} dòng dữ liệu. Quá trình import có thể mất một chút thời gian. Bạn có chắc chắn muốn tiến hành?`);
            if (!confirmImport) return;

            // Xử lý từng dòng để map sang Object
            const parsedData = [];
            for (let i = 1; i < rows.length; i++) {
                const row = rows[i];
                // Bỏ qua dòng rỗng hoàn toàn
                if (!row || row.length === 0 || !row[0]) continue;

                // Mapping dữ liệu dựa trên Index mảng (cùng thứ tự với EXCEL_HEADERS)
                // row[0]: Mã GV*, row[1]: Họ và Tên*, row[2]: Email*
                const docId = (row[0] || "").toString().trim();
                const name = (row[1] || "").toString().trim();
                const email = (row[2] || "").toString().trim();

                if (!docId || !name || !email) {
                    console.warn(`Bỏ qua dòng ${i + 1}: Thiếu trường bắt buộc.`);
                    continue;
                }

                // Helper để parse Checkbox (Có/Không)
                const parseCheckbox = (val) => {
                    if (!val) return false;
                    const str = val.toString().trim().toLowerCase();
                    return (str === 'có' || str === 'yes' || str === '1' || str === 'true');
                };

                const type = (row[4] || "Full time").toString().trim();
                const role = (row[5] || "Giảng viên").toString().trim();
                const sysRole = (row[6] || "Teacher").toString().trim();
                const dateStr = (row[10] || "").toString().trim(); // Kì vọng YYYY-MM-DD

                const isSuperAdmin = currentSession && currentSession.role === 'Super Admin';

                const newData = {
                    name: name,
                    email: email,
                    emp_id: (row[3] || "").toString().trim(),
                    type: ["Full time", "Part time"].includes(type) ? type : "Full time",
                    role: ["Giảng viên", "Trưởng môn", "Chủ nhiệm bộ môn"].includes(role) ? role : "Giảng viên",
                    system_role: isSuperAdmin ? (["Teacher", "Admin", "Super Admin"].includes(sysRole) ? sysRole : "Teacher") : "Teacher",
                    degree: (row[7] || "").toString().trim(),
                    pedagogy: parseCheckbox(row[8]),
                    ibstpi: parseCheckbox(row[9]),
                    dob: dateStringToTimestamp(dateStr),
                    phone: (row[11] || "").toString().trim(),
                    is_lock: isSuperAdmin ? parseCheckbox(row[12]) : false,
                    timestamp: Timestamp.now()
                };

                parsedData.push({ docId, data: newData });
            }

            if (parsedData.length === 0) {
                alert("Không tìm thấy dữ liệu hợp lệ để import.");
                return;
            }

            // Ghi vào Firestore qua Batch (Tối đa 500 records/batch)
            document.body.style.cursor = 'wait';
            const CHUNK_SIZE = 450;
            let batchCount = 0;

            for (let i = 0; i < parsedData.length; i += CHUNK_SIZE) {
                const chunk = parsedData.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                chunk.forEach(item => {
                    const ref = doc(db, "Teachers", item.docId);
                    batch.set(ref, item.data, { merge: true });
                });

                await batch.commit();
                batchCount++;
            }

            document.body.style.cursor = 'default';
            alert(`Nhập thành công ${parsedData.length} giảng viên (Qua ${batchCount} đợt ghi)!`);

            // Reload lại bảng
            await loadTeachers(false);

        } catch (err) {
            document.body.style.cursor = 'default';
            console.error("Lỗi parse file Excel:", err);
            alert("Đã xảy ra lỗi khi đọc/ghi file Excel: " + err.message);
        } finally {
            // Reset input file để có thể up lại cùng 1 file
            event.target.value = '';
        }
    };
    reader.readAsArrayBuffer(file);
}

/**
 * 3. Xuất ra file Excel
 */
async function exportExcel() {
    const btn = document.getElementById('btnExportExcel');
    btn.textContent = 'Đang tải...';
    btn.disabled = true;

    try {
        // Fetch TOÀN BỘ dữ liệu để export
        const q = query(collection(db, "Teachers"), orderBy("is_lock", "asc"), orderBy("__name__"));
        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            alert("Không có dữ liệu để xuất!");
            return;
        }

        const ws_data = [EXCEL_HEADERS];

        snapshot.forEach(docSnap => {
            const t = docSnap.data();
            const docId = docSnap.id;

            // Format check
            const formatCheck = (val) => val ? "Có" : "Không";
            const dobString = timestampToDateString(t.dob);

            const row = [
                docId,
                t.name || "",
                t.email || "",
                t.emp_id || "",
                t.type || "",
                t.role || "",
                t.system_role || "",
                t.degree || "",
                formatCheck(t.pedagogy),
                formatCheck(t.ibstpi),
                dobString,
                t.phone || "",
                formatCheck(t.is_lock)
            ];
            ws_data.push(row);
        });

        // Tạo workbook
        const ws = XLSX.utils.aoa_to_sheet(ws_data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Danh_Sach_Giang_Vien");

        // Styling cột
        const wscols = [
            { wch: 15 }, { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 15 },
            { wch: 20 }, { wch: 20 }, { wch: 15 }, { wch: 15 }, { wch: 15 },
            { wch: 15 }, { wch: 15 }, { wch: 15 }
        ];
        ws['!cols'] = wscols;

        XLSX.writeFile(wb, "DanhSach_GiangVien_Export.xlsx");

    } catch (err) {
        console.error("Lỗi xuất Excel:", err);
        alert("Có lỗi khi xuất Excel: " + err.message);
    } finally {
        btn.textContent = '📤 Xuất Excel';
        btn.disabled = false;
    }
}
