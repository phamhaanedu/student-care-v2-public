// client/js/services/subject-service.js - Quản lý Danh mục Môn học (Subjects Collection) có Multi-Tier Caching

import { db, doc, getDoc, getDocs, setDoc, writeBatch, collection } from '../firebase-init.js';
import { StorageCache } from '../utils/storage-cache.js';

export class SubjectService {
    static _subjectsCache = new Map(); // subjectId -> subjectData
    static _isLoaded = false;
    static CACHE_KEY = 'subjects_list';

    /**
     * Tải toàn bộ danh mục Subjects với chiến lược Multi-Tier Caching:
     * 1. RAM Cache -> 2. LocalStorage Cache (6 tiếng) -> 3. Firestore Query
     * @param {boolean} forceRefresh
     * @returns {Promise<Map<string, Object>>}
     */
    static async getSubjectsMap(forceRefresh = false) {
        if (this._isLoaded && !forceRefresh) {
            return this._subjectsCache;
        }

        // 1. Thử đọc từ LocalStorage
        if (!forceRefresh) {
            const cachedArray = StorageCache.getLocal(this.CACHE_KEY);
            if (Array.isArray(cachedArray) && cachedArray.length > 0) {
                this._subjectsCache.clear();
                cachedArray.forEach(item => {
                    this._subjectsCache.set(item.id || item.course_code, item);
                });
                this._isLoaded = true;
                return this._subjectsCache;
            }
        }

        // 2. Đọc từ Firestore nếu chưa có cache hoặc bị forceRefresh
        try {
            const snap = await getDocs(collection(db, "Subjects"));
            this._subjectsCache.clear();
            const listToStore = [];

            snap.forEach(d => {
                const item = { id: d.id, ...d.data() };
                this._subjectsCache.set(d.id, item);
                listToStore.push(item);
            });

            // Lưu vào LocalStorage (TTL 6 tiếng)
            StorageCache.setLocal(this.CACHE_KEY, listToStore);
            this._isLoaded = true;
        } catch (error) {
            console.error("Lỗi khi tải danh mục Subjects:", error);
        }

        return this._subjectsCache;
    }

    /**
     * Tra cứu thông tin môn học thông minh (hỗ trợ không phân biệt hoa thường, mã môn có ngoặc hoặc không ngoặc)
     * @param {string} courseCode
     * @returns {Object|null}
     */
    static findSubjectData(courseCode) {
        if (!courseCode) return null;
        const cleanCode = courseCode.toString().trim().toUpperCase();

        // 1. Tìm chính xác theo key (hoa/thường)
        if (this._subjectsCache.has(cleanCode)) {
            return this._subjectsCache.get(cleanCode);
        }

        // 2. Tìm duyệt cache theo mã môn gốc (trước ngoặc hoặc trong ngoặc)
        const rawCode = cleanCode.split(' ')[0].split('(')[0].trim();
        for (const [key, val] of this._subjectsCache.entries()) {
            const cleanKey = key.toString().trim().toUpperCase();
            const rawKey = cleanKey.split(' ')[0].split('(')[0].trim();
            const docId = (val.id || val.docId || '').toString().trim().toUpperCase();
            const rawDocId = docId.split(' ')[0].split('(')[0].trim();

            if (cleanKey === cleanCode || rawKey === rawCode || rawDocId === rawCode || cleanKey.startsWith(rawCode) || cleanCode.startsWith(rawKey)) {
                return val;
            }
        }

        return null;
    }


    /**
     * Thêm mới hoặc cập nhật một môn học
     */
    static async saveSubject(subjectId, data) {
        await setDoc(doc(db, "Subjects", subjectId), data, { merge: true });
        const updatedItem = { id: subjectId, ...data };
        this._subjectsCache.set(subjectId, updatedItem);

        // Cập nhật lại LocalStorage
        const currentList = Array.from(this._subjectsCache.values());
        StorageCache.setLocal(this.CACHE_KEY, currentList);
    }

    /**
     * Thêm hàng loạt môn học vào danh mục (Batch Write)
     */
    static async batchSaveSubjects(subjectsList) {
        if (!Array.isArray(subjectsList) || subjectsList.length === 0) return;

        const CHUNK_SIZE = 450;
        for (let i = 0; i < subjectsList.length; i += CHUNK_SIZE) {
            const chunk = subjectsList.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach(sub => {
                const subRef = doc(db, "Subjects", sub.id || sub.course_code);
                batch.set(subRef, sub, { merge: true });
            });

            await batch.commit();
        }

        // Cập nhật lại cache RAM và LocalStorage
        subjectsList.forEach(sub => {
            const id = sub.id || sub.course_code;
            this._subjectsCache.set(id, sub);
        });

        StorageCache.setLocal(this.CACHE_KEY, Array.from(this._subjectsCache.values()));
    }
}
