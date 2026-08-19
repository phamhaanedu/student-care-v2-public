import { db, doc, getDoc, setDoc, collection, query, where, getDocs, limit } from './firebase-init.js';
import { checkAuth } from './auth.js';

let globalConfig = {
    available_semesters: [],
    current_semester: ""
};

// Elements
const tableBody = document.getElementById('semestersTableBody');
const inputNew = document.getElementById('newSemesterInput');
const btnAdd = document.getElementById('btnAddSemester');

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await checkAuth();
        // Chỉ Super Admin mới được cấu hình kỳ học
        if (session.role !== 'Super Admin') {
            alert("Bạn không có quyền truy cập trang này!");
            window.location.href = "index.html";
            return;
        }
        
        await loadSemesters();
        
        btnAdd.addEventListener('click', handleAddSemester);
    } catch (error) {
        console.error("Auth error", error);
    }
});

async function loadSemesters() {
    try {
        const docRef = doc(db, 'Configuration', 'Global');
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            globalConfig = docSnap.data();
            if (!globalConfig.available_semesters) globalConfig.available_semesters = [];
            
            // Sắp xếp
            globalConfig.available_semesters = sortSemesters(globalConfig.available_semesters);
        }
        
        renderTable();
    } catch (e) {
        console.error("Lỗi tải kỳ học", e);
        tableBody.innerHTML = `<tr><td colspan="2" class="text-center text-error">Lỗi tải dữ liệu: ${e.message}</td></tr>`;
    }
}

function sortSemesters(semesters) {
    const seasonWeight = {
        'Fall': 3,
        'Summer': 2,
        'Spring': 1
    };

    return semesters.sort((a, b) => {
        const partsA = a.split(' ');
        const partsB = b.split(' ');
        
        const seasonA = partsA[0];
        const yearA = parseInt(partsA[1]) || 0;
        
        const seasonB = partsB[0];
        const yearB = parseInt(partsB[1]) || 0;

        if (yearA !== yearB) {
            return yearB - yearA; // Năm giảm dần
        }
        
        const weightA = seasonWeight[seasonA] || 0;
        const weightB = seasonWeight[seasonB] || 0;
        return weightB - weightA; // Mùa giảm dần
    });
}

function renderTable() {
    // Giữ lại hàng đầu tiên (form Add)
    const firstRow = `
        <tr class="row-add">
            <td class="col-name">
                <input type="text" id="newSemesterInput" class="input-new-semester" placeholder="VD: Summer 2026">
            </td>
            <td class="text-center">
                <button id="btnAddSemester" class="btn-icon btn-add" title="Thêm kỳ học">+</button>
            </td>
        </tr>
    `;
    
    let html = firstRow;
    
    globalConfig.available_semesters.forEach(semester => {
        const isCurrent = semester === globalConfig.current_semester;
        
        if (isCurrent) {
            html += `
                <tr class="semester-current">
                    <td class="col-name">
                        ${semester} <span class="semester-current-text">&lt;&lt;&lt;</span>
                    </td>
                    <td class="text-center">
                        <button class="btn-icon btn-delete" onclick="handleDeleteSemester('${semester}')" title="Xóa">🗑️</button>
                    </td>
                </tr>
            `;
        } else {
            html += `
                <tr>
                    <td class="col-name">${semester}</td>
                    <td class="text-center">
                        <button class="btn-icon btn-set-current" onclick="handleSetCurrent('${semester}')" title="Đặt làm kỳ hiện tại">&lt;&lt;&lt;</button>
                        <button class="btn-icon btn-delete" onclick="handleDeleteSemester('${semester}')" title="Xóa">🗑️</button>
                    </td>
                </tr>
            `;
        }
    });
    
    tableBody.innerHTML = html;
    
    // Gắn lại sự kiện cho nút Add vì innerHTML đã ghi đè
    document.getElementById('btnAddSemester').addEventListener('click', handleAddSemester);
    // Cho phép ấn Enter
    document.getElementById('newSemesterInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') handleAddSemester();
    });
}

async function handleAddSemester() {
    const input = document.getElementById('newSemesterInput');
    let val = input.value.trim();
    if (!val) return;
    
    // Validate Regex: Chỉ cho phép định dạng "Spring 2026", "Summer 2026", "Fall 2026" (không phân biệt hoa thường lúc nhập)
    const regex = /^(Spring|Summer|Fall)\s(\d{4})$/i;
    const match = val.match(regex);
    
    if (!match) {
        alert("Định dạng kỳ học không hợp lệ!\n\nVui lòng nhập đúng quy tắc: [Mùa] [Năm].\nMùa chỉ bao gồm: Spring, Summer hoặc Fall.\nVí dụ: Summer 2026");
        return;
    }
    
    // Chuẩn hóa chuỗi (Viết hoa phác thảo chuẩn: Spring, Summer, Fall)
    const season = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    const year = match[2];
    val = `${season} ${year}`;
    
    if (globalConfig.available_semesters.includes(val)) {
        alert("Kỳ học này đã tồn tại trong hệ thống!");
        return;
    }
    
    globalConfig.available_semesters.push(val);
    globalConfig.available_semesters = sortSemesters(globalConfig.available_semesters);
    
    // Nếu đây là kỳ đầu tiên được thêm vào, mặc định set làm current
    if (globalConfig.available_semesters.length === 1) {
        globalConfig.current_semester = val;
    }
    
    await saveConfigToFirestore();
    input.value = "";
    renderTable();
}

window.handleSetCurrent = async function(semester) {
    if (confirm(`Bạn muốn thiết lập [${semester}] làm kỳ học hiện tại của hệ thống?`)) {
        globalConfig.current_semester = semester;
        await saveConfigToFirestore();
        renderTable();
    }
}

window.handleDeleteSemester = async function(semester) {
    if (!confirm(`⚠️ BẠN CÓ CHẮC CHẮN MUỐN XÓA KỲ HỌC: ${semester}?\n\nHành động này sẽ xóa khỏi danh sách cấu hình hệ thống.`)) {
        return;
    }
    
    // Kiểm tra ràng buộc: Kỳ học đã có dữ liệu chưa?
    try {
        const q = query(collection(db, 'AcademicRecords'), where('semester', '==', semester), limit(1));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            alert(`⛔ LỖI: Không thể xóa!\n\nKỳ học "${semester}" đã chứa dữ liệu sinh viên trong bảng AcademicRecords. Bạn phải xóa toàn bộ dữ liệu sinh viên của kỳ này trước khi xóa cấu hình.`);
            return;
        }
        
        // Tiến hành xóa
        globalConfig.available_semesters = globalConfig.available_semesters.filter(s => s !== semester);
        
        // Nếu xóa trúng kỳ hiện tại, reset current_semester
        if (globalConfig.current_semester === semester) {
            globalConfig.current_semester = globalConfig.available_semesters.length > 0 ? globalConfig.available_semesters[0] : "";
        }
        
        await saveConfigToFirestore();
        renderTable();
        
    } catch (e) {
        console.error("Lỗi khi kiểm tra dữ liệu", e);
        alert("Có lỗi xảy ra khi kiểm tra ràng buộc xóa.");
    }
}

async function saveConfigToFirestore() {
    try {
        const docRef = doc(db, 'Configuration', 'Global');
        await setDoc(docRef, globalConfig, { merge: true });
    } catch (e) {
        console.error("Lỗi lưu cấu hình", e);
        alert("Lỗi khi lưu dữ liệu lên server!");
    }
}
