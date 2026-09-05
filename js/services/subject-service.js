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
     * Chuẩn hóa mã môn học theo định dạng FAP: MÃ_CTĐT (MÃ_GỐC) hoặc MÃ (MÃ)
     * @param {string} rawCode
     * @returns {string}
     */
    static standardizeCourseCode(rawCode) {
        if (!rawCode) return '';
        const clean = rawCode.toString().trim().toUpperCase();
        if (clean.includes('(') && clean.includes(')')) {
            return clean;
        }

        // Bảng ánh xạ các mã môn 4 số sang mã gốc 3 số
        const match4 = clean.match(/^([A-Z]{3})(\d{3})(\d)$/);
        if (match4) {
            return `${clean} (${match4[1]}${match4[2]})`;
        }

        return `${clean} (${clean})`;
    }

    /**
     * Tra cứu thông tin môn học thông minh 2 chiều:
     * Hỗ trợ tìm theo mã FAP đầy đủ 'WEB2055 (WEB205)', mã CTĐT 'WEB2055', hoặc mã gốc trong transcript 'WEB205'
     * @param {string} courseCode
     * @returns {Object|null}
     */
    static findSubjectData(courseCode) {
        if (!courseCode) return null;
        const cleanCode = courseCode.toString().trim().toUpperCase();

        // 1. Khớp chính xác tuyệt đối theo key trong Map
        if (this._subjectsCache.has(cleanCode)) {
            return this._subjectsCache.get(cleanCode);
        }

        // 2. Trích xuất mã chính (trước ngoặc) và mã gốc (trong ngoặc) của đầu vào
        const inputMain = cleanCode.split(' ')[0].split('(')[0].trim();
        const inputMatch = cleanCode.match(/\(([^)]+)\)/);
        const inputParen = inputMatch ? inputMatch[1].trim() : '';

        // 3. Quét duyệt cache với độ ưu tiên cao dần
        let fallbackMatch = null;

        for (const [key, val] of this._subjectsCache.entries()) {
            const cleanKey = key.toString().trim().toUpperCase();
            if (cleanKey === cleanCode) return val;

            const keyMain = cleanKey.split(' ')[0].split('(')[0].trim();
            const keyMatch = cleanKey.match(/\(([^)]+)\)/);
            const keyParen = keyMatch ? keyMatch[1].trim() : '';

            // Khớp theo mã gốc trong ngoặc (Ví dụ: nợ môn "WEB205" khớp với "WEB2055 (WEB205)")
            if (keyParen && (keyParen === cleanCode || keyParen === inputMain || (inputParen && keyParen === inputParen))) {
                return val;
            }

            // Khớp theo mã trước ngoặc (Ví dụ: "WEB2055" khớp với "WEB2055 (WEB205)")
            if (keyMain === cleanCode || keyMain === inputMain) {
                return val;
            }

            // Khớp khi đầu vào có ngoặc trỏ tới mã chính
            if (inputParen && (inputParen === keyMain || inputParen === keyParen)) {
                return val;
            }

            // Fallback: Tiền tố bắt đầu giống nhau
            if (!fallbackMatch && (keyMain.startsWith(inputMain) || inputMain.startsWith(keyMain))) {
                fallbackMatch = val;
            }
        }

        return fallbackMatch;
    }


    /**
     * Thêm mới hoặc cập nhật một môn học
     */
    static async saveSubject(subjectId, data) {
        const finalId = this.standardizeCourseCode(subjectId);
        await setDoc(doc(db, "Subjects", finalId), data, { merge: true });
        const updatedItem = { id: finalId, ...data };
        this._subjectsCache.set(finalId, updatedItem);

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
                const finalId = this.standardizeCourseCode(sub.id || sub.course_code);
                const subRef = doc(db, "Subjects", finalId);
                batch.set(subRef, sub, { merge: true });
            });

            await batch.commit();
        }

        // Cập nhật lại cache RAM và LocalStorage
        subjectsList.forEach(sub => {
            const finalId = this.standardizeCourseCode(sub.id || sub.course_code);
            this._subjectsCache.set(finalId, { ...sub, id: finalId });
        });

        StorageCache.setLocal(this.CACHE_KEY, Array.from(this._subjectsCache.values()));
    }
}
