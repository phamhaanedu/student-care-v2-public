// client/js/engines/email-template-engine.js - Động cơ Mẫu Thư HTML Cá Nhân Hóa & Đa Môn Học

export const EMAIL_TEMPLATES = {
    CRITICAL_ATTENDANCE: {
        id: 'CRITICAL_ATTENDANCE',
        name: '🔴 Cảnh báo khẩn cấp (Nguy cơ cấm thi)',
        default_subject: '[CẢNH BÁO CHUYÊN CẦN] Nguy cơ cấm thi học kỳ {semester} - SV {student_name} ({student_id})',
        theme_color: '#dc2626',
        badge_text: 'CẢNH BÁO NGUY CƠ CẤM THI',
        intro_text: 'Thầy/Cô gửi thông báo khẩn này vì hệ thống ghi nhận số buổi vắng của em trong học kỳ này đã đạt ngưỡng báo động cao. Nếu tiếp tục vắng thêm, em sẽ <strong>chính thức bị cấm thi</strong> và phải học lại môn học đó, gây ảnh hưởng nghiêm trọng đến tiến độ và học phí.'
    },
    FRIENDLY_ATTENDANCE_REMINDER: {
        id: 'FRIENDLY_ATTENDANCE_REMINDER',
        name: '🟡 Nhắc nhở chuyên cần & Động viên học tập',
        default_subject: '[NHẮC NHỞ HỌC TẬP] Tình hình chuyên cần học kỳ {semester} - SV {student_name} ({student_id})',
        theme_color: '#6f42c1',
        badge_text: 'THEO DÕI CHUYÊN CẦN',
        intro_text: 'Thầy/Cô gửi email này để nhắc nhở và đồng hành cùng em theo dõi tình hình chuyên cần các môn học trong kỳ. Việc duy trì đi học đầy đủ và đúng giờ là yếu tố quyết định để em nắm vững kiến thức và hoàn thành tốt các bài Lab/Assignment.'
    },
    LOCALIZED_SUBJECT_SUPPORT: {
        id: 'LOCALIZED_SUBJECT_SUPPORT',
        name: '🔵 Hỗ trợ khó khăn môn học & Phụ đạo',
        default_subject: '[HỖ TRỢ HỌC TẬP] Thầy/Cô muốn trao đổi hỗ trợ môn học - SV {student_name}',
        theme_color: '#0284c7',
        badge_text: 'HỖ TRỢ HỌC TẬP',
        intro_text: 'Qua theo dõi quá trình học tập, Thầy/Cô nhận thấy em đang gặp khó khăn hoặc vướng lịch học ở môn chuyên ngành. Thầy/Cô rất mong muốn được lắng nghe lý do và cùng em tìm giải pháp tháo gỡ (hướng dẫn bài tập, đăng ký ca phụ đạo hoặc đổi ca học phù hợp).'
    },
    PREREQUISITE_DEBT_WARNING: {
        id: 'PREREQUISITE_DEBT_WARNING',
        name: '🔗 Cảnh báo hổng kiến thức & Môn tiên quyết',
        default_subject: '[CẢNH BÁO HỌC VỤ] Hỗ trợ kiến thức nền tảng môn tiên quyết - SV {student_name} ({student_id})',
        theme_color: '#0369a1',
        badge_text: 'HỖ TRỢ MÔN TIÊN QUYẾT',
        intro_text: 'Hệ thống học vụ ghi nhận em đang tham gia các môn học chuyên ngành trong kỳ này nhưng <strong>chưa hoàn thành môn điều kiện tiên quyết</strong> tương ứng trước đó. Việc thiếu hụt kiến thức nền tảng sẽ khiến em gặp khó khăn rất lớn trong việc tiếp thu bài giảng, làm đồ án và dễ dẫn đến tình trạng nghỉ học hoặc không đủ điều kiện thi.'
    }
};


export class EmailTemplateEngine {
    /**
     * Lấy danh sách mẫu thư hỗ trợ
     */
    static getTemplatesList() {
        return Object.values(EMAIL_TEMPLATES);
    }

    /**
     * Render Tiêu đề Email theo Mẫu
     * @param {Object} studentData
     * @param {string} templateId
     * @param {string} customSubject
     * @returns {string}
     */
    static renderSubject(studentData, templateId = 'FRIENDLY_ATTENDANCE_REMINDER', customSubject = '') {
        const tpl = EMAIL_TEMPLATES[templateId] || EMAIL_TEMPLATES.FRIENDLY_ATTENDANCE_REMINDER;
        let subject = customSubject || tpl.default_subject;

        subject = subject.replace(/\{student_name\}/g, studentData.name || '');
        subject = subject.replace(/\{student_id\}/g, studentData.student_id || '');
        subject = subject.replace(/\{semester\}/g, studentData.semester || '');
        return subject;
    }

    /**
     * Render Thân Email HTML Hoàn Chỉnh (Gộp toàn bộ môn học)
     * @param {Object} studentData Dữ liệu sinh viên đã gộp từ EmailRollupService
     * @param {string} templateId
     * @param {string} personalNote Lời nhắn riêng của giảng viên (nếu có)
     * @param {string} senderName Tên người gửi / Giảng viên phụ trách
     * @returns {string} HTML String
     */
    static renderHtmlBody(studentData, templateId = 'FRIENDLY_ATTENDANCE_REMINDER', personalNote = '', senderName = '') {
        const tpl = EMAIL_TEMPLATES[templateId] || EMAIL_TEMPLATES.FRIENDLY_ATTENDANCE_REMINDER;
        const courses = studentData.courses || [];
        const themeColor = tpl.theme_color;

        // 1. Tạo Bảng HTML Danh Sách Môn Học
        let coursesRowsHtml = '';
        courses.forEach(c => {
            let rowBg = '#ffffff';
            let statusColor = '#059669';
            let statusBg = 'rgba(16, 185, 129, 0.12)';

            if (c.risk_level === 'danger') {
                rowBg = '#fef2f2';
                statusColor = '#dc2626';
                statusBg = '#fee2e2';
            } else if (c.risk_level === 'warning') {
                rowBg = '#fffbeb';
                statusColor = '#d97706';
                statusBg = '#fef3c7';
            } else if (c.risk_level === 'caution') {
                rowBg = '#faf5ff';
                statusColor = '#7c3aed';
                statusBg = '#f3e8ff';
            }

            coursesRowsHtml += `
                <tr style="background-color: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
                    <td style="padding: 10px 12px; font-size: 13px; color: #1e293b;">
                        <strong>${c.course_code}</strong><br>
                        <span style="font-size: 12px; color: #64748b;">${c.course_name}</span>
                    </td>
                    <td style="padding: 10px 12px; font-size: 13px; color: #334155;">
                        ${c.class_name}<br>
                        <span style="font-size: 11px; color: #64748b;">${c.block}</span>
                    </td>
                    <td style="padding: 10px 12px; font-size: 14px; text-align: center; font-weight: 700; color: ${c.total_absences > 0 ? '#dc2626' : '#10b981'};">
                        ${c.total_absences} / ${c.max_absences}
                    </td>
                    <td style="padding: 10px 12px; font-size: 12px; text-align: center;">
                        <span style="display: inline-block; padding: 3px 8px; border-radius: 4px; font-weight: 600; color: ${statusColor}; background-color: ${statusBg};">
                            ${c.status_label}
                        </span>
                    </td>
                    <td style="padding: 10px 12px; font-size: 12px; color: #475569;">
                        👨‍🏫 ${c.teacher_name || c.teacher_id || 'Chưa rõ'}
                    </td>
                </tr>
            `;
        });

        // 2. Khung lời nhắn cá nhân (nếu có)
        let personalNoteBlock = '';
        if (personalNote && personalNote.trim()) {
            personalNoteBlock = `
                <div style="margin: 20px 0; padding: 14px 18px; background-color: #fff7ed; border-left: 4px solid #f97316; border-radius: 4px;">
                    <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #c2410c;">💬 Lời nhắn riêng từ Giảng viên phụ trách:</p>
                    <p style="margin: 0; font-size: 13px; color: #431407; line-height: 1.5; white-space: pre-line;">${personalNote.trim()}</p>
                </div>
            `;
        }

        // 3. Khung HTML Email chuẩn Responsive
        return `
<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Thông Báo Chuyên Cần</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed; background-color: #f1f5f9; padding: 25px 10px;">
        <tr>
            <td align="center">
                <!-- Card Container -->
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 620px; background-color: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); border: 1px solid #e2e8f0;">
                    
                    <!-- Header Banner -->
                    <tr>
                        <td style="background-color: ${themeColor}; padding: 22px 24px; text-align: left;">
                            <span style="display: inline-block; padding: 3px 10px; background-color: rgba(255, 255, 255, 0.2); border-radius: 12px; color: #ffffff; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; margin-bottom: 6px;">
                                ${tpl.badge_text}
                            </span>
                            <h2 style="margin: 0; color: #ffffff; font-size: 18px; font-weight: 700; line-height: 1.3;">
                                HỆ THỐNG CHĂM SÓC SINH VIÊN - FPT POLYTECHNIC
                            </h2>
                            <p style="margin: 4px 0 0 0; color: rgba(255, 255, 255, 0.9); font-size: 13px;">
                                Học kỳ: <strong>${studentData.semester}</strong>
                            </p>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding: 24px;">
                            <p style="margin: 0 0 14px 0; font-size: 15px; color: #1e293b; line-height: 1.5;">
                                Thân chào em <strong>${studentData.name}</strong> (MSSV: <strong>${studentData.student_id}</strong>),
                            </p>

                            <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.6;">
                                ${tpl.intro_text}
                            </p>

                            <!-- Personal Note Block -->
                            ${personalNoteBlock}

                            <!-- Title Table -->
                            <p style="margin: 20px 0 8px 0; font-size: 13px; font-weight: 700; color: #0f172a; text-transform: uppercase; letter-spacing: 0.3px;">
                                📊 Bảng Tổng Hợp Chuyên Cần Toàn Bộ Môn Học Kỳ Này:
                            </p>

                            <!-- Course Table -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse: collapse; border: 1px solid #cbd5e1; border-radius: 6px; overflow: hidden; margin-bottom: 20px;">
                                <thead>
                                    <tr style="background-color: #f8fafc; border-bottom: 2px solid #cbd5e1;">
                                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; color: #475569; text-align: left;">Môn Học</th>
                                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; color: #475569; text-align: left;">Lớp</th>
                                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; color: #475569; text-align: center;">Số Buổi Vắng</th>
                                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; color: #475569; text-align: center;">Tình Trạng</th>
                                        <th style="padding: 10px 12px; font-size: 12px; font-weight: 700; color: #475569; text-align: left;">GV Đứng Lớp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${coursesRowsHtml}
                                </tbody>
                            </table>

                            <!-- Recommendations / Next steps -->
                            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 14px 16px; margin-bottom: 20px;">
                                <p style="margin: 0 0 8px 0; font-size: 13px; font-weight: 700; color: #1e293b;">
                                    📌 Lời khuyên và hướng xử lý dành cho em:
                                </p>
                                <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #475569; line-height: 1.6;">
                                    <li>Kiểm tra lại thời khóa biểu chi tiết trên cổng FAP/AP để không bỏ lỡ ca học kế tiếp.</li>
                                    <li>Tuyệt đối <strong>không nghỉ thêm</strong> ở các môn học đang có nguy cơ cấm thi.</li>
                                    <li>Nếu có vướng mắc về bài tập Lab / Assignment, hãy chủ động liên hệ trực tiếp với Giảng viên bộ môn hoặc <strong>trả lời thẳng vào email này</strong> để được hỗ trợ.</li>
                                </ul>
                            </div>

                            <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                                Chúc em luôn giữ vững tinh thần và hoàn thành xuất sắc học kỳ!<br>
                                <strong>Bộ Phận Chăm Sóc Sinh Viên - FPT Polytechnic</strong>
                            </p>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #f8fafc; padding: 14px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
                            Email này được gửi tự động từ Hệ Thống Student Care Mini-CRM.<br>
                            Mọi thắc mắc vui lòng trả lời trực tiếp email này để liên hệ với Giảng viên phụ trách.
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
        `.trim();
    }
}
