// client/js/components/email-modal.js - Modal Gửi Email Nhắc Nhở Đơn Lẻ & Hàng Loạt (Live Preview & Progress Bar)

import { EMAIL_TEMPLATES, EmailTemplateEngine } from '../engines/email-template-engine.js';
import { MailService } from '../services/mail-service.js';
import { showToast } from '../utils/toast.js';

export class EmailModalComponent {
    /**
     * Mở Modal Gửi Email Đơn Lẻ (Kèm Live Preview Iframe)
     * @param {Object} studentPayload Dữ liệu từ EmailRollupService.aggregateStudentData()
     * @param {Object} currentSession
     * @param {Function} onSentSuccess Callback sau khi gửi thành công
     */
    static openSingleModal(studentPayload, currentSession = null, onSentSuccess = null) {
        if (!studentPayload) return;

        let modalEl = document.getElementById('modalEmailSingle');
        if (modalEl) modalEl.remove();

        let currentTemplateId = studentPayload.recommended_template || 'FRIENDLY_ATTENDANCE_REMINDER';
        let currentSubject = EmailTemplateEngine.renderSubject(studentPayload, currentTemplateId);
        let personalNote = '';

        const modalHtml = `
            <div id="modalEmailSingle" class="email-modal-overlay">
                <div class="email-modal-container">
                    <div class="email-modal-header">
                        <div class="modal-header-title">
                            <span class="modal-header-icon">✉️</span>
                            <div>
                                <h3 style="margin: 0; font-size: 1.1rem; color: #1e293b;">Soạn & Xem Trước Email Nhắc Nhở</h3>
                                <p style="margin: 2px 0 0 0; font-size: 0.8rem; color: #64748b;">
                                    Gửi tới: <strong>${studentPayload.name}</strong> (${studentPayload.student_id}) &bull; Email: <strong>${studentPayload.email}</strong>
                                </p>
                            </div>
                        </div>
                        <button type="button" class="btn-modal-close" id="btnCloseEmailModalSingle">&times;</button>
                    </div>

                    <div class="email-modal-body">
                        <!-- Cột Trái: Thiết lập Mẫu Thư & Lời Nhắn -->
                        <div class="email-settings-pane">
                            <!-- Chọn Mẫu Thư -->
                            <div class="form-group" style="margin-bottom: 14px;">
                                <label class="form-label" style="font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px; display: block;">
                                    📝 Chọn Mẫu Email:
                                </label>
                                <select id="selEmailTemplateSingle" class="filter-select" style="width: 100%;">
                                    ${Object.values(EMAIL_TEMPLATES).map(t => `
                                        <option value="${t.id}" ${t.id === currentTemplateId ? 'selected' : ''}>
                                            ${t.name}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>

                            <!-- Tiêu Đề Thư -->
                            <div class="form-group" style="margin-bottom: 14px;">
                                <label class="form-label" style="font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px; display: block;">
                                    📌 Tiêu Đề Email:
                                </label>
                                <input type="text" id="inpEmailSubjectSingle" class="input-search" style="width: 100%; padding-left: 12px;" value="${currentSubject}">
                            </div>

                            <!-- Lời Nhắn Riêng -->
                            <div class="form-group" style="margin-bottom: 14px;">
                                <label class="form-label" style="font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px; display: block;">
                                    💬 Lời Nhắn Cá Nhân (Tùy chọn):
                                </label>
                                <textarea id="inpEmailPersonalNoteSingle" class="input-search" rows="3" style="width: 100%; height: 75px; padding: 8px 12px; resize: vertical;" placeholder="Nhập lời dặn dò riêng hoặc hẹn giờ trao đổi..."></textarea>
                            </div>

                            <!-- Tóm tắt môn học được gộp -->
                            <div class="courses-rollup-summary" style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 16px;">
                                <div style="font-size: 0.78rem; font-weight: 700; color: #475569; margin-bottom: 6px;">
                                    📚 Môn học kỳ này được gộp (${studentPayload.courses.length} môn):
                                </div>
                                <div style="display: flex; flex-direction: column; gap: 4px;">
                                    ${studentPayload.courses.map(c => `
                                        <div style="display: flex; justify-content: space-between; font-size: 0.76rem;">
                                            <span><strong>${c.course_code}</strong> (${c.class_name})</span>
                                            <span style="color: ${c.total_absences > 0 ? '#dc2626' : '#10b981'}; font-weight: 700;">
                                                ${c.total_absences}/${c.max_absences} buổi
                                            </span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>

                            <!-- Nút Thao Tác -->
                            <div style="display: flex; gap: 10px; margin-top: auto;">
                                <button type="button" id="btnCancelSingleEmail" class="btn btn-secondary" style="flex: 1;">Đóng</button>
                                <button type="button" id="btnSendSingleEmail" class="btn btn-primary" style="flex: 2; display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                                    <span>🚀 Gửi Email Ngay</span>
                                </button>
                            </div>
                        </div>

                        <!-- Cột Phải: Live HTML Preview -->
                        <div class="email-preview-pane">
                            <div class="preview-pane-header" style="font-size: 0.78rem; font-weight: 700; color: #64748b; margin-bottom: 8px; display: flex; justify-content: space-between;">
                                <span>👁️ XEM TRƯỚC NỘI DUNG (PREVIEW)</span>
                                <span>To: ${studentPayload.email}</span>
                            </div>
                            <div class="preview-iframe-wrapper" style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; height: 420px; background: #fff;">
                                <iframe id="iframeEmailPreviewSingle" style="width: 100%; height: 100%; border: none;"></iframe>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const overlay = document.getElementById('modalEmailSingle');
        const btnClose = document.getElementById('btnCloseEmailModalSingle');
        const btnCancel = document.getElementById('btnCancelSingleEmail');
        const btnSend = document.getElementById('btnSendSingleEmail');
        const selTemplate = document.getElementById('selEmailTemplateSingle');
        const inpSubject = document.getElementById('inpEmailSubjectSingle');
        const inpNote = document.getElementById('inpEmailPersonalNoteSingle');
        const iframe = document.getElementById('iframeEmailPreviewSingle');

        // Hàm cập nhật Live Preview
        const updatePreview = () => {
            currentTemplateId = selTemplate.value;
            personalNote = inpNote.value;
            const html = EmailTemplateEngine.renderHtmlBody(studentPayload, currentTemplateId, personalNote, currentSession?.email?.split('@')[0]);
            if (iframe && iframe.contentDocument) {
                iframe.contentDocument.open();
                iframe.contentDocument.write(html);
                iframe.contentDocument.close();
            }
        };

        // Sự kiện đổi Template
        selTemplate.addEventListener('change', () => {
            currentTemplateId = selTemplate.value;
            inpSubject.value = EmailTemplateEngine.renderSubject(studentPayload, currentTemplateId);
            updatePreview();
        });

        inpNote.addEventListener('input', updatePreview);

        // Khởi chạy Preview lần đầu
        setTimeout(updatePreview, 50);

        // Sự kiện Đóng
        const closeModal = () => { overlay.remove(); };
        btnClose.addEventListener('click', closeModal);
        btnCancel.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

        // Sự kiện Gửi
        btnSend.addEventListener('click', async () => {
            btnSend.disabled = true;
            btnSend.innerHTML = '⏳ Đang gửi thư...';

            try {
                const res = await MailService.sendSingleReminder(
                    studentPayload,
                    currentTemplateId,
                    personalNote,
                    inpSubject.value.trim(),
                    currentSession
                );

                showToast(`🎉 Đã gửi email nhắc nhở cho sinh viên ${studentPayload.name} (${studentPayload.email}) thành công!`, "success");
                closeModal();

                if (onSentSuccess) onSentSuccess(res);

            } catch (err) {
                console.error("Lỗi gửi email:", err);
                showToast(`❌ Lỗi gửi email: ${err.message}`, "error");
                btnSend.disabled = false;
                btnSend.innerHTML = '🚀 Gửi Email Ngay';
            }
        });
    }

    /**
     * Mở Modal Gửi Email Hàng Loạt (Có Chọn Lọc & Progress Bar)
     * @param {Array<Object>} aggregatedStudentsList Danh sách sinh viên đã gộp từ EmailRollupService
     * @param {Object} currentSession
     * @param {Function} onBulkSentSuccess Callback sau khi hoàn thành
     */
    static openBulkModal(aggregatedStudentsList = [], currentSession = null, onBulkSentSuccess = null) {
        if (!Array.isArray(aggregatedStudentsList) || aggregatedStudentsList.length === 0) {
            showToast("Vui lòng tích chọn ít nhất 1 sinh viên để gửi email!", "warning");
            return;
        }

        let modalEl = document.getElementById('modalEmailBulk');
        if (modalEl) modalEl.remove();

        let currentTemplateId = 'FRIENDLY_ATTENDANCE_REMINDER';
        let personalNote = '';
        let isCancelled = false;

        const totalStudents = aggregatedStudentsList.length;
        const totalCoursesCount = aggregatedStudentsList.reduce((sum, s) => sum + s.courses.length, 0);

        const modalHtml = `
            <div id="modalEmailBulk" class="email-modal-overlay">
                <div class="email-modal-container modal-bulk-container" style="max-width: 800px;">
                    <div class="email-modal-header">
                        <div class="modal-header-title">
                            <span class="modal-header-icon">✉️</span>
                            <div>
                                <h3 style="margin: 0; font-size: 1.1rem; color: #1e293b;">Kích Hoạt Gửi Email Nhắc Nhở Hàng Loạt</h3>
                                <p style="margin: 2px 0 0 0; font-size: 0.82rem; color: #64748b;">
                                    Đã chọn: <strong style="color: #6f42c1;">${totalStudents} sinh viên duy nhất</strong> (Gộp từ ${totalCoursesCount} ca môn học)
                                </p>
                            </div>
                        </div>
                        <button type="button" class="btn-modal-close" id="btnCloseEmailModalBulk">&times;</button>
                    </div>

                    <div class="email-modal-body" style="flex-direction: column; gap: 16px; padding: 18px 24px;">
                        <!-- Thiết lập chung -->
                        <div class="bulk-settings-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
                            <div>
                                <label style="font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px; display: block;">
                                    📝 Mẫu Email Áp Dụng:
                                </label>
                                <select id="selEmailTemplateBulk" class="filter-select" style="width: 100%;">
                                    ${Object.values(EMAIL_TEMPLATES).map(t => `
                                        <option value="${t.id}" ${t.id === currentTemplateId ? 'selected' : ''}>
                                            ${t.name}
                                        </option>
                                    `).join('')}
                                </select>
                            </div>
                            <div>
                                <label style="font-weight: 700; font-size: 0.82rem; color: #334155; margin-bottom: 6px; display: block;">
                                    💬 Lời Nhắn Chung (Tùy chọn):
                                </label>
                                <input type="text" id="inpEmailPersonalNoteBulk" class="input-search" style="width: 100%; padding-left: 12px;" placeholder="Nhập lời nhắn chung đính kèm vào tất cả email...">
                            </div>
                        </div>

                        <!-- Bảng Danh Sách Sinh Viên Nhận Thư (Gộp Môn) -->
                        <div style="border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; max-height: 240px; overflow-y: auto;">
                            <table class="table table-sm" style="margin: 0; font-size: 0.82rem;">
                                <thead style="background: #f8fafc; position: sticky; top: 0; z-index: 1;">
                                    <tr>
                                        <th style="width: 40px; text-align: center;">#</th>
                                        <th style="width: 100px;">Mã SV</th>
                                        <th style="width: 150px;">Họ Tên</th>
                                        <th>Email Nhận</th>
                                        <th>Các Môn Vắng Được Gộp</th>
                                        <th style="width: 90px; text-align: center;">Tổng Vắng</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${aggregatedStudentsList.map((s, idx) => `
                                        <tr>
                                            <td style="text-align: center; color: #94a3b8;">${idx + 1}</td>
                                            <td><strong>${s.student_id}</strong></td>
                                            <td>${s.name}</td>
                                            <td><span style="color: #64748b;">${s.email}</span></td>
                                            <td>
                                                <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                                                    ${s.courses.map(c => `
                                                        <span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; background: ${c.total_absences > 0 ? '#fee2e2' : '#f1f5f9'}; color: ${c.total_absences > 0 ? '#dc2626' : '#475569'};">
                                                            ${c.course_code} (${c.total_absences}/${c.max_absences})
                                                        </span>
                                                    `).join('')}
                                                </div>
                                            </td>
                                            <td style="text-align: center; font-weight: 700; color: ${s.total_absences_all > 0 ? '#dc2626' : '#10b981'};">
                                                ${s.total_absences_all}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>

                        <!-- Khung Tiến Trình Gửi (Progress Box) -->
                        <div id="bulkProgressBox" style="display: none; background: #faf5ff; border: 1px solid rgba(111, 66, 193, 0.2); border-radius: 8px; padding: 14px 18px;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.84rem; font-weight: 700; color: #6f42c1; margin-bottom: 6px;">
                                <span id="txtBulkProgressStatus">⏳ Đang chuẩn bị gửi email...</span>
                                <span id="txtBulkProgressPercent">0%</span>
                            </div>
                            <div style="height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden;">
                                <div id="barBulkProgressFill" style="height: 100%; width: 0%; background: #6f42c1; transition: width 0.2s;"></div>
                            </div>
                        </div>

                        <!-- Nút Điều Khiển -->
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px;">
                            <span style="font-size: 0.78rem; color: #94a3b8;">
                                💡 Mỗi sinh viên sẽ nhận đúng 1 email chứa bảng tổng hợp tất cả các môn vắng.
                            </span>
                            <div style="display: flex; gap: 10px;">
                                <button type="button" id="btnCancelBulkModal" class="btn btn-secondary">Đóng</button>
                                <button type="button" id="btnStopBulkSend" class="btn btn-danger" style="display: none;">🛑 Dừng Gửi</button>
                                <button type="button" id="btnStartBulkSend" class="btn btn-primary" style="display: inline-flex; align-items: center; gap: 6px;">
                                    <span>🚀 Bắt Đầu Gửi (${totalStudents} Email)</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const overlay = document.getElementById('modalEmailBulk');
        const btnClose = document.getElementById('btnCloseEmailModalBulk');
        const btnCancel = document.getElementById('btnCancelBulkModal');
        const btnStart = document.getElementById('btnStartBulkSend');
        const btnStop = document.getElementById('btnStopBulkSend');
        const selTemplate = document.getElementById('selEmailTemplateBulk');
        const inpNote = document.getElementById('inpEmailPersonalNoteBulk');
        const progressBox = document.getElementById('bulkProgressBox');
        const progressStatus = document.getElementById('txtBulkProgressStatus');
        const progressPercent = document.getElementById('txtBulkProgressPercent');
        const progressBar = document.getElementById('barBulkProgressFill');

        const closeModal = () => { overlay.remove(); };
        btnClose.addEventListener('click', closeModal);
        btnCancel.addEventListener('click', closeModal);

        btnStop.addEventListener('click', () => {
            isCancelled = true;
            btnStop.disabled = true;
            btnStop.textContent = '⏳ Đang dừng...';
        });

        btnStart.addEventListener('click', async () => {
            currentTemplateId = selTemplate.value;
            personalNote = inpNote.value.trim();

            btnStart.style.display = 'none';
            btnCancel.disabled = true;
            btnClose.disabled = true;
            btnStop.style.display = 'inline-flex';
            progressBox.style.display = 'block';

            const res = await MailService.sendBulkReminders(
                aggregatedStudentsList,
                currentTemplateId,
                personalNote,
                currentSession,
                (curIdx, total, curStudent) => {
                    const pct = Math.round((curIdx / total) * 100);
                    progressBar.style.width = `${pct}%`;
                    progressPercent.textContent = `${pct}%`;
                    progressStatus.textContent = `Đang gửi: ${curIdx}/${total} (${curStudent.name} - ${curStudent.student_id})...`;
                },
                () => isCancelled
            );

            btnStop.style.display = 'none';
            btnCancel.disabled = false;
            btnClose.disabled = false;

            if (isCancelled) {
                progressStatus.textContent = `🛑 Đã tạm dừng: Hoàn thành ${res.successful}/${totalStudents} email.`;
                showToast(`Đã tạm dừng đợt gửi. Thành công: ${res.successful}/${totalStudents} sinh viên.`, "info");
            } else {
                progressBar.style.width = '100%';
                progressPercent.textContent = '100%';
                progressStatus.textContent = `🎉 Hoàn thành! Đã gửi thành công ${res.successful}/${totalStudents} email.`;
                showToast(`🎉 Đã gửi thành công email nhắc nhở cho ${res.successful} sinh viên!`, "success");
            }

            if (onBulkSentSuccess) onBulkSentSuccess(res);
        });
    }
}
