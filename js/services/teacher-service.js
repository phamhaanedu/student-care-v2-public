// client/js/services/teacher-service.js - Quản lý Danh mục Giảng viên (Teachers Collection) có Multi-Tier Caching

import { db, doc, getDoc, getDocs, setDoc, writeBatch, collection } from '../firebase-init.js';
import { StorageCache } from '../utils/storage-cache.js';

export class TeacherService {
    static _teachersCache = new Map(); // teacherId -> teacherData
    static _isLoaded = false;
    static CACHE_KEY = 'teachers_list';

    /**
     * Tải toàn bộ danh mục Giảng viên với chiến lược Multi-Tier Caching:
     * 1. RAM Cache -> 2. LocalStorage Cache (6 tiếng) -> 3. Firestore Query
     * @param {boolean} forceRefresh
     * @returns {Promise<Map<string, Object>>}
     */
    static async getTeachersMap(forceRefresh = false) {
        if (this._isLoaded && !forceRefresh) {
            return this._teachersCache;
        }

        // 1. Thử đọc từ LocalStorage
        if (!forceRefresh) {
            const cachedArray = StorageCache.getLocal(this.CACHE_KEY);
            if (Array.isArray(cachedArray) && cachedArray.length > 0) {
                this._teachersCache.clear();
                cachedArray.forEach(item => {
                    this._teachersCache.set(item.id || item.teacher_id, item);
                });
                this._isLoaded = true;
                return this._teachersCache;
            }
        }

        // 2. Đọc từ Firestore nếu chưa có cache hoặc bị forceRefresh
        try {
            const snap = await getDocs(collection(db, "Teachers"));
            this._teachersCache.clear();
            const listToStore = [];

            snap.forEach(d => {
                const item = { id: d.id, ...d.data() };
                this._teachersCache.set(d.id, item);
                listToStore.push(item);
            });

            // Lưu vào LocalStorage (TTL 6 tiếng)
            StorageCache.setLocal(this.CACHE_KEY, listToStore);
            this._isLoaded = true;
        } catch (error) {
            console.error("Lỗi khi tải danh mục Teachers:", error);
        }

        return this._teachersCache;
    }

    /**
     * Lấy thông tin 1 giảng viên từ cache hoặc CSDL
     */
    static getTeacherFromCache(teacherId) {
        return this._teachersCache.get(teacherId) || null;
    }

    /**
     * Lưu hoặc cập nhật 1 giảng viên
     */
    static async saveTeacher(teacherId, data) {
        await setDoc(doc(db, "Teachers", teacherId), data, { merge: true });
        const updatedItem = { id: teacherId, ...data };
        this._teachersCache.set(teacherId, updatedItem);

        // Cập nhật lại LocalStorage
        StorageCache.setLocal(this.CACHE_KEY, Array.from(this._teachersCache.values()));
    }

    /**
     * Cập nhật hàng loạt giảng viên (Batch Write)
     */
    static async batchSaveTeachers(teachersList) {
        if (!Array.isArray(teachersList) || teachersList.length === 0) return;

        const CHUNK_SIZE = 450;
        for (let i = 0; i < teachersList.length; i += CHUNK_SIZE) {
            const chunk = teachersList.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach(t => {
                const tRef = doc(db, "Teachers", t.id || t.teacher_id);
                batch.set(tRef, t, { merge: true });
            });

            await batch.commit();
        }

        // Cập nhật lại cache
        teachersList.forEach(t => {
            const id = t.id || t.teacher_id;
            this._teachersCache.set(id, t);
        });

        StorageCache.setLocal(this.CACHE_KEY, Array.from(this._teachersCache.values()));
    }
}
