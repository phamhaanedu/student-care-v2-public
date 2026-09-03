// client/js/services/semester-service.js - Quản lý Cấu hình Kỳ học (Configuration/Global) có Multi-Tier Caching

import { db, doc, getDoc, setDoc } from '../firebase-init.js';
import { sortSemestersList } from '../utils/date-helpers.js';
import { StorageCache } from '../utils/storage-cache.js';

export class SemesterService {
    static _cache = null;
    static CACHE_KEY = 'semesters_config';

    /**
     * Lấy cấu hình Global Semesters với Multi-Tier Caching (LocalStorage TTL 6h)
     * @param {boolean} forceRefresh
     * @returns {Promise<{available_semesters: string[], current_semester: string, sorted_semesters: string[]}>}
     */
    static async getGlobalConfig(forceRefresh = false) {
        if (this._cache && !forceRefresh) {
            return this._cache;
        }

        // 1. Thử đọc từ LocalStorage
        if (!forceRefresh) {
            const cached = StorageCache.getLocal(this.CACHE_KEY);
            if (cached && Array.isArray(cached.available_semesters)) {
                this._cache = cached;
                return this._cache;
            }
        }

        // 2. Đọc từ Firestore
        try {
            const configDoc = await getDoc(doc(db, "Configuration", "Global"));
            if (configDoc.exists()) {
                const data = configDoc.data();
                const available = data.available_semesters || [];
                const sorted = sortSemestersList(available);
                const current = data.current_semester || sorted[0] || '';

                this._cache = {
                    available_semesters: available,
                    current_semester: current,
                    sorted_semesters: sorted
                };

                // Lưu vào LocalStorage
                StorageCache.setLocal(this.CACHE_KEY, this._cache);
                return this._cache;
            }
        } catch (error) {
            console.error("Lỗi khi đọc Configuration/Global:", error);
        }

        return {
            available_semesters: [],
            current_semester: '',
            sorted_semesters: []
        };
    }

    /**
     * Lưu cấu hình kỳ học mới
     * @param {string[]} availableSemesters
     * @param {string} currentSemester
     */
    static async saveGlobalConfig(availableSemesters, currentSemester) {
        const sorted = sortSemestersList(availableSemesters);
        const data = {
            available_semesters: sorted,
            current_semester: currentSemester
        };

        await setDoc(doc(db, "Configuration", "Global"), data);
        this._cache = {
            available_semesters: sorted,
            current_semester: currentSemester,
            sorted_semesters: sorted
        };

        StorageCache.setLocal(this.CACHE_KEY, this._cache);
        return this._cache;
    }
}
