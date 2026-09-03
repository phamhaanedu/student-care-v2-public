// client/js/components/accordion-workspace.js - Render Không Gian Chăm Sóc 360° Độc Lập Chuẩn 2 Cấp Độ Chuyên Cần

import { formatDateTime } from '../utils/date-helpers.js';
import { HealthBarEngine } from '../engines/health-bar-engine.js';
import { smartSuggestionEngine } from '../engines/suggestion-engine.js';
import { SubjectService } from '../services/subject-service.js';
import { ROOT_CAUSES } from '../constants/index.js';


export class AccordionWorkspaceComponent {
    /**
     * Render toàn bộ HTML cho Không gian Chăm sóc 360° (3 Cột) chuẩn 2 Cấp Độ Chuyên Cần
     * @param {Object} record AcademicRecord hiện tại
     * @param {Object|null} studentData Dữ liệu Students doc
     * @param {Map<string, Object>} subjectsCache Cache danh mục môn học
     * @param {boolean} isTeaching Người dùng có phải GV đứng lớp không
     * @param {Array<Object>} allTasks Toàn bộ danh sách nhiệm vụ của kỳ trong RAM
     * @returns {string} Chuỗi HTML hoàn chỉnh
     */
    static render(record, studentData, subjectsCache, isTeaching, allTasks = []) {
        const docId = record.id;
        const studentId = record.student_id;
        studentData = studentData || {};

        // 1. Chuẩn bị thông tin SĐT & Email & Tên
        let phoneNumbers = [];
        if (Array.isArray(studentData.phone_numbers) && studentData.phone_numbers.length > 0) {
            phoneNumbers = [...studentData.phone_numbers];
        } else if (studentData.phone) {
            phoneNumbers = [studentData.phone];
        } else if (record.phone) {
            phoneNumbers = [record.phone];
        }

        const primaryPhone = phoneNumbers.length > 0 ? phoneNumbers[phoneNumbers.length - 1] : 'Chưa có SĐT';
        const oldPhones = phoneNumbers.length > 1 ? phoneNumbers.slice(0, -1) : [];

        const sdt = primaryPhone;
        const email = record.email || studentData.email || 'Chưa có email';
        const name = record.student_name || record.name || studentData.name || 'Sinh viên';
        const absences = Number(record.total_absences) || 0;
        const debts = Array.isArray(studentData.current_debts) ? studentData.current_debts : [];
        const contactStatus = record.contact_status || 'Chưa liên lạc';
        const careStatus = record.care_status || '';
        const notes = record.notes || '';
        const remarks = Array.isArray(studentData.instructor_remarks) ? studentData.instructor_remarks : [];

        // 2. Tra cứu môn học & Vắng tối đa
        const rawCourseCode = record.course_code || '';
        const subjectObj = SubjectService.findSubjectData(rawCourseCode) || (subjectsCache ? subjectsCache.get(rawCourseCode) : null);
        const courseName = subjectObj && subjectObj.course_name ? subjectObj.course_name : '';
        const courseDisplay = courseName ? `${rawCourseCode} - ${courseName}` : rawCourseCode;
        const maxAllowed = (subjectObj && subjectObj.max_absences !== undefined) ? Number(subjectObj.max_absences) : 3;

        // 3. Tính toán 2 Cấp Độ Chuyên Cần & Sức Khỏe Học Vụ
        const healthAttCurrent = HealthBarEngine.calculateAttendanceHealth(absences, maxAllowed);
        const lifetimeHealth = HealthBarEngine.calculateLifetimeAttendanceHealth(studentData, allTasks, studentId, subjectsCache);
        const healthAcad = HealthBarEngine.calculateAcademicHealth(debts.length);
        const healthResp = HealthBarEngine.calculateResponseHealth([], contactStatus);

        // 4. Kịch bản AI Rule-based nâng cao
        const suggestion = smartSuggestionEngine.evaluate({
            course_code: rawCourseCode,
            total_absences: absences,
            max_absence: maxAllowed,
            current_debts: debts,
            contact_status: contactStatus,
            care_status: careStatus,
            lifetimeHealth: lifetimeHealth,
            has_prerequisite_debt: record.has_prerequisite_debt,
            prereq_debt_courses: record.prereq_debt_courses,
            has_recent_debt: record.has_recent_debt,
            recent_debts_list: record.recent_debts_list
        });


        // 5. Đánh giá nguy cơ môn hiện tại
        let evalText = '🟢 An toàn';
        if (maxAllowed <= 0) {
            evalText = '🟢 Đồ án / Không tính điểm danh';
        } else if (absences >= maxAllowed) {
            evalText = `🚨 Nguy cơ cấm thi rất cao (${absences}/${maxAllowed})`;
        } else if (absences >= Math.max(2, maxAllowed - 1)) {
            evalText = `⚠️ Cần cảnh báo chuyên cần (${absences}/${maxAllowed})`;
        }

        const maxDisplayStr = maxAllowed > 0 ? `${maxAllowed} buổi` : 'Đồ án (KĐD)';

        return `
            <!-- Top Header: Profile Info -->
            <div class="inline-header-profile">
                <div class="student-meta-main">
                    <div class="student-avatar">${(name || 'S').charAt(0).toUpperCase()}</div>
                    <div class="student-title-block">
                        <h3>
                            <span>${name}</span>
                            <span class="student-id-tag">${studentId}</span>
                        </h3>
                        <div class="student-contact-row">
                            <span class="phone-highlight-block" id="phoneBlock-${docId}">
                                📞 <a href="tel:${sdt}" class="phone-link-large" onclick="event.stopPropagation();">${sdt}</a>
                                ${sdt !== 'Chưa có SĐT' ? `<button type="button" class="btn-copy-phone-large" onclick="navigator.clipboard.writeText('${sdt}'); window.showToast('Đã sao chép SĐT ${sdt}', 'success'); event.stopPropagation();">Sao chép</button>` : ''}
                                ${oldPhones.length > 0 ? `<span class="old-phones-text" title="Các số cũ: ${oldPhones.join(', ')}">(Số cũ: ${oldPhones.join(', ')})</span>` : ''}
                                <button type="button" class="btn-add-phone-trigger" id="btnShowAddPhone-${docId}" title="Bổ sung số điện thoại mới" onclick="window.handleOpenAddPhoneModal('${studentId}', '${docId}'); event.stopPropagation();">➕ Thêm SĐT</button>
                            </span>
                            <span>✉️ ${email}</span>
                            <button type="button" class="btn-send-email-mini" onclick="window.handleOpenSingleEmailModal('${studentId}', '${docId}'); event.stopPropagation();" title="Gửi email nhắc nhở chuyên cần (tự động gộp tất cả các môn vắng)">
                                ✉️ Gửi Email Nhắc Nhở
                            </button>
                            ${record.last_email_sent_at ? `<span class="badge-email-sent" title="Thời gian gửi: ${new Date(record.last_email_sent_at).toLocaleString('vi-VN')}">✉️ Đã gửi thư</span>` : ''}
                            <span>🏫 Lớp: <strong>${record.class_name || record.class_id || '-'}</strong> (Môn: <strong>${courseDisplay || '-'}</strong>)</span>
                        </div>
                    </div>
                </div>
            </div>


            <!-- Persona Banner (Chân dung chuyên cần toàn diện) -->
            <div class="persona-banner">
                <span style="font-size: 1.1rem;">👤</span>
                <div>
                    <span class="persona-banner-title">${lifetimeHealth.persona.title}</span>: 
                    <span class="persona-banner-desc">${lifetimeHealth.persona.desc}</span>
                </div>
            </div>

            <!-- Health Bars Visualization (4 Thanh Máu Trực Quan) -->
            <div class="health-bars-box">
                <div class="health-item">
                    <div class="health-header">
                        <span>Chuyên Cần (Môn Này: ${absences}/${maxAllowed > 0 ? maxAllowed : '0'})</span>
                        <span class="health-status-text ${healthAttCurrent.class}">${healthAttCurrent.label}</span>
                    </div>
                    <div class="health-bar-track">
                        <div class="health-bar-progress ${healthAttCurrent.class}" style="width: ${healthAttCurrent.percent}%;"></div>
                    </div>
                </div>

                <div class="health-item">
                    <div class="health-header">
                        <span>Chuyên Cần (Toàn Kỳ: ${lifetimeHealth.totalSemesterAbsences} vắng)</span>
                        <span class="health-status-text ${lifetimeHealth.colorClass}">${lifetimeHealth.label}</span>
                    </div>
                    <div class="health-bar-track">
                        <div class="health-bar-progress ${lifetimeHealth.colorClass}" style="width: ${lifetimeHealth.score}%;"></div>
                    </div>
                </div>

                <div class="health-item">
                    <div class="health-header">
                        <span>Học Lực (${debts.length} nợ môn)</span>
                        <span class="health-status-text ${healthAcad.class}">${healthAcad.label}</span>
                    </div>
                    <div class="health-bar-track">
                        <div class="health-bar-progress ${healthAcad.class}" style="width: ${healthAcad.percent}%;"></div>
                    </div>
                </div>

                <div class="health-item">
                    <div class="health-header">
                        <span>Mức Độ Phản Hồi</span>
                        <span class="health-status-text ${healthResp.class}">${healthResp.label}</span>
                    </div>
                    <div class="health-bar-track">
                        <div class="health-bar-progress ${healthResp.class}" style="width: ${healthResp.percent}%;"></div>
                    </div>
                </div>
            </div>

            <!-- Smart AI Suggestion Box -->
            <div class="smart-suggestion-box">
                <div class="suggestion-icon">💡</div>
                <div class="suggestion-content">
                    <h4>${suggestion.title}</h4>
                    <p>${suggestion.text}</p>
                </div>
            </div>

            <!-- 3-Column Simultaneous Workspace Grid -->
            <div class="inline-dashboard-grid">
                <!-- CỘT 1: 📚 Điểm Danh & 📊 Hồ Sơ Nợ Môn -->
                <div class="inline-panel-card">
                    <div class="panel-header">
                        <h4>📚 Điểm Danh & Chuyên Cần</h4>
                    </div>
                    <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem; margin-bottom: 12px;">
                        <tbody>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary); width: 110px;">Môn học:</td>
                                <td style="padding: 5px 0; font-weight: 600;">${courseDisplay || '-'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary);">Lớp:</td>
                                <td style="padding: 5px 0; font-weight: 600;">${record.class_name || record.class_id || '-'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary);">GV Đứng Lớp:</td>
                                <td style="padding: 5px 0; font-weight: 600;">${record.teacher_id || '-'}</td>
                            </tr>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 5px 0; color: var(--text-secondary);">Vắng / Cho phép:</td>
                                <td style="padding: 5px 0; font-weight: 700; color: ${maxAllowed > 0 && absences >= maxAllowed ? '#dc3545' : (absences >= 2 ? '#fd7e14' : '#198754')};">
                                    ${absences} / ${maxDisplayStr}
                                </td>
                            </tr>
                            <tr>
                                <td style="padding: 5px 0; color: var(--text-secondary);">Đánh giá môn:</td>
                                <td style="padding: 5px 0; font-weight: 600;">
                                    ${evalText}
                                </td>
                            </tr>
                        </tbody>
                    </table>

                    <!-- Tiến độ tất cả các môn trong cùng học kỳ (Cross-Subject Rollup) -->
                    <div class="semester-courses-summary">
                        <div class="semester-courses-header">
                            <span>📅 Toàn Bộ Môn Học Kỳ Này (${lifetimeHealth.semesterCoursesCount} môn):</span>
                            <span style="font-size: 0.72rem; color: #64748b;">Tổng vắng: <strong>${lifetimeHealth.totalSemesterAbsences}</strong> buổi</span>
                        </div>
                        <div class="courses-list-mini">
                            ${lifetimeHealth.coursesRollup.map(c => {
                                const isCurrent = (c.id === docId);
                                const maxStr = c.max_absences > 0 ? `/${c.max_absences}` : '';
                                let badgeClass = 'safe';
                                if (c.max_absences > 0 && c.absences >= c.max_absences) badgeClass = 'danger';
                                else if (c.absences >= 2) badgeClass = 'warning';

                                return `
                                    <div class="course-item-mini ${isCurrent ? 'active-course' : ''}">
                                        <span>
                                            ${isCurrent ? '👉 ' : ''}<strong>${c.course_code}</strong> 
                                            <span style="color: #64748b; font-size: 0.72rem;">(${c.class_name})</span>
                                        </span>
                                        <span class="badge-absence-pill ${badgeClass}">Vắng: ${c.absences}${maxStr}</span>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>

                    <!-- Hồ sơ Nợ môn -->
                    <div style="border-top: 1px dashed var(--border-color); padding-top: 10px; margin-top: 4px;">
                        <div class="panel-header" style="margin-bottom: 8px;">
                            <h4>📊 Hồ Sơ Nợ Môn (${debts.length})</h4>
                        </div>
                        ${this.renderDebtsHtml(debts, subjectsCache, record, subjectObj)}
                    </div>
                </div>

                <!-- CỘT 2: 📝 Nhận Xét Của GV Đứng Lớp & 🕒 Lịch Sử Chăm Sóc -->
                <div class="inline-panel-card">
                    <div class="instructor-remarks-section">
                        <div class="remarks-header">
                            <span>📝 Nhận Xét Của GV Đứng Lớp <small style="font-weight: normal; color: #6f42c1;">(Dùng chung mọi môn)</small> (<span id="remarkCount-${docId}">${remarks.length}</span>)</span>
                        </div>
                        <div class="remarks-list" id="remarksList-${docId}">
                            ${this.renderRemarksListHtml(remarks)}
                        </div>
                        <div class="remark-input-group">
                            <input type="text" class="input-new-remark" id="inpRemark-${docId}" placeholder="Thêm nhận xét về SV này (GV đứng lớp)...">
                            <button type="button" class="btn-submit-remark" id="btnSendRemark-${docId}" onclick="window.handleAddInstructorRemark('${studentId}', '${rawCourseCode}', '${docId}');">💬 Gửi</button>
                        </div>
                    </div>

                    <div class="panel-header" style="margin-top: 4px;">
                        <h4>🕒 Lịch Sử Chăm Sóc (<span id="careLogCount-${docId}">0</span>)</h4>
                    </div>
                    <div class="care-logs-list" id="careLogsList-${docId}">
                        <div style="text-align: center; padding: 15px; color: var(--text-secondary); font-size: 0.8rem;">
                            Đang tải lịch sử...
                        </div>
                    </div>
                </div>

                <!-- CỘT 3: 🎯 Tác Vụ Chăm Sóc (Interactive Form) -->
                <div class="inline-panel-card">
                    <div class="panel-header">
                        <h4>📝 Ghi Nhận Kết Quả Chăm Sóc</h4>
                    </div>
                    <form onsubmit="window.handleSaveCareForm(event, '${docId}', '${studentId}', '${rawCourseCode}', '${record.semester}');">
                        <div class="form-group">
                            <label for="inpContactStatus-${docId}">Tình trạng liên lạc <span style="color: red;">*</span></label>
                            <select class="form-control" id="inpContactStatus-${docId}" required>
                                <option value="Chưa liên lạc" ${contactStatus === 'Chưa liên lạc' ? 'selected' : ''}>Chưa liên lạc</option>
                                <option value="Đã liên lạc" ${contactStatus === 'Đã liên lạc' ? 'selected' : ''}>Đã liên lạc</option>
                                <option value="Không nghe máy" ${contactStatus === 'Không nghe máy' ? 'selected' : ''}>Không nghe máy</option>
                                <option value="Sai số điện thoại" ${contactStatus === 'Sai số điện thoại' ? 'selected' : ''}>Sai số điện thoại</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label for="inpCareStatus-${docId}">Tình trạng chăm sóc <span style="color: red;">*</span></label>
                            <select class="form-control" id="inpCareStatus-${docId}" required>
                                <option value="">-- Chọn tình trạng chăm sóc --</option>
                                <option value="Đã đi học" ${careStatus === 'Đã đi học' ? 'selected' : ''}>Đã đi học</option>
                                <option value="Sẽ đi học" ${careStatus === 'Sẽ đi học' ? 'selected' : ''}>Sẽ đi học</option>
                                <option value="Nghỉ học kỳ" ${careStatus === 'Nghỉ học kỳ' ? 'selected' : ''}>Nghỉ học kỳ</option>
                                <option value="Lý do khác" ${careStatus === 'Lý do khác' ? 'selected' : ''}>Lý do khác</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>🎯 Nguyên nhân gốc rễ <small style="font-weight: normal; color: var(--text-secondary);">(Chọn nhiều mục nếu có)</small></label>
                            <div class="root-cause-chips-container" id="rootCausesContainer-${docId}">
                                ${ROOT_CAUSES.map(rc => {
                                    const existingCauses = Array.isArray(record.root_causes) ? record.root_causes : [];
                                    const isChecked = existingCauses.includes(rc.id) || existingCauses.includes(rc.label);
                                    return `
                                        <label class="root-cause-chip chip-${rc.id} ${isChecked ? 'active' : ''}">
                                            <input type="checkbox" name="root_cause_${docId}" value="${rc.id}" ${isChecked ? 'checked' : ''} onchange="this.closest('.root-cause-chip').classList.toggle('active', this.checked);">
                                            <span>${rc.label}</span>
                                        </label>
                                    `;
                                }).join('')}
                            </div>
                        </div>


                        <div class="form-group">
                            <label for="inpCareNotes-${docId}">Ghi chú chi tiết</label>
                            <textarea class="form-control" id="inpCareNotes-${docId}" placeholder="Nhập tóm tắt nội dung trao đổi...">${notes}</textarea>
                        </div>

                        <button type="submit" class="btn-save-care-result" id="btnSave-${docId}">
                            💾 Lưu Kết Quả Chăm Sóc
                        </button>
                    </form>
                </div>
            </div>
        `;
    }


    /**
     * Render danh sách môn nợ kèm phân loại thông minh (Tiên quyết trực tiếp & Vừa nợ kỳ trước)
     */
    static renderDebtsHtml(debts, subjectsCache, record = {}, subjectObj = null) {
        if (!debts || debts.length === 0) {
            return `<div style="color: #198754; font-size: 0.82rem; margin-top: 4px;">✅ Sinh viên hiện không nợ môn nào.</div>`;
        }

        // 1. Trích xuất danh sách môn tiên quyết của môn hiện tại
        const currentPrereqs = [];
        if (subjectObj && subjectObj.prerequisites) {
            const rawPrereqs = Array.isArray(subjectObj.prerequisites) 
                ? subjectObj.prerequisites 
                : subjectObj.prerequisites.split(',').map(s => s.trim().toUpperCase());
            rawPrereqs.forEach(p => {
                if (p) currentPrereqs.push(p.toUpperCase().trim());
            });
        }

        // 2. Danh sách môn vừa nợ kỳ trước
        const recentDebts = Array.isArray(record.recent_debts_list) ? record.recent_debts_list : [];

        let html = '<div class="debts-container">';
        debts.forEach(d => {
            const rawCode = ((typeof d === 'string') ? d : (d.course_code || d.code || '')).trim().toUpperCase();
            if (!rawCode) return;

            const sub = SubjectService.findSubjectData(rawCode) || (subjectsCache ? subjectsCache.get(rawCode) : null);
            const courseName = sub && sub.course_name ? sub.course_name : '';

            const isDirectPrereq = currentPrereqs.includes(rawCode);
            const isRecent = recentDebts.includes(rawCode);
            const isGeneralPrereq = sub && sub.is_prerequisite;

            if (isDirectPrereq) {
                html += `<span class="debt-badge-prerequisite" title="Môn điều kiện tiên quyết của môn ${record.course_code || ''}! ${courseName ? `(${courseName})` : ''}">🔗 ${rawCode} (Tiên Quyết Môn Này)</span>`;
            } else if (isRecent) {
                html += `<span class="debt-badge-recent" title="Sinh viên vừa bị điểm F ở kỳ liền kề trước! ${courseName ? `(${courseName})` : ''}">⚡ ${rawCode} (Vừa Nợ Kỳ Trước)</span>`;
            } else if (isGeneralPrereq) {
                html += `<span class="debt-badge-prerequisite" title="Môn tiên quyết trong chương trình đào tạo: ${courseName}">⚡ ${rawCode} (Tiên Quyết)</span>`;
            } else {
                html += `<span class="debt-badge-normal" title="${courseName ? `${rawCode}: ${courseName}` : rawCode}">⚠️ ${rawCode}</span>`;
            }
        });
        html += '</div>';
        return html;
    }

    /**
     * Render danh sách nhận xét của GV đứng lớp
     */
    static renderRemarksListHtml(remarks) {
        if (!remarks || remarks.length === 0) {
            return `<div style="color: var(--text-secondary); font-size: 0.78rem; padding: 4px 0;">Chưa có nhận xét nào từ GV đứng lớp.</div>`;
        }

        return remarks.map(r => `
            <div class="remark-item">
                <div class="remark-meta">
                    <span class="remark-author">👤 ${r.teacher_id || 'GV'} ${r.course_code ? `(${r.course_code})` : ''}</span>
                    <span>🕒 ${formatDateTime(r.created_at)}</span>
                </div>
                <div class="remark-text">${r.note || ''}</div>
            </div>
        `).join('');
    }
}
