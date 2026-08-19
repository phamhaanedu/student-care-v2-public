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

// Hàm kiểm tra trạng thái đăng nhập cho các trang được bảo vệ (sẽ gọi ở index.html)
export function checkAuth(requiredRoles = []) {
    return new Promise((resolve, reject) => {
        onAuthStateChanged(auth, (user) => {
            if (!user) {
                window.location.href = 'login.html';
                reject('Not logged in');
                return;
            }

            const sessionRaw = localStorage.getItem('sc_session');
            if (!sessionRaw) {
                signOut(auth);
                window.location.href = 'login.html';
                reject('No session data');
                return;
            }

            const sessionData = JSON.parse(sessionRaw);
            
            if (requiredRoles.length > 0 && !requiredRoles.includes(sessionData.role)) {
                // Không đủ quyền
                alert('Bạn không có quyền truy cập trang này.');
                window.location.href = 'index.html'; // Về trang chủ an toàn
                reject('Insufficient permissions');
                return;
            }

            resolve(sessionData);
        });
    });
}

// Hàm Đăng xuất
export async function logout() {
    await signOut(auth);
    localStorage.removeItem('sc_session');
    window.location.href = 'login.html';
}
