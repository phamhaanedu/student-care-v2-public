// client/js/engines/health-bar-engine.js - Tính Toán Chỉ Số Sức Khỏe Học Vụ 2 Cấp Độ (Môn Hiện Tại & Toàn Khóa)

import { SubjectService } from '../services/subject-service.js';

export class HealthBarEngine {
    /**
     * Cấp Độ 1: Tính toán thanh máu Chuyên Cần của Môn Hiện Tại
     * @param {number} absences Số buổi vắng môn hiện tại
     * @param {number} maxAllowed Số buổi vắng tối đa cho phép
     */
    static calculateAttendanceHealth(absences, maxAllowed) {
        const abs = Number(absences) || 0;
        const max = Number(maxAllowed);
        
        // Trường hợp môn Đồ án / Thực tập / Môn không tính điểm danh (maxAllowed <= 0)
        if (isNaN(max) || max <= 0) {
            if (abs === 0) {
                return { label: 'An Toàn', class: 'health-good', percent: 100, isZeroMax: true };
            }
            return { label: 'Cần Lưu Ý', class: 'health-warning', percent: 50, isZeroMax: true };
        }

        // Trường hợp môn học có điểm danh thông thường
        if (abs >= max) {
            return { label: 'Báo Động (Cấm thi)', class: 'health-danger', percent: 100 };
        }
        if (abs >= Math.max(2, max - 1)) {
            const pct = Math.round((abs / max) * 100);
            return { label: 'Cảnh Báo', class: 'health-warning', percent: Math.max(40, pct) };
        }
        if (abs === 0) {
            return { label: 'An Toàn (0 vắng)', class: 'health-good', percent: 100 };
        }
        const pct = Math.round((abs / max) * 100);
        return { label: 'Tốt', class: 'health-good', percent: Math.max(25, pct) };
    }

    /**
     * Cấp Độ 2: Tính toán Chuyên Cần Tích Lũy Toàn Khóa & Tổng Hợp Toàn Kỳ (Cross-Subject Rollup)
     * @param {Object} studentData Dữ liệu Students/{studentId}
     * @param {Array<Object>} allTasks Mảng toàn bộ AcademicRecords của kỳ hiện tại trong RAM
     * @param {string} studentId Mã sinh viên
     * @param {Map<string, Object>} subjectsCache Cache danh mục môn học
     */
    static calculateLifetimeAttendanceHealth(studentData, allTasks, studentId, subjectsCache) {
        studentData = studentData || {};
        allTasks = Array.isArray(allTasks) ? allTasks : [];

        // 1. Quét các môn đang học song song trong kỳ hiện tại từ allTasks
        const semesterCourses = allTasks.filter(t => t.student_id === studentId);
        let totalSemesterAbsences = 0;
        let coursesWithAbsence = 0;
        let coursesInDanger = 0;

        const coursesRollup = semesterCourses.map(c => {
            const abs = Number(c.total_absences) || 0;
            const sub = SubjectService.findSubjectData(c.course_code) || (subjectsCache ? subjectsCache.get(c.course_code) : null);
            const max = sub && sub.max_absences !== undefined ? Number(sub.max_absences) : 3;
            
            totalSemesterAbsences += abs;
            if (abs > 0) coursesWithAbsence++;
            if (max > 0 && abs >= max) coursesInDanger++;

            return {
                id: c.id,
                course_code: c.course_code || 'Chưa rõ',
                class_name: c.class_name || c.class_id || '-',
                block: c.block || 'Block 1',
                absences: abs,
                max_absences: max,
                teacher_id: c.teacher_id || c.caregiver_id || '-'
            };
        });

        // 2. Phân tích lịch sử Bảng điểm Transcript (Toàn khóa)
        const debts = Array.isArray(studentData.current_debts) ? studentData.current_debts : [];
        const transcript = Array.isArray(studentData.academic_transcript) ? studentData.academic_transcript : [];
        
        let pastAttendanceFails = 0;
        transcript.forEach(t => {
            const note = (t.notes || t.status || t.grade || '').toLowerCase();
            if (note.includes('vắng') || note.includes('attendance') || note.includes('cấm thi')) {
                pastAttendanceFails++;
            }
        });

        // 3. Phân loại Chân Dung Sinh Viên (Persona Diagnostic)
        let personaType = 'GOOD_STUDENT';
        let personaTitle = '🌟 Sinh Viên Chăm Chỉ';
        let personaDesc = 'Lịch sử học tập tốt, chưa từng bị cấm thi vì điểm danh.';
        let score = 95;
        let label = 'Tích Cực';
        let colorClass = 'health-good';

        if (coursesInDanger > 0 || totalSemesterAbsences >= 6) {
            personaType = 'CHRONIC_ABSENCE';
            personaTitle = '🚨 Báo Động: Nguy Cơ Bỏ Học Toàn Diện';
            personaDesc = `Sinh viên đang vắng tổng cộng ${totalSemesterAbsences} buổi trên ${semesterCourses.length} môn kỳ này.`;
            score = 25;
            label = 'Báo Động';
            colorClass = 'health-danger';
        } else if (pastAttendanceFails > 0) {
            personaType = 'PAST_OFFENDER';
            personaTitle = '⚠️ Tiền Sử Cúp Học Mãn Tính';
            personaDesc = `Từng bị cấm thi/trượt ${pastAttendanceFails} môn do chuyên cần ở các kỳ trước.`;
            score = 55;
            label = 'Có Tiền Sử';
            colorClass = 'health-warning';
        } else if (coursesWithAbsence === 1 && totalSemesterAbsences >= 2) {
            personaType = 'ISOLATED_DIFFICULTY';
            personaTitle = '🎯 Vắng Cục Bộ Theo Môn';
            personaDesc = 'Chỉ vắng ở 1 môn duy nhất, các môn khác đi học đều đặn. Có thể gặp khó khăn riêng với môn này.';
            score = 75;
            label = 'Vắng Cục Bộ';
            colorClass = 'health-warning';
        } else if (totalSemesterAbsences > 0 && pastAttendanceFails === 0 && debts.length === 0) {
            personaType = 'SUDDEN_INCIDENT';
            personaTitle = '❤️ Biến Cố Đột Xuất';
            personaDesc = 'Sinh viên có học lực tốt, toàn khóa chăm chỉ nhưng kỳ này phát sinh vắng đột ngột.';
            score = 80;
            label = 'Biến Cố Đột Xuất';
            colorClass = 'health-good';
        }

        return {
            score,
            label,
            colorClass,
            totalSemesterAbsences,
            semesterCoursesCount: semesterCourses.length,
            coursesRollup,
            pastAttendanceFails,
            persona: {
                type: personaType,
                title: personaTitle,
                desc: personaDesc
            }
        };
    }

    /**
     * Tính toán thanh máu Học Lực (Nợ môn)
     */
    static calculateAcademicHealth(debtsCount) {
        const count = Number(debtsCount) || 0;
        if (count === 0) return { label: 'An Toàn', class: 'health-good', percent: 100 };
        if (count === 1) return { label: 'Cảnh Báo', class: 'health-warning', percent: 60 };
        return { label: 'Báo Động', class: 'health-danger', percent: 25 };
    }

    /**
     * Tính toán thanh máu Mức Độ Phản Hồi
     */
    static calculateResponseHealth(careLogs, contactStatus) {
        if (contactStatus === 'Đã liên lạc') return { label: 'Tốt', class: 'health-good', percent: 85 };
        if (contactStatus === 'Không nghe máy') return { label: 'Khó Liên Lạc', class: 'health-warning', percent: 45 };
        if (contactStatus === 'Sai số điện thoại') return { label: 'Sai SĐT', class: 'health-danger', percent: 15 };
        
        if (Array.isArray(careLogs) && careLogs.length > 0) {
            const lastLog = careLogs[0];
            if (lastLog.contact_status === 'Đã liên lạc') return { label: 'Tốt', class: 'health-good', percent: 85 };
            if (lastLog.contact_status === 'Không nghe máy') return { label: 'Khó Liên Lạc', class: 'health-warning', percent: 45 };
            if (lastLog.contact_status === 'Sai số điện thoại') return { label: 'Sai SĐT', class: 'health-danger', percent: 15 };
        }
        return { label: 'Chưa Rõ', class: 'health-warning', percent: 50 };
    }
}
