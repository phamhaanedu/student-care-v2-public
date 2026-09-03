// client/js/services/student-service.js - Quản lý Hồ sơ Sinh viên (Students Collection & Remarks) có Multi-Tier Caching

import { db, doc, getDoc, setDoc, updateDoc, writeBatch, collection, query, where, getDocs } from '../firebase-init.js';
import { StorageCache } from '../utils/storage-cache.js';

export class StudentService {
    /**
     * Lấy hồ sơ nợ môn và sổ nhận xét của sinh viên từ Students collection (có Session Caching)
     * @param {string} studentId
     * @param {boolean} forceRefresh
     * @returns {Promise<Object|null>}
     */
    static async getStudentProfile(studentId, forceRefresh = false) {
        if (!studentId) return null;

        // 1. Thử đọc từ SessionStorage Cache
        const cacheKey = `student_${studentId}`;
        if (!forceRefresh) {
            const cached = StorageCache.getSession(cacheKey);
            if (cached) return cached;
        }

        // 2. Đọc từ Firestore
        try {
            const studentDoc = await getDoc(doc(db, "Students", studentId));
            if (studentDoc.exists()) {
                const data = { id: studentDoc.id, ...studentDoc.data() };
                StorageCache.setSession(cacheKey, data);
                return data;
            }
        } catch (error) {
            console.error(`Lỗi khi tải hồ sơ sinh viên ${studentId}:`, error);
        }
        return null;
    }

    /**
     * Bổ sung Số điện thoại mới vào hồ sơ sinh viên (Ưu tiên số thêm sau cùng)
     * Đồng thời cập nhật trường phone trong Students và tất cả các AcademicRecords liên quan
     * @param {string} studentId
     * @param {string} newPhone
     * @param {string} currentSemester
     */
    static async addNewPhoneNumber(studentId, newPhone, currentSemester = '') {
        const cleanPhone = newPhone.trim();
        if (!cleanPhone) throw new Error("Số điện thoại không được để trống.");

        // 1. Đọc hồ sơ sinh viên
        const studentDocRef = doc(db, "Students", studentId);
        const studentSnap = await getDoc(studentDocRef);
        let phoneNumbers = [];
        let existingData = {};

        if (studentSnap.exists()) {
            existingData = studentSnap.data();
            phoneNumbers = Array.isArray(existingData.phone_numbers) ? [...existingData.phone_numbers] : [];
            if (existingData.phone && !phoneNumbers.includes(existingData.phone)) {
                phoneNumbers.unshift(existingData.phone);
            }
        }

        // Bổ sung số mới vào đầu danh sách nếu chưa có
        if (!phoneNumbers.includes(cleanPhone)) {
            phoneNumbers.unshift(cleanPhone);
        }

        const updateData = {
            ...existingData,
            id: studentId,
            phone: cleanPhone,
            phone_numbers: phoneNumbers,
            updated_at: new Date().toISOString()
        };

        // 2. Ghi cập nhật vào Students doc
        await setDoc(studentDocRef, {
            phone: cleanPhone,
            phone_numbers: phoneNumbers,
            updated_at: updateData.updated_at
        }, { merge: true });

        // Cập nhật ngay vào SessionStorage Cache (Write-through)
        StorageCache.setSession(`student_${studentId}`, updateData);

        // 3. Cập nhật phone vào các AcademicRecords của sinh viên này trong kỳ hiện tại
        if (currentSemester) {
            try {
                const q = query(
                    collection(db, "AcademicRecords"),
                    where("student_id", "==", studentId),
                    where("semester", "==", currentSemester)
                );
                const recordsSnap = await getDocs(q);
                if (!recordsSnap.empty) {
                    const batch = writeBatch(db);
                    recordsSnap.forEach(rDoc => {
                        batch.update(rDoc.ref, { phone: cleanPhone });
                    });
                    await batch.commit();
                }
            } catch (err) {
                console.warn("Cảnh báo cập nhật phone trên AcademicRecords:", err);
            }
        }

        return {
            phone: cleanPhone,
            phone_numbers: phoneNumbers
        };
    }

    /**
     * Thêm nhận xét tích lũy dùng chung của GV đứng lớp vào Students collection
     * @param {string} studentId
     * @param {{teacher_id: string, course_code: string, note: string, created_at?: string}} remarkObj
     */
    static async addInstructorRemark(studentId, remarkObj) {
        if (!studentId || !remarkObj || !remarkObj.note) {
            throw new Error("Thông tin nhận xét không hợp lệ.");
        }

        const studentDocRef = doc(db, "Students", studentId);
        const studentSnap = await getDoc(studentDocRef);
        let remarks = [];
        let existingData = {};

        if (studentSnap.exists()) {
            existingData = studentSnap.data();
            remarks = Array.isArray(existingData.instructor_remarks) ? [...existingData.instructor_remarks] : [];
        }

        const newEntry = {
            teacher_id: remarkObj.teacher_id || 'GV',
            course_code: remarkObj.course_code || 'Chưa rõ',
            note: remarkObj.note.trim(),
            created_at: remarkObj.created_at || new Date().toISOString()
        };

        remarks.unshift(newEntry);

        const updateData = {
            ...existingData,
            id: studentId,
            instructor_remarks: remarks,
            updated_at: new Date().toISOString()
        };

        await setDoc(studentDocRef, {
            instructor_remarks: remarks,
            updated_at: updateData.updated_at
        }, { merge: true });

        // Cập nhật SessionStorage Cache (Write-through)
        StorageCache.setSession(`student_${studentId}`, updateData);

        return remarks;
    }

    /**
     * Tải và tổng hợp bản đồ nợ môn (Debt Summary Map) cho danh sách sinh viên trong kỳ hiện tại
     * Áp dụng Multi-Tier Caching (SessionStorage + RAM) để đạt 0 Firestore Read khi đổi bộ lọc
     * @param {string[]} studentIds Danh sách MSSV duy nhất của kỳ
     * @param {string} currentSemester Kỳ học hiện tại (ví dụ: 'Fall 2026')
     * @param {string} previousSemester Kỳ học liền kề trước (ví dụ: 'Summer 2026')
     * @param {boolean} forceRefresh
     * @returns {Promise<Map<string, Object>>} Map<studentId, { debt_count, debts_list, has_recent_debt, recent_debts_list, raw_debts } >
     */
    static async getStudentsDebtSummaryMap(studentIds = [], currentSemester = '', previousSemester = '', forceRefresh = false) {
        const resultMap = new Map();
        if (!Array.isArray(studentIds) || studentIds.length === 0) return resultMap;

        const cleanIds = Array.from(new Set(studentIds.map(id => (id || '').trim()).filter(Boolean)));
        const cacheKey = `debts_summary_${currentSemester || 'default'}`;

        // 1. Thử đọc từ SessionStorage Cache
        let cachedSummary = null;
        if (!forceRefresh) {
            cachedSummary = StorageCache.getSession(cacheKey);
            if (cachedSummary && typeof cachedSummary === 'object') {
                cleanIds.forEach(sId => {
                    if (cachedSummary[sId]) {
                        resultMap.set(sId, cachedSummary[sId]);
                    }
                });
            }
        }

        // 2. Lọc các sinh viên chưa có trong cache
        const missingIds = cleanIds.filter(sId => !resultMap.has(sId));

        if (missingIds.length > 0) {
            // Tải song song hồ sơ của các sinh viên thiếu
            const fetchPromises = missingIds.map(async (sId) => {
                try {
                    // Kiểm tra cache lẻ trước
                    let studentData = StorageCache.getSession(`student_${sId}`);
                    if (!studentData) {
                        const snap = await getDoc(doc(db, "Students", sId));
                        if (snap.exists()) {
                            studentData = { id: snap.id, ...snap.data() };
                            StorageCache.setSession(`student_${sId}`, studentData);
                        }
                    }

                    if (studentData) {
                        const rawDebts = Array.isArray(studentData.current_debts) ? studentData.current_debts : [];
                        const debtsList = [];
                        const recentDebtsList = [];
                        let hasRecentDebt = false;

                        rawDebts.forEach(d => {
                            const code = typeof d === 'string' ? d.trim() : (d.course_code || d.subject_code || '').trim();
                            const term = typeof d === 'object' ? (d.semester || d.term || '') : '';
                            
                            if (code) {
                                const upperCode = code.toUpperCase();
                                if (!debtsList.includes(upperCode)) debtsList.push(upperCode);
                                
                                if (previousSemester && term && term.toLowerCase().trim() === previousSemester.toLowerCase().trim()) {
                                    hasRecentDebt = true;
                                    if (!recentDebtsList.includes(upperCode)) recentDebtsList.push(upperCode);
                                }
                            }
                        });

                        // Kiểm tra thêm transcript_terms nếu có môn bị Failed ở kỳ trước
                        if (!hasRecentDebt && previousSemester && studentData.transcript_terms && typeof studentData.transcript_terms === 'object') {
                            const prevTermCourses = studentData.transcript_terms[previousSemester] || [];
                            if (Array.isArray(prevTermCourses)) {
                                prevTermCourses.forEach(c => {
                                    if (c.status === 'Failed' || c.grade === 'F' || c.is_debt) {
                                        hasRecentDebt = true;
                                        const cCode = (c.course_code || c.subject_code || '').toUpperCase().trim();
                                        if (cCode && !recentDebtsList.includes(cCode)) recentDebtsList.push(cCode);
                                    }
                                });
                            }
                        }

                        const summaryItem = {
                            student_id: sId,
                            debt_count: debtsList.length,
                            debts_list: debtsList,
                            has_recent_debt: hasRecentDebt,
                            recent_debts_list: recentDebtsList,
                            raw_debts: rawDebts
                        };

                        resultMap.set(sId, summaryItem);
                    } else {
                        // Không có hồ sơ Students (mặc định 0 nợ)
                        resultMap.set(sId, {
                            student_id: sId,
                            debt_count: 0,
                            debts_list: [],
                            has_recent_debt: false,
                            recent_debts_list: [],
                            raw_debts: []
                        });
                    }
                } catch (err) {
                    console.warn(`Lỗi lấy hồ sơ nợ môn của SV ${sId}:`, err);
                    resultMap.set(sId, {
                        student_id: sId,
                        debt_count: 0,
                        debts_list: [],
                        has_recent_debt: false,
                        recent_debts_list: [],
                        raw_debts: []
                    });
                }
            });

            await Promise.allSettled(fetchPromises);

            // Lưu toàn bộ summary vào SessionStorage
            const newCacheObj = cachedSummary && typeof cachedSummary === 'object' ? { ...cachedSummary } : {};
            resultMap.forEach((val, key) => {
                newCacheObj[key] = val;
            });
            StorageCache.setSession(cacheKey, newCacheObj);
        }

        return resultMap;
    }
}

