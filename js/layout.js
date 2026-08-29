import { checkAuth, logout } from './auth.js';

document.addEventListener('DOMContentLoaded', async () => {
    try {
        const session = await checkAuth();
        renderLayout(session);
    } catch (error) {
        console.log("Not authenticated", error);
        // auth.js already redirects to login.html
    }
});

function renderLayout(session) {
    const role = session.role;
    
    // 1. Render Sidebar
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        let menuHtml = `
            <div class="sidebar-header">
                <span>Student Care</span>
                <button class="btn-toggle-sidebar" id="btnToggleSidebar">≡</button>
            </div>
            <div class="sidebar-nav">
                <a href="index.html" class="nav-item ${isActive('index.html')}">
                    <span class="nav-icon">🏠</span>
                    <span class="nav-text">Tổng quan (Nhiệm vụ)</span>
                </a>
        `;

        if (role === 'Admin' || role === 'Super Admin') {
            menuHtml += `
                <a href="list-teachers.html" class="nav-item ${isActive('list-teachers.html')}">
                    <span class="nav-icon">👨‍🏫</span>
                    <span class="nav-text">Quản lý Giảng viên</span>
                </a>
                <a href="list-subjects.html" class="nav-item ${isActive('list-subjects.html')}">
                    <span class="nav-icon">📖</span>
                    <span class="nav-text">Quản lý Môn học</span>
                </a>
                <a href="report.html" class="nav-item ${isActive('report.html')}">
                    <span class="nav-icon">📊</span>
                    <span class="nav-text">Báo cáo</span>
                </a>
            `;
        }

        if (role === 'Super Admin') {
            menuHtml += `
                <a href="assign.html" class="nav-item ${isActive('assign.html')}">
                    <span class="nav-icon">🎯</span>
                    <span class="nav-text">Phân công</span>
                </a>
                <a href="list-semesters.html" class="nav-item ${isActive('list-semesters.html')}">
                    <span class="nav-icon">⚙️</span>
                    <span class="nav-text">Cấu hình Hệ thống</span>
                </a>
            `;
        }

        menuHtml += `</div>`;
        sidebar.innerHTML = menuHtml;
        
        // Toggle Logic
        const btnToggle = document.getElementById('btnToggleSidebar');
        btnToggle.addEventListener('click', () => {
            sidebar.classList.toggle('collapsed');
            localStorage.setItem('sidebar_collapsed', sidebar.classList.contains('collapsed'));
        });
        
        // Restore state
        if (localStorage.getItem('sidebar_collapsed') === 'true') {
            sidebar.classList.add('collapsed');
        }
    }

    // 2. Render Header
    const header = document.getElementById('header');
    if (header) {
        header.innerHTML = `
            <div class="header-title" style="font-weight: 600; font-size: 1.1rem; color: var(--text-primary);"></div>
            <div class="user-info" style="display: flex; align-items: center; gap: 15px;">
                <div style="text-align: right;">
                    <strong style="display: block; font-size: 0.9rem; color: var(--text-primary);">${session.name || session.email}</strong>
                    <span class="badge badge-success" style="font-size: 0.7rem;">${role}</span>
                </div>
                <button id="btnLogout" class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8rem; background-color: #f63c6b;">Đăng xuất</button>
            </div>
        `;
        
        document.getElementById('btnLogout').addEventListener('click', logout);
    }
}

function isActive(path) {
    // If the path is empty, default to index.html
    const currentPath = window.location.pathname;
    if (currentPath.endsWith('/') && path === 'index.html') return 'active';
    return currentPath.endsWith(path) ? 'active' : '';
}
