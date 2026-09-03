// client/js/engines/suggestion-engine.js - Trợ Lý Gợi Ý Kịch Bản Chăm Sóc Sinh Viên (Strategy Pattern Nâng Cao)

export class SuggestionEngine {
    constructor() {
        this.rules = [];
    }

    /**
     * Đăng ký một quy tắc gợi ý mới (Pluggable Rule Strategy)
     * @param {(data: Object) => boolean} conditionFn Hàm kiểm tra điều kiện kích hoạt
     * @param {(data: Object) => { title: string, text: string }} generateFn Hàm sinh kịch bản văn bản
     */
    registerRule(conditionFn, generateFn) {
        this.rules.push({ condition: conditionFn, generate: generateFn });
    }

    /**
     * Đánh giá và trả về gợi ý phù hợp nhất
     * @param {Object} data Dữ liệu sinh viên tổng hợp
     * @returns {{ title: string, text: string }}
     */
    evaluate(data) {
        for (const rule of this.rules) {
            try {
                if (rule.condition(data)) {
                    return rule.generate(data);
                }
            } catch (e) {
                console.warn("Lỗi khi đánh giá rule gợi ý:", e);
            }
        }
        return {
            title: "✨ Kịch bản: Động viên học tập thường quy",
            text: "Trao đổi nhẹ nhàng về tiến độ học tập trên lớp, kiểm tra xem sinh viên có vướng mắc về bài lab/assignment hay không để hỗ trợ kịp thời."
        };
    }
}

// Khởi tạo Singleton Suggestion Engine với các quy tắc chuẩn hóa
export const smartSuggestionEngine = new SuggestionEngine();

// Rule 1: Sai số điện thoại
smartSuggestionEngine.registerRule(
    d => d.contact_status === 'Sai số điện thoại',
    () => ({
        title: "🚨 Kịch bản: Thu thập lại thông tin liên lạc",
        text: "Số điện thoại hiện tại không đúng. Hãy tra cứu Email trường cấp hoặc liên hệ cán bộ quản lý lớp/bộ môn để xin lại số điện thoại phụ huynh."
    })
);

// Rule 2: Không nghe máy
smartSuggestionEngine.registerRule(
    d => d.contact_status === 'Không nghe máy',
    () => ({
        title: "📞 Kịch bản: Gọi lại vào khung giờ khác & Nhắn tin",
        text: "Sinh viên hoặc phụ huynh không nghe máy. Gợi ý gửi tin nhắn SMS/Zalo lịch sự giới thiệu Giảng viên và hẹn giờ gọi lại (ví dụ 11h30 - 12h30 hoặc sau 17h30)."
    })
);

// Rule 3: Nợ Môn Tiên Quyết (Prerequisite Debt Alert - Cảnh báo hổng kiến thức)
smartSuggestionEngine.registerRule(
    d => d.has_prerequisite_debt === true || (Array.isArray(d.prereq_debt_courses) && d.prereq_debt_courses.length > 0),
    d => {
        const prereqStr = (d.prereq_debt_courses && d.prereq_debt_courses.length > 0) ? d.prereq_debt_courses.join(', ') : 'môn nền tảng';
        return {
            title: `🔗 Kịch bản: Cảnh báo hổng kiến thức nền tảng (Nợ môn tiên quyết: ${prereqStr})`,
            text: `Sinh viên đang học môn ${d.course_code || 'hiện tại'} nhưng chưa qua môn tiên quyết ${prereqStr}. Nguy cơ cao sinh viên không hiểu bài dẫn đến chán nản và vắng học. Gợi ý: Hướng dẫn phụ đạo bổ sung kiến thức cốt lõi của môn ${prereqStr} hoặc tư vấn lộ trình học lại phù hợp.`
        };
    }
);

// Rule 4: Vừa Nợ Môn Ở Kỳ Liền Kề Trước (Recent Term Loss - Sốc lại tinh thần)
smartSuggestionEngine.registerRule(
    d => d.has_recent_debt === true || (Array.isArray(d.recent_debts_list) && d.recent_debts_list.length > 0),
    d => {
        const recentStr = (d.recent_debts_list && d.recent_debts_list.length > 0) ? d.recent_debts_list.join(', ') : 'kỳ trước';
        return {
            title: `⚡ Kịch bản: Sốc lại tinh thần học tập (Vừa nợ môn kỳ trước: ${recentStr})`,
            text: `Sinh viên vừa bị trượt môn ${recentStr} ở kỳ liền kề trước. Tâm lý sinh viên dễ bị mất đà và buông xuôi. Gợi ý: Chủ động động viên tinh thần, lắng nghe khó khăn, và nhắc nhở sinh viên lấy lại nhịp học tập ngay từ đầu kỳ này.`
        };
    }
);


// Rule 3: Chân dung "Bỏ học toàn diện" (Vắng nhiều môn trong kỳ)
smartSuggestionEngine.registerRule(
    d => d.lifetimeHealth && d.lifetimeHealth.persona && d.lifetimeHealth.persona.type === 'CHRONIC_ABSENCE',
    d => ({
        title: "🚨 Kịch bản: Báo động nguy cơ thôi học toàn diện",
        text: `Sinh viên đang vắng tổng cộng ${d.lifetimeHealth.totalSemesterAbsences} buổi rải rác trên ${d.lifetimeHealth.semesterCoursesCount} môn kỳ này. Cần liên hệ trực tiếp phụ huynh để tìm hiểu lý do nghỉ học và có phương án can thiệp khẩn cấp.`
    })
);

// Rule 4: Chân dung "Vắng cục bộ theo môn" (Chỉ vắng 1 môn)
smartSuggestionEngine.registerRule(
    d => d.lifetimeHealth && d.lifetimeHealth.persona && d.lifetimeHealth.persona.type === 'ISOLATED_DIFFICULTY',
    d => ({
        title: "🎯 Kịch bản: Hỗ trợ khó khăn môn học cục bộ",
        text: `Sinh viên chỉ vắng ở môn ${d.course_code || 'hiện tại'}, các môn khác đi học đầy đủ. Khả năng cao sinh viên bị đuối kiến thức hoặc vướng lịch đột xuất vào ca học này. Gợi ý: Trao đổi riêng để gỡ vướng bài lab hoặc đổi ca phụ đạo.`
    })
);

// Rule 5: Chân dung "Tiền sử cúp học mãn tính"
smartSuggestionEngine.registerRule(
    d => d.lifetimeHealth && d.lifetimeHealth.persona && d.lifetimeHealth.persona.type === 'PAST_OFFENDER',
    d => ({
        title: "⚠️ Kịch bản: Cảnh báo nghiêm khắc tiền sử chuyên cần",
        text: `Sinh viên từng bị cấm thi/trượt ${d.lifetimeHealth.pastAttendanceFails} môn vì điểm danh ở các kỳ trước. Cần nhắc nhở nghiêm túc về kỷ luật học tập, yêu cầu cam kết đi học 100% các buổi còn lại.`
    })
);

// Rule 6: Chân dung "Biến cố đột xuất" (Toàn khóa chăm chỉ, kỳ này vắng đột ngột)
smartSuggestionEngine.registerRule(
    d => d.lifetimeHealth && d.lifetimeHealth.persona && d.lifetimeHealth.persona.type === 'SUDDEN_INCIDENT',
    d => ({
        title: "❤️ Kịch bản: Thăm hỏi biến cố đột xuất",
        text: `Sinh viên có tiền sử học tập rất tốt nhưng kỳ này phát sinh vắng đột ngột ${d.total_absences} buổi. Hành động: Không trách mắng điểm danh. Hỏi thăm ân cần về sức khỏe/gia đình và hướng dẫn làm đơn bảo lưu nếu bất khả kháng.`
    })
);

// Rule 7: Cận kề ngưỡng cấm thi môn hiện tại
smartSuggestionEngine.registerRule(
    d => Number(d.max_absence) > 0 && Number(d.total_absences) >= Number(d.max_absence),
    d => ({
        title: "🚨 Kịch bản: Cận kề ngưỡng cấm thi môn hiện tại",
        text: `Sinh viên đã vắng ${d.total_absences}/${d.max_absence} buổi môn ${d.course_code || ''} (đã chạm ngưỡng cấm thi). Nhắc nhở quy chế điểm danh, yêu cầu hoàn thành bài tập bù và không được vắng thêm.`
    })
);
