import { auth, provider, signInWithPopup, onAuthStateChanged, signOut, db, collection, query, where, getDocs } from './firebase-init.js';

// DOM Elements
const btnLogin = document.getElementById('btnGoogleLogin');
const loginLoader = document.getElementById('loginLoader');
const errorMessage = document.getElementById('errorMessage');

// Xử lý sự kiện đăng nhập
if (btnLogin) {
    btnLogin.addEventListener('click', async () => {
        try {
            // Hiển thị loading
            btnLogin.style.display = 'none';
            loginLoader.style.display = 'block';
            errorMessage.style.display = 'none';

            // Gọi Firebase Auth
            const result = await signInWithPopup(auth, provider);
            const user = result.user;
            const email = user.email;

            // Kiểm tra phân quyền trong bảng Teachers
            const q = query(collection(db, "Teachers"), where("email", "==", email));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                // Không có trong hệ thống -> Bị chặn
                await signOut(auth);
                showError('Tài khoản của bạn không có quyền truy cập hệ thống.');
                return;
            }

            // Lấy thông tin user
            let userData = null;
            let teacherId = null;
            querySnapshot.forEach((doc) => {
                userData = doc.data();
                teacherId = doc.id;
            });

            // Lưu thông tin phiên đăng nhập
            const sessionData = {
                uid: user.uid,
                email: email,
                name: userData.full_name || user.displayName,
                role: userData.system_role || 'Teacher',
                teacher_id: teacherId
            };
            
            localStorage.setItem('sc_session', JSON.stringify(sessionData));

            // Chuyển hướng về trang chủ
            window.location.href = 'index.html';

        } catch (error) {
            console.error("Lỗi đăng nhập:", error);
            showError('Đăng nhập thất bại: ' + error.message);
        }
    });
}

function showError(msg) {
    if(btnLogin) btnLogin.style.display = 'flex';
    if(loginLoader) loginLoader.style.display = 'none';
    if(errorMessage) {
        errorMessage.innerText = msg;
        errorMessage.style.display = 'block';
    }
}

// Danh sách Email Super Admin Cố Định (Zero-Cost Hardened Whitelist)
const SUPER_ADMIN_EMAILS = [
    'phamhaan@fe.edu.vn',
    'phamhaan@gmail.com',
    'anph21@fpt.edu.vn',
    'anph21@fe.edu.vn'
];

// Hàm kiểm tra trạng thái đăng nhập & phân quyền bảo mật nhiều lớp
export function checkAuth(requiredRoles = []) {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, async (user) => {
            if (!user) {
                window.location.href = 'login.html';
                reject('Not logged in');
                return;
            }

            const currentEmail = (user.email || '').toLowerCase();
            const isTrueSuperAdmin = SUPER_ADMIN_EMAILS.includes(currentEmail);

            let sessionRaw = localStorage.getItem('sc_session');
            let sessionData = null;

            if (sessionRaw) {
                try {
                    sessionData = JSON.parse(sessionRaw);
                } catch (e) {
                    sessionData = null;
                }
            }

            // 1. Kiểm tra phát hiện thao túng Session (Anti-Tampering Check)
            if (!sessionData || !sessionData.email) {
                // Nếu chưa có session -> Nạp trực tiếp từ CSDL Teachers
                sessionData = await syncSessionFromDatabase(user);
            } else if (sessionData.email.toLowerCase() !== currentEmail) {
                // Nếu email trong session khác email đăng nhập Google thật
                if (!isTrueSuperAdmin) {
                    console.warn("⚠️ Phát hiện sai lệch danh tính session. Đang đồng bộ lại vai trò gốc...");
                    sessionData = await syncSessionFromDatabase(user);
                }
            } else if ((sessionData.role === 'Super Admin' || sessionData.role === 'Admin') && !isTrueSuperAdmin) {
                // Nếu tài khoản thường cố tình F12 nâng role lên Super Admin -> Kiểm tra lại từ Server
                sessionData = await syncSessionFromDatabase(user);
            }

            if (!sessionData) {
                await signOut(auth);
                window.location.href = 'login.html';
                reject('Unable to verify user session');
                return;
            }

            // 2. Kiểm tra quyền truy cập trang (RBAC Gate)
            if (requiredRoles.length > 0 && !requiredRoles.includes(sessionData.role)) {
                alert(`⛔ Bạn không có quyền truy cập trang này. (Yêu cầu: ${requiredRoles.join(' / ')})`);
                window.location.href = 'index.html';
                reject('Insufficient permissions');
                return;
            }

            resolve(sessionData);
        });
    });
}

/**
 * Đồng bộ vai trò thực tế từ collection Teachers về LocalStorage
 */
async function syncSessionFromDatabase(user) {
    try {
        const email = user.email.toLowerCase();
        const q = query(collection(db, "Teachers"), where("email", "==", email));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert('Tài khoản của bạn không tồn tại trong danh mục Giảng viên.');
            return null;
        }

        let userData = null;
        let teacherId = null;
        querySnapshot.forEach((docSnap) => {
            userData = docSnap.data();
            teacherId = docSnap.id;
        });

        // Xác định role thực tế
        let realRole = userData.system_role || 'Teacher';
        if (SUPER_ADMIN_EMAILS.includes(email)) {
            realRole = 'Super Admin';
        }

        const sessionData = {
            uid: user.uid,
            email: user.email,
            name: userData.full_name || user.displayName,
            role: realRole,
            teacher_id: teacherId
        };

        localStorage.setItem('sc_session', JSON.stringify(sessionData));
        return sessionData;

    } catch (e) {
        console.error("Lỗi đồng bộ session:", e);
        return null;
    }
}

// Hàm Đăng xuất
export async function logout() {
    await signOut(auth);
    localStorage.removeItem('sc_session');
    window.location.href = 'login.html';
}

