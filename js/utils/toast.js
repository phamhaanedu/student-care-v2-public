// client/js/utils/toast.js - Quản lý Toast Notification Singleton dùng chung

/**
 * Hiển thị thông báo Toast nổi trên màn hình
 * @param {string} message Nội dung thông báo
 * @param {'success'|'error'|'warning'|'info'} type Loại thông báo
 * @param {number} duration Thời gian hiển thị (ms), mặc định 3200ms
 */
export function showToast(message, type = 'success', duration = 3200) {
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    // Icon tương ứng
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-msg">${message}</span>
    `;

    container.appendChild(toast);

    // Tự động ẩn và xóa khỏi DOM
    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        setTimeout(() => {
            if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
    }, duration);
}

// Gắn vào window để hỗ trợ inline HTML onclick handlers
if (typeof window !== 'undefined') {
    window.showToast = showToast;
}

