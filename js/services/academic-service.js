// client/js/services/academic-service.js - Quản lý Ca Chăm Sóc & Điểm Danh (AcademicRecords & CareLogs) có Multi-Tier Caching

import { db, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, collection, query, where, Timestamp } from '../firebase-init.js';
import { StorageCache } from '../utils/storage-cache.js';

export class AcademicService {
    /**
     * Tự động xác định trạng thái lớp học theo thời gian thực (Real-time Dynamic Status):
     * - Nếu hôm nay < start_date: 'Upcoming' (Chưa học/Sắp tới)
     * - Nếu hôm nay > end_date: 'Completed' (Đã hoàn thành)
     * - Nếu start_date <= hôm nay <= end_date: 'Ongoing' (Đang học)
     * @param {Object} data
     * @returns {string} 'Upcoming' | 'Ongoing' | 'Completed'
     */
    static resolveClassStatus(data) {
        if (!data) return 'Ongoing';
        if (data.start_date && data.end_date) {
            const today = new Date().toISOString().split('T')[0];
            if (today < data.start_date) return 'Upcoming';
            if (today > data.end_date) return 'Completed';
            return 'Ongoing';
        }
        return data.class_status || 'Ongoing';
    }

    /**
     * Tải toàn bộ AcademicRecords của một kỳ học (có Session Caching)
     * @param {string} semester
     * @param {string} currentTeacherId Mã GV của user đang đăng nhập để xác định is_assigned / is_teaching
     * @param {boolean} forceRefresh
     * @returns {Promise<Array<Object>>}
     */
    static async getRecordsBySemester(semester, currentTeacherId = '', forceRefresh = false) {
        if (!semester) return [];
        const tid = (currentTeacherId || '').toLowerCase().trim();
        const cacheKey = `records_all_${semester}_${tid}`;

        // 1. Đọc từ SessionStorage Cache
        if (!forceRefresh) {
            const cached = StorageCache.getSession(cacheKey);
            if (Array.isArray(cached) && cached.length > 0) {
                return cached;
            }
        }

        // 2. Đọc từ Firestore
        const q = query(
            collection(db, "AcademicRecords"),
            where("semester", "==", semester)
        );
        const snap = await getDocs(q);

        const list = snap.docs.map(d => {
            const data = d.data();
            const caregiver = (data.caregiver_id || '').toLowerCase().trim();
            const teacher = (data.teacher_id || '').toLowerCase().trim();
            const teacherList = Array.isArray(data.teacher_ids) 
                ? data.teacher_ids.map(t => (t || '').toLowerCase().trim()) 
                : [];

            const isAssigned = tid ? (caregiver === tid) : false;
            const isTeaching = tid ? ((teacher === tid) || teacherList.includes(tid)) : false;

            return {
                id: d.id,
                docId: d.id,
                ...data,
                is_assigned: isAssigned,
                is_teaching: isTeaching,
                block: data.block || 'Block 1',
                class_status: AcademicService.resolveClassStatus(data)
            };
        });

        // Lưu vào SessionStorage
        StorageCache.setSession(cacheKey, list);
        return list;
    }

    /**
     * Tải danh sách nhiệm vụ của Giảng viên (Dual Query: Ca được phân công + Ca đứng lớp) (có Session Caching)
     * @param {string} semester
     * @param {string} teacherId
     * @param {boolean} forceRefresh
     * @returns {Promise<Array<Object>>}
     */
    static async getTeacherTasks(semester, teacherId, forceRefresh = false) {
        if (!semester || !teacherId) return [];
        const tid = teacherId.trim();
        const tidLower = tid.toLowerCase();
        const cacheKey = `records_teacher_${semester}_${tidLower}`;

        // 1. Đọc từ SessionStorage Cache
        if (!forceRefresh) {
            const cached = StorageCache.getSession(cacheKey);
            if (Array.isArray(cached) && cached.length > 0) {
                return cached;
            }
        }

        // 2. Đọc từ Firestore
        const qAssigned = query(
            collection(db, "AcademicRecords"),
            where("semester", "==", semester),
            where("caregiver_id", "==", tid)
        );

        const qTeaching = query(
            collection(db, "AcademicRecords"),
            where("semester", "==", semester),
            where("teacher_id", "==", tid)
        );

        const qTeachingArray = query(
            collection(db, "AcademicRecords"),
            where("semester", "==", semester),
            where("teacher_ids", "array-contains", tid)
        );

        const [snapAssigned, snapTeaching, snapTeachingArray] = await Promise.all([
            getDocs(qAssigned),
            getDocs(qTeaching),
            getDocs(qTeachingArray)
        ]);

        const tasksMap = new Map();

        const processDoc = (docSnap, forceAssigned = false, forceTeaching = false) => {
            const data = docSnap.data();
            const id = docSnap.id;
            const caregiver = (data.caregiver_id || '').toLowerCase().trim();
            const teacher = (data.teacher_id || '').toLowerCase().trim();
            const teacherList = Array.isArray(data.teacher_ids) 
                ? data.teacher_ids.map(t => (t || '').toLowerCase().trim()) 
                : [];

            const isAssigned = forceAssigned || (caregiver === tidLower);
            const isTeaching = forceTeaching || (teacher === tidLower) || teacherList.includes(tidLower);

            if (tasksMap.has(id)) {
                const existing = tasksMap.get(id);
                if (isAssigned) existing.is_assigned = true;
                if (isTeaching) existing.is_teaching = true;
            } else {
                tasksMap.set(id, {
                    id: id,
                    docId: id,
                    ...data,
                    is_assigned: isAssigned,
                    is_teaching: isTeaching,
                    block: data.block || 'Block 1',
                    class_status: AcademicService.resolveClassStatus(data)
                });
            }
        };

        snapAssigned.forEach(d => processDoc(d, true, false));
        snapTeaching.forEach(d => processDoc(d, false, true));
        snapTeachingArray.forEach(d => processDoc(d, false, true));

        const list = Array.from(tasksMap.values());
        StorageCache.setSession(cacheKey, list);
        return list;
    }

    /**
     * Lưu kết quả chăm sóc sinh viên: Ghi đồng thời vào AcademicRecords và tạo mới CareLogs (Write-Through)
     * @param {string} recordId
     * @param {Object} updateFields (contact_status, care_status, notes, last_care_date, status, updated_at)
     * @param {Object} logData (student_id, academic_record_id, course_code, semester, caregiver_id, contact_status, care_status, notes, created_at)
     */
    static async saveCareResult(recordId, updateFields, logData) {
        // 1. Cập nhật AcademicRecords
        const recordRef = doc(db, "AcademicRecords", recordId);
        await updateDoc(recordRef, updateFields);

        // 2. Thêm vào CareLogs
        const logsRef = collection(db, "CareLogs");
        const logDocRef = doc(logsRef);
        await setDoc(logDocRef, logData);

        // 3. Cập nhật cache CareLogs cho sinh viên này
        const studentId = logData.student_id;
        if (studentId) {
            const careLogKey = `carelogs_${studentId}`;
            const existingLogs = StorageCache.getSession(careLogKey) || [];
            const newLogEntry = { id: logDocRef.id, ...logData };
            existingLogs.unshift(newLogEntry);
            StorageCache.setSession(careLogKey, existingLogs);
        }

        // 4. Xóa session cache AcademicRecords để các trang (Báo cáo, Dashboard) tự động tải dữ liệu mới nhất
        const semester = logData.semester;
        if (semester) {
            StorageCache.removeSessionMatching(`records_all_${semester}`);
            StorageCache.removeSessionMatching(`records_teacher_${semester}`);
        } else {
            StorageCache.removeSessionMatching('records_');
        }

        return {
            logId: logDocRef.id,
            ...logData
        };
    }


    /**
     * Tải CareLogs của sinh viên (có Session Caching)
     * @param {string} studentId
     * @param {boolean} forceRefresh
     */
    static async getStudentCareLogs(studentId, forceRefresh = false) {
        if (!studentId) return [];
        const cacheKey = `carelogs_${studentId}`;

        if (!forceRefresh) {
            const cached = StorageCache.getSession(cacheKey);
            if (Array.isArray(cached)) return cached;
        }

        try {
            const q = query(
                collection(db, "CareLogs"),
                where("student_id", "==", studentId)
            );
            const snap = await getDocs(q);
            const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
            
            // Sắp xếp thời gian mới nhất lên đầu
            logs.sort((a, b) => {
                const ta = a.created_at || '';
                const tb = b.created_at || '';
                return tb.localeCompare(ta);
            });

            StorageCache.setSession(cacheKey, logs);
            return logs;
        } catch (error) {
            console.error(`Lỗi khi tải CareLogs của ${studentId}:`, error);
            return [];
        }
    }

    /**
     * Lưu cấu hình vòng đời lớp học vào CSDL (Batch Write)
     * Cập nhật đồng thời bảng Classes và AcademicRecords
     */
    static async batchUpdateClassLifecycle(semester, classesList, allSemesterRecords) {
        const statusMap = new Map();
        classesList.forEach(c => {
            statusMap.set(c.key, { block: c.block, class_status: c.class_status });
        });

        // 1. Lọc các AcademicRecords cần cập nhật
        const recordsToUpdate = [];
        allSemesterRecords.forEach(r => {
            const cls = r.class_name || r.class_id || 'Chưa rõ lớp';
            const code = r.course_code || 'Chưa rõ môn';
            const key = `${cls}___${code}`;

            const newInfo = statusMap.get(key);
            if (newInfo && (r.class_status !== newInfo.class_status || r.block !== newInfo.block)) {
                r.class_status = newInfo.class_status;
                r.block = newInfo.block;
                recordsToUpdate.push({
                    docId: r.docId || r.id,
                    class_status: newInfo.class_status,
                    block: newInfo.block
                });
            }
        });

        // 2. Batch write AcademicRecords (chunk 450)
        if (recordsToUpdate.length > 0) {
            const CHUNK_SIZE = 450;
            for (let i = 0; i < recordsToUpdate.length; i += CHUNK_SIZE) {
                const chunk = recordsToUpdate.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);

                chunk.forEach(item => {
                    const docRef = doc(db, 'AcademicRecords', item.docId);
                    batch.set(docRef, {
                        class_status: item.class_status,
                        block: item.block,
                        updated_at: Timestamp.now()
                    }, { merge: true });
                });

                await batch.commit();
            }
        }

        // 3. Batch write bảng Classes
        const batchClasses = writeBatch(db);
        classesList.forEach(c => {
            const classDocId = `${semester}_${c.course_code}_${c.class_id || c.class_name}`;
            const classRef = doc(db, 'Classes', classDocId);
            batchClasses.set(classRef, {
                class_id: c.class_id || c.class_name,
                class_name: c.class_name,
                course_code: c.course_code,
                course_name: c.course_name,
                semester: semester,
                block: c.block,
                class_status: c.class_status,
                is_finished: (c.class_status === 'Completed'),
                updated_at: Timestamp.now()
            }, { merge: true });
        });
        await batchClasses.commit();

        // Xóa cache session của kỳ này để lần sau nạp lại dữ liệu mới nhất
        StorageCache.clearAll();

        return {
            updatedClassesCount: classesList.length,
            updatedRecordsCount: recordsToUpdate.length
        };
    }

    /**
     * Lưu phân công chăm sóc hàng loạt (Batch Write)
     */
    static async batchSaveAssignments(dirtyMap, allRecords) {
        if (!dirtyMap || dirtyMap.size === 0) return 0;

        const dirtyEntries = Array.from(dirtyMap.entries());
        const CHUNK_SIZE = 450;

        for (let i = 0; i < dirtyEntries.length; i += CHUNK_SIZE) {
            const chunk = dirtyEntries.slice(i, i + CHUNK_SIZE);
            const batch = writeBatch(db);

            chunk.forEach(([docId, newCaregiverId]) => {
                const docRef = doc(db, 'AcademicRecords', docId);
                const trimmedId = (newCaregiverId || '').trim();
                batch.set(docRef, {
                    caregiver_id: trimmedId,
                    status: trimmedId ? 'Assigned' : 'Unassigned',
                    updated_at: Timestamp.now()
                }, { merge: true });
            });

            await batch.commit();
        }

        // Cập nhật RAM
        dirtyEntries.forEach(([docId, newCaregiverId]) => {
            const target = allRecords.find(r => (r.docId === docId || r.id === docId));
            if (target) {
                target.caregiver_id = newCaregiverId.trim();
                target.status = target.caregiver_id ? 'Assigned' : 'Unassigned';
            }
        });

        // Xóa cache session sau khi phân công xong
        StorageCache.clearAll();

        return dirtyEntries.length;
    }
}
