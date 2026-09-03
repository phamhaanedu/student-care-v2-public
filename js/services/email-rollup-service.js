// client/js/services/email-rollup-service.js - Tổng hợp Dữ Liệu Học Kỳ & Gộp Nhiều Môn Học Cho Mỗi Sinh Viên

import { SubjectService } from './subject-service.js';

export class EmailRollupService {
    /**
     * Tổng hợp dữ liệu toàn diện của 1 sinh viên trong kỳ (Rollup đa môn)
     * @param {string} studentId
     * @param {Array<Object>} allSemesterRecords Danh sách toàn bộ AcademicRecords của kỳ hiện tại
     * @param {Map<string, Object>} subjectsCache
     * @param {Map<string, Object>} teachersCache
     * @returns {Object}
     */
    static aggregateStudentData(studentId, allSemesterRecords = [], subjectsCache = new Map(), teachersCache = new Map()) {
        if (!studentId) return null;
        const sIdClean = studentId.trim();
        const sIdLower = sIdClean.toLowerCase();

        // 1. Lọc tất cả các ca học của sinh viên này trong kỳ
        const studentRecords = allSemesterRecords.filter(r => 
            (r.student_id && r.student_id.toLowerCase().trim() === sIdLower)
        );

        if (studentRecords.length === 0) return null;

        const first = studentRecords[0];
        const studentName = first.name || 'Sinh viên';
        let studentEmail = (first.email || '').trim();
        if (!studentEmail || !studentEmail.includes('@')) {
            studentEmail = `${sIdLower}@fpt.edu.vn`;
        }
        const studentPhone = (first.phone || '').trim();
        const semester = first.semester || 'Current';

        // 2. Phân tích chi tiết từng môn học
        const courses = [];
        let maxAbsenceRatio = 0;
        let totalAbsencesAll = 0;
        const caregiversList = new Set();
        const teachersList = new Set();
        const academicRecordIds = [];

        studentRecords.forEach(r => {
            const courseCode = r.course_code || 'Chưa rõ môn';
            const subData = subjectsCache.get(courseCode) || SubjectService.findSubjectData(courseCode) || {};
            const courseName = subData.course_name || subData.name || r.course_name || courseCode;
            const maxAbs = Number(subData.max_absences) || 3;
            const absences = Number(r.total_absences) || 0;
            totalAbsencesAll += absences;

            const ratio = maxAbs > 0 ? (absences / maxAbs) : 0;
            if (ratio > maxAbsenceRatio) maxAbsenceRatio = ratio;

            const teachId = r.teacher_id || (Array.isArray(r.teacher_ids) && r.teacher_ids[0]) || '';
            const teachInfo = teachId ? (teachersCache.get(teachId) || teachersCache.get(teachId.toLowerCase()) || {}) : {};
            const teachName = teachInfo.full_name || teachInfo.name || teachId;
            const teachEmail = teachInfo.email || (teachId ? `${teachId.toLowerCase()}@fpt.edu.vn` : '');

            const careId = r.caregiver_id || '';
            const careInfo = careId ? (teachersCache.get(careId) || teachersCache.get(careId.toLowerCase()) || {}) : {};
            const careName = careInfo.full_name || careInfo.name || careId;
            const careEmail = careInfo.email || (careId ? `${careId.toLowerCase()}@fpt.edu.vn` : '');

            if (teachId) teachersList.add(teachName || teachId);
            if (careId) caregiversList.add(careName || careId);

            const docId = r.docId || r.id;
            if (docId) academicRecordIds.push(docId);

            // Đánh giá nhãn trạng thái môn
            let statusLabel = '🟢 Đi học đầy đủ';
            let riskLevel = 'safe';
            if (maxAbs > 0) {
                if (absences >= maxAbs) {
                    statusLabel = `🚨 Đã chạm ngưỡng cấm thi (${absences}/${maxAbs})`;
                    riskLevel = 'danger';
                } else if (absences >= maxAbs - 1 && absences > 0) {
                    statusLabel = `⚠️ Nguy cơ cấm thi cao (${absences}/${maxAbs})`;
                    riskLevel = 'warning';
                } else if (absences > 0) {
                    statusLabel = `🟡 Đã vắng ${absences}/${maxAbs} buổi`;
                    riskLevel = 'caution';
                }
            }

            courses.push({
                academic_record_id: docId,
                course_code: courseCode,
                course_name: courseName,
                class_name: r.class_name || r.class_id || '-',
                block: r.block || 'Block 1',
                class_status: r.class_status || 'Ongoing',
                total_absences: absences,
                max_absences: maxAbs,
                ratio: ratio,
                status_label: statusLabel,
                risk_level: riskLevel,
                teacher_id: teachId,
                teacher_name: teachName,
                teacher_email: teachEmail,
                caregiver_id: careId,
                caregiver_name: careName,
                caregiver_email: careEmail,
                last_email_sent_at: r.last_email_sent_at || null
            });
        });

        // Sắp xếp môn học: Môn vắng nhiều nhất lên đầu
        courses.sort((a, b) => b.total_absences - a.total_absences);

        // 3. Tự động gợi ý Mẫu Thư phù hợp nhất
        let recommendedTemplate = 'FRIENDLY_ATTENDANCE_REMINDER';
        if (studentRecords.some(r => r.has_prerequisite_debt)) {
            recommendedTemplate = 'PREREQUISITE_DEBT_WARNING';
        } else if (maxAbsenceRatio >= 0.66 || courses.some(c => c.risk_level === 'danger' || c.risk_level === 'warning')) {
            recommendedTemplate = 'CRITICAL_ATTENDANCE';
        } else if (courses.length > 1 && courses.filter(c => c.total_absences > 0).length === 1) {
            recommendedTemplate = 'LOCALIZED_SUBJECT_SUPPORT';
        }


        // 4. Xác định Reply-To email ưu tiên
        const primaryCaregiver = courses.find(c => c.caregiver_email)?.caregiver_email || '';
        const primaryTeacher = courses.find(c => c.teacher_email)?.teacher_email || '';
        const replyTo = primaryCaregiver || primaryTeacher || '';

        return {
            student_id: sIdClean,
            name: studentName,
            email: studentEmail,
            phone: studentPhone,
            semester: semester,
            courses: courses,
            academic_record_ids: academicRecordIds,
            total_absences_all: totalAbsencesAll,
            max_absence_ratio: maxAbsenceRatio,
            recommended_template: recommendedTemplate,
            reply_to: replyTo,
            teachers_summary: Array.from(teachersList).join(', '),
            caregivers_summary: Array.from(caregiversList).join(', ')
        };
    }

    /**
     * Nhóm danh sách các docId được tích chọn thành danh sách sinh viên duy nhất (Gộp đa môn)
     * @param {Array<string>} selectedDocIds Danh sách docId của các ca được tích chọn
     * @param {Array<Object>} allSemesterRecords Toàn bộ bản ghi kỳ hiện tại
     * @param {Map<string, Object>} subjectsCache
     * @param {Map<string, Object>} teachersCache
     * @returns {Array<Object>} Danh sách các payload sinh viên đã được gộp
     */
    static aggregateBulkSelection(selectedDocIds = [], allSemesterRecords = [], subjectsCache = new Map(), teachersCache = new Map()) {
        if (!Array.isArray(selectedDocIds) || selectedDocIds.length === 0) return [];

        const selectedSet = new Set(selectedDocIds);
        const targetedStudentIds = new Set();

        // 1. Tìm các student_id thuộc các docId được chọn
        allSemesterRecords.forEach(r => {
            const docId = r.docId || r.id;
            if (selectedSet.has(docId) && r.student_id) {
                targetedStudentIds.add(r.student_id.trim());
            }
        });

        // 2. Gộp toàn bộ môn của từng sinh viên này trong kỳ
        const aggregatedStudents = [];
        targetedStudentIds.forEach(sId => {
            const studentPayload = this.aggregateStudentData(sId, allSemesterRecords, subjectsCache, teachersCache);
            if (studentPayload) {
                aggregatedStudents.push(studentPayload);
            }
        });

        return aggregatedStudents;
    }
}
