// client/js/utils/storage-cache.js - Bộ Nhớ Đệm Đa Tầng (Multi-Tier Caching cho LocalStorage & SessionStorage)

export class StorageCache {
    static PREFIX = 'sc_cache_';
    static DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 tiếng mặc định cho dữ liệu tĩnh

    /**
     * Lấy dữ liệu từ localStorage kèm kiểm tra thời hạn sống (TTL)
     * @param {string} key
     * @param {number} ttlMs Thời gian sống tính bằng milliseconds
     * @returns {any|null}
     */
    static getLocal(key, ttlMs = this.DEFAULT_TTL_MS) {
        try {
            const raw = localStorage.getItem(this.PREFIX + key);
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.timestamp) return null;

            const now = Date.now();
            if (now - parsed.timestamp > ttlMs) {
                // Đã hết hạn TTL
                localStorage.removeItem(this.PREFIX + key);
                return null;
            }

            return parsed.data;
        } catch (e) {
            console.warn(`Lỗi khi đọc LocalStorage [${key}]:`, e);
            return null;
        }
    }

    /**
     * Lưu dữ liệu vào localStorage kèm timestamp
     * @param {string} key
     * @param {any} data
     */
    static setLocal(key, data) {
        try {
            const payload = {
                timestamp: Date.now(),
                data: data
            };
            localStorage.setItem(this.PREFIX + key, JSON.stringify(payload));
        } catch (e) {
            console.warn(`Lỗi khi ghi LocalStorage [${key}]:`, e);
        }
    }

    /**
     * Xóa một key trong localStorage
     * @param {string} key
     */
    static removeLocal(key) {
        try {
            localStorage.removeItem(this.PREFIX + key);
        } catch (e) {
            console.warn(`Lỗi khi xóa LocalStorage [${key}]:`, e);
        }
    }

    /**
     * Lấy dữ liệu từ sessionStorage (Phiên làm việc hiện tại)
     * @param {string} key
     * @returns {any|null}
     */
    static getSession(key) {
        try {
            const raw = sessionStorage.getItem(this.PREFIX + key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            console.warn(`Lỗi khi đọc SessionStorage [${key}]:`, e);
            return null;
        }
    }

    /**
     * Lưu dữ liệu vào sessionStorage
     * @param {string} key
     * @param {any} data
     */
    static setSession(key, data) {
        try {
            sessionStorage.setItem(this.PREFIX + key, JSON.stringify(data));
        } catch (e) {
            console.warn(`Lỗi khi ghi SessionStorage [${key}]:`, e);
        }
    }

    /**
     * Xóa một key trong sessionStorage
     * @param {string} key
     */
    static removeSession(key) {
        try {
            sessionStorage.removeItem(this.PREFIX + key);
        } catch (e) {
            console.warn(`Lỗi khi xóa SessionStorage [${key}]:`, e);
        }
    }

    /**
     * Xóa các key trong sessionStorage thỏa mãn chuỗi pattern
     * @param {string} pattern
     */
    static removeSessionMatching(pattern) {
        try {
            const keysToRemove = [];
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                if (k && k.startsWith(this.PREFIX) && k.includes(pattern)) {
                    keysToRemove.push(k);
                }
            }
            keysToRemove.forEach(k => sessionStorage.removeItem(k));
        } catch (e) {
            console.warn(`Lỗi khi xóa SessionStorage matching [${pattern}]:`, e);
        }
    }


    /**
     * Xóa toàn bộ cache của ứng dụng (dùng khi Đăng xuất hoặc bấm Làm mới sâu)
     */
    static clearAll() {
        try {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith(this.PREFIX)) localStorage.removeItem(k);
            });
            Object.keys(sessionStorage).forEach(k => {
                if (k.startsWith(this.PREFIX)) sessionStorage.removeItem(k);
            });
        } catch (e) {
            console.warn("Lỗi khi dọn dẹp toàn bộ cache:", e);
        }
    }
}
