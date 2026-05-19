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

    // 條碼全螢幕：點條碼卡片時開啟黑底大條碼，方便給工作人員掃描
    function showFullscreenBarcode(barcodeStr) {
        const overlay = document.createElement('div');
        overlay.id = 'barcodeFullscreenOverlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:#000; z-index:9999; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:1rem; cursor:pointer;';
        overlay.innerHTML = `
            <div style="background:#fff; padding:1.5rem 2rem; border-radius:12px; max-width:95vw; max-height:80vh; overflow:auto;">
                <svg id="fullscreenBarcode"></svg>
            </div>
            <div style="color:#fff; margin-top:2rem; font-size:1.05rem; opacity:0.85; text-align:center;">點任意處或按 ESC 關閉</div>
        `;
        document.body.appendChild(overlay);

        // 放大版條碼參數：寬度與字體都加大
        const vw = window.innerWidth;
        const width = vw < 480 ? 2.5 : vw < 768 ? 3.5 : 4;
        JsBarcode('#fullscreenBarcode', barcodeStr, {
            format: 'CODE128',
            width,
            height: 140,
            displayValue: true,
            fontSize: 22,
            margin: 0
        });

        // 嘗試進入全螢幕（部分瀏覽器 / iOS Safari 不支援，失敗時保留 overlay 即可）
        if (overlay.requestFullscreen) {
            overlay.requestFullscreen().catch(() => {});
        }

        const close = () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch(() => {});
            }
            document.removeEventListener('keydown', onKey, true);
            overlay.remove();
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        };
        overlay.addEventListener('click', close);
        document.addEventListener('keydown', onKey, true);
    }
    
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
    const sectionIds = ['dashboardView', 'pointsHistoryView', 'profileView'];

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

    // 條碼卡片點擊 → 全螢幕
    document.getElementById('barcodeCard').addEventListener('click', () => {
        if (_currentBarcodeValue) showFullscreenBarcode(_currentBarcodeValue);
    });

    // 點數異動明細：月份篩選
    initPointsMonthFilter();
    document.getElementById('pointsMonthFilter').addEventListener('change', () => {
        const u = JSON.parse(sessionStorage.getItem('currentClientUser') || 'null');
        if (u) renderPointsHistory(u.id);
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
        renderPointsHistory(user.id);
    }

    // 動態填入近 12 個月的選項（第一個＝當月，自動成為預設值）
    function initPointsMonthFilter() {
        const sel = document.getElementById('pointsMonthFilter');
        if (!sel) return;
        const now = new Date();
        const opts = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = d.getMonth() + 1;
            const val = `${y}-${String(m).padStart(2, '0')}`;
            opts.push(`<option value="${val}">${y} 年 ${m} 月</option>`);
        }
        sel.innerHTML = opts.join('');
    }

    function renderPointsHistory(memberId) {
        const filterEl = document.getElementById('pointsMonthFilter');
        if (!filterEl || !filterEl.value) return;
        const filter = filterEl.value;

        const all = getPointsLog().filter(e => e.memberId === memberId);

        const [y, m] = filter.split('-').map(Number);
        const log = all.filter(e => {
            const d = new Date(e.date);
            return d.getFullYear() === y && d.getMonth() + 1 === m;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));
        const filterDesc = `${y} 年 ${m} 月`;

        // 統計卡片：依篩選結果計算
        let totalTopup = 0, totalDeduct = 0;
        let redeemPoints = 0, redeemCount = 0;
        log.forEach(e => {
            if (e.delta > 0) totalTopup += e.delta;
            else totalDeduct += Math.abs(e.delta);
            if (e.type === 'redeem') {
                redeemPoints += Math.abs(e.delta);
                redeemCount++;
            }
        });

        document.getElementById('userTotalTopup').textContent = '+' + totalTopup.toLocaleString();
        document.getElementById('userTotalDeduct').textContent = '-' + totalDeduct.toLocaleString();
        document.getElementById('userTotalChanges').textContent = log.length.toLocaleString();

        // 標籤改為反映篩選範圍 + 兌換數量提示
        document.getElementById('userTopupLabel').textContent = `${filterDesc}補點 / 發放`;
        document.getElementById('userDeductLabel').textContent = `${filterDesc}扣點 / 兌換`;
        document.getElementById('userChangesLabel').textContent = `${filterDesc}異動次數`;

        const info = document.getElementById('pointsFilterInfo');
        if (info) {
            info.textContent = redeemCount > 0
                ? `共 ${log.length} 筆異動，其中兌換 ${redeemCount} 件、消耗 ${redeemPoints.toLocaleString()} 點`
                : `共 ${log.length} 筆異動`;
        }

        const tbody = document.getElementById('userPointsHistory');
        if (log.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">${filterDesc}內尚無點數異動紀錄</td></tr>`;
            return;
        }

        const typeLabel = { init: '初始發放', topup: '補點', deduct: '扣點', redeem: '兌換核銷' };
        const typeBadgeStyle = {
            init:   'background:#dbeafe; color:#1e40af;',
            topup:  'background:#d1fae5; color:#065f46;',
            deduct: 'background:#fef3c7; color:#92400e;',
            redeem: 'background:#fee2e2; color:#991b1b;'
        };

        tbody.innerHTML = log.map(e => {
            const d = new Date(e.date);
            const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const sign = e.delta > 0 ? '+' : '';
            const color = e.delta > 0 ? 'var(--success)' : 'var(--danger)';

            // 兌換物品：優先取 itemName 欄位；舊資料 fallback 從 note 內 "兌換：xxx" 解析
            let itemName = e.itemName || '';
            let noteDisplay = e.note || '';
            if (!itemName && e.type === 'redeem' && noteDisplay) {
                const m = noteDisplay.match(/^兌換[:：]\s*(.+)$/);
                if (m) { itemName = m[1]; noteDisplay = ''; }
            }
            const itemCell = itemName
                ? `<strong>${escapeHtml(itemName)}</strong>`
                : '<span style="color:var(--text-secondary);">—</span>';

            return `<tr>
                <td><small style="color:var(--text-secondary)">${dateStr}</small></td>
                <td>${itemCell}</td>
                <td><strong style="color:${color};">${sign}${e.delta}</strong></td>
                <td><span class="badge" style="${typeBadgeStyle[e.type] || 'background:#f1f5f9;color:#64748b;'}">${typeLabel[e.type] || escapeHtml(e.type)}</span></td>
                <td style="color:var(--text-secondary); font-size:0.875rem;">${escapeHtml(noteDisplay)}</td>
            </tr>`;
        }).join('');
    }

    document.getElementById('profileForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userTemp = JSON.parse(sessionStorage.getItem('currentClientUser'));
        if (!userTemp) return;

        const errMsg     = document.getElementById('profileError');
        const successMsg = document.getElementById('profileSuccess');
        errMsg.style.display = 'none';
        successMsg.style.display = 'none';
        const showError = (msg) => { errMsg.textContent = msg; errMsg.style.display = 'block'; };

        const members = getMembers();
        const idx = members.findIndex(m => m.id === userTemp.id);
        if (idx === -1) { showError('找不到會員資料，請重新登入'); return; }

        const newPwd = document.getElementById('profilePassword').value;
        const curPwd = document.getElementById('profileCurrentPassword').value;

        // 只有要改密碼時才驗證目前密碼
        if (newPwd) {
            if (!curPwd) { showError('要修改密碼，請先輸入目前密碼以驗證身份'); return; }
            if (newPwd.length < 6) { showError('新密碼至少需要 6 個字元'); return; }
            const { match } = await verifyStoredPassword(curPwd, members[idx].password);
            if (!match) { showError('目前密碼錯誤，無法更新密碼'); return; }
            members[idx].password = await hashPasswordSalted(newPwd);
        }

        members[idx].birthday = document.getElementById('profileBirthday').value;
        members[idx].address  = document.getElementById('profileAddress').value;
        saveMembers(members);

        // 清掉密碼欄位避免殘留
        document.getElementById('profilePassword').value = '';
        document.getElementById('profileCurrentPassword').value = '';

        successMsg.style.display = 'block';
        setTimeout(() => { successMsg.style.display = 'none'; }, 3000);
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
