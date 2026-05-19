document.addEventListener('DOMContentLoaded', () => {
    const loginSection = document.getElementById('loginSection');
    const firstLoginSection = document.getElementById('firstLoginSection');
    const memberSection = document.getElementById('memberSection');

    // 條碼 RWD：依視窗寬度動態調整 width，避免長條碼在手機被截斷
    let _currentBarcodeValue = null;
    function renderMemberBarcode(barcodeStr) {
        const vw = window.innerWidth;
        const width = vw < 480 ? 1.2 : vw < 768 ? 1.6 : 2;
        JsBarcode('#memberBarcode', barcodeStr, {
            format: 'CODE128',
            width,
            height: 60,
            displayValue: true,
            margin: 0
        });
    }
    let _resizeBarcodeT = null;
    window.addEventListener('resize', () => {
        clearTimeout(_resizeBarcodeT);
        _resizeBarcodeT = setTimeout(() => {
            if (_currentBarcodeValue && !memberSection.classList.contains('hidden')) {
                renderMemberBarcode(_currentBarcodeValue);
            }
        }, 150);
    });
    
    // Login
    const loginForm = document.getElementById('loginForm');
    const phoneInput = document.getElementById('phoneInput');
    const passwordInput = document.getElementById('passwordInput');
    const loginError = document.getElementById('loginError');
    
    // First Login
    const firstLoginForm = document.getElementById('firstLoginForm');
    let tempFirstLoginUser = null;

    // View Switching
    const navItems = document.querySelectorAll('.nav-item');
    const sectionIds = ['dashboardView', 'profileView'];

    navItems.forEach(nav => {
        nav.addEventListener('click', (e) => {
            navItems.forEach(n => n.classList.remove('active'));
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            if (targetId) {
                sectionIds.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.toggle('hidden', id !== targetId);
                });
            }
        });
    });

    // Check Session
    const currentUserTemp = JSON.parse(sessionStorage.getItem('currentClientUser'));
    if (currentUserTemp) {
        showMemberSection(currentUserTemp.id);
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const phone = phoneInput.value.trim();
        const pwd = passwordInput.value.trim();
        const submitBtn = loginForm.querySelector('button[type="submit"]');

        submitBtn.disabled = true;
        loginError.style.display = 'none';

        try {
        // 隱藏版管理員驗證
        const adminRes = await loginAdmin(phone, pwd);
        if (adminRes && adminRes.success) {
            const token = await createAdminSession(adminRes.admin);
            sessionStorage.setItem('adminToken', token);
            logAdminAction('LOGIN_SUCCESS', adminRes.admin.username, '從會員登入頁登入');
            window.location.href = 'admin.html';
            return;
        }

        const result = await loginUser(phone, pwd);

        if (!result.success) {
            loginError.textContent = result.msg;
            loginError.style.display = 'block';
            phoneInput.focus();
            submitBtn.disabled = false;
            return;
        }

        if (result.isFirstLogin) {
            tempFirstLoginUser = result.user;
            loginSection.classList.add('hidden');
            firstLoginSection.classList.remove('hidden');
        } else {
            sessionStorage.setItem('currentClientUser', JSON.stringify({ id: result.user.id }));
            showMemberSection(result.user.id);
        }
        } finally {
            submitBtn.disabled = false;
        }
    });

    firstLoginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('setupPassword').value;
        const bday = document.getElementById('setupBirthday').value;
        const addr = document.getElementById('setupAddress').value;

        const members = getMembers();
        const idx = members.findIndex(m => m.id === tempFirstLoginUser.id);
        if (idx !== -1) {
            members[idx].password = await hashPasswordSalted(pwd);
            members[idx].birthday = bday;
            members[idx].address = addr;
            members[idx].isFirstLogin = false;
            saveMembers(members);

            sessionStorage.setItem('currentClientUser', JSON.stringify({ id: members[idx].id }));
            firstLoginSection.classList.add('hidden');
            showMemberSection(members[idx].id);
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        sessionStorage.removeItem('currentClientUser');
        _currentBarcodeValue = null;
        memberSection.classList.add('hidden');
        firstLoginSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
        loginForm.reset();
        loginError.style.display = 'none';
        
        // Reset view to dashboard
        document.querySelector('[data-target="dashboardView"]').click();
    });

    function showMemberSection(userId) {
        const user = getMembers().find(m => m.id === userId);
        if (!user || user.status === 'expired') {
            document.getElementById('logoutBtn').click();
            return;
        }

        loginSection.classList.add('hidden');
        firstLoginSection.classList.add('hidden');
        memberSection.classList.remove('hidden');

        // Dashboard Info
        document.getElementById('welcomeUser').textContent = `歡迎，${user.name}`;
        document.getElementById('userPoints').textContent = user.points.toLocaleString();
        
        // Generate Barcode（依視窗寬度自適應）
        _currentBarcodeValue = user.barcode;
        renderMemberBarcode(user.barcode);

        // Profile Info
        document.getElementById('profileName').value = user.name;
        document.getElementById('profilePhone').value = user.phone;
        document.getElementById('profileBirthday').value = user.birthday || '';
        document.getElementById('profileAddress').value = user.address || '';
        document.getElementById('profilePassword').value = '';

        renderHistory(user.id);
    }

    document.getElementById('profileForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userTemp = JSON.parse(sessionStorage.getItem('currentClientUser'));
        if (!userTemp) return;

        const members = getMembers();
        const idx = members.findIndex(m => m.id === userTemp.id);
        if (idx !== -1) {
            const pwd = document.getElementById('profilePassword').value.trim();
            if (pwd) members[idx].password = await hashPasswordSalted(pwd);
            members[idx].birthday = document.getElementById('profileBirthday').value;
            members[idx].address = document.getElementById('profileAddress').value;
            saveMembers(members);
            
            const successMsg = document.getElementById('profileSuccess');
            successMsg.style.display = 'block';
            setTimeout(() => { successMsg.style.display = 'none'; }, 3000);
        }
    });

    function renderHistory(memberId) {
        const history = getRedemptions().filter(r => r.memberId === memberId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('userRedemptionHistory');
        tbody.innerHTML = '';
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color: var(--text-secondary);">尚無兌換紀錄</td></tr>';
            return;
        }

        history.forEach(record => {
            const dateStr = new Date(record.date).toLocaleDateString();
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${dateStr}</td>
                <td>${escapeHtml(record.itemName)}</td>
                <td style="color: var(--danger); font-weight: 500;">-${record.pointsCost}</td>
            `;
            tbody.appendChild(tr);
        });
    }
});
