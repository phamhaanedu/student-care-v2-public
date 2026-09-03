// client/js/semesters.js - Controller Quản lý Kỳ học

import { db, collection, query, where, getDocs, limit } from './firebase-init.js';
import { checkAuth } from './auth.js';
import { SemesterService } from './services/semester-service.js';
import { sortSemestersList } from './utils/date-helpers.js';
import { showToast } from './utils/toast.js';
import { SYSTEM_ROLES } from './constants/index.js';

let globalConfig = {
    available_semesters: [],
    current_semester: ""
};

// DOM Elements
const tableBody = document.getElementById('semestersTableBody');
const btnAdd = document.getElementById('btnAddSemester');

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await checkAuth([SYSTEM_ROLES.SUPER_ADMIN]);
        if (!session) return;
        
        await loadSemesters();
        if (btnAdd) btnAdd.addEventListener('click', handleAddSemester);
    } catch (error) {
        console.error("Auth error", error);
    }
});

async function loadSemesters() {
    try {
        const config = await SemesterService.getGlobalConfig(true);
        globalConfig.available_semesters = config.available_semesters || [];
        globalConfig.current_semester = config.current_semester || '';
        renderTable();
    } catch (e) {
        console.error("Lỗi tải kỳ học", e);
        if (tableBody) {
            tableBody.innerHTML = `<tr><td colspan="2" class="text-center text-error">Lỗi tải dữ liệu: ${e.message}</td></tr>`;
        }
    }
}

function renderTable() {
    if (!tableBody) return;

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
    const newBtnAdd = document.getElementById('btnAddSemester');
    if (newBtnAdd) newBtnAdd.addEventListener('click', handleAddSemester);
    
    const newSemesterInput = document.getElementById('newSemesterInput');
    if (newSemesterInput) {
        newSemesterInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') handleAddSemester();
        });
    }
}

async function handleAddSemester() {
    const input = document.getElementById('newSemesterInput');
    if (!input) return;
    let val = input.value.trim();
    if (!val) return;
    
    // Validate Regex: Chỉ cho phép định dạng "Spring 2026", "Summer 2026", "Fall 2026"
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
        showToast("Kỳ học này đã tồn tại trong hệ thống!", "warning");
        return;
    }
    
    globalConfig.available_semesters.push(val);
    globalConfig.available_semesters = sortSemestersList(globalConfig.available_semesters);
    
    if (globalConfig.available_semesters.length === 1) {
        globalConfig.current_semester = val;
    }
    
    await SemesterService.saveGlobalConfig(globalConfig.available_semesters, globalConfig.current_semester);
    showToast(`Đã thêm kỳ học mới: ${val}`, "success");
    input.value = "";
    renderTable();
}

window.handleSetCurrent = async function(semester) {
    if (confirm(`Bạn muốn thiết lập [${semester}] làm kỳ học hiện tại của hệ thống?`)) {
        globalConfig.current_semester = semester;
        await SemesterService.saveGlobalConfig(globalConfig.available_semesters, globalConfig.current_semester);
        showToast(`Đã đổi kỳ hiện tại sang: ${semester}`, "success");
        renderTable();
    }
};

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
        
        if (globalConfig.current_semester === semester) {
            globalConfig.current_semester = globalConfig.available_semesters.length > 0 ? globalConfig.available_semesters[0] : "";
        }
        
        await SemesterService.saveGlobalConfig(globalConfig.available_semesters, globalConfig.current_semester);
        showToast(`Đã xóa kỳ học: ${semester}`, "success");
        renderTable();
        
    } catch (e) {
        console.error("Lỗi khi kiểm tra dữ liệu", e);
        showToast("Có lỗi xảy ra khi xóa kỳ học: " + e.message, "error");
    }
};
