// admin_data.js — 資料管理（CSV 匯出/清除歷史/操作審計）+ 管理員管理
window.DataMgr = (function () {
    let _pendingClearJob = null;
    let _auditShowAll = false;

    const AUDIT_ACTION_LABELS = {
        LOGIN_SUCCESS: '登入',
        LOGOUT: '登出',
        ADMIN_CREATE: '新增管理員',
        ADMIN_UPDATE: '編輯管理員',
        ADMIN_DELETE: '刪除管理員',
        ADMIN_PWD_CHANGE: '修改自己密碼',
        MEMBER_CREATE: '新增會員',
        MEMBER_UPDATE: '編輯會員',
        MEMBER_PWD_RESET: '會員密碼還原',
        MEMBER_BATCH_TOPUP: '批量補/扣點',
        MEMBER_IMPORT: '匯入會員',
        INV_UPDATE: '編輯庫存',
        INV_BATCH_INBOUND: '批量入庫',
        INV_IMPORT: '匯入庫存',
        INV_BATCH_CREATE: '新增批號',
        INV_BATCH_UPDATE: '調整批號',
        INV_BATCH_DELETE: '刪除批號',
        CAT_CREATE: '新增分類',
        CAT_DELETE: '刪除分類',
        REDEMPTION_BATCH: '掃碼核銷',
        DATA_CLEAR_HISTORY: '清除歷史資料',
    };

    function getAuditActionLabel(code) { return AUDIT_ACTION_LABELS[code] || code; }

    function inDateRange(isoStr, start, end) {
        const t = new Date(isoStr).getTime();
        return t >= start && t <= end;
    }

    // ===== 清除歷史 =====
    function computeClearPreview() {
        const startVal = document.getElementById('clearStartDate').value;
        const endVal   = document.getElementById('clearEndDate').value;
        if (!startVal || !endVal) return null;

        const start = new Date(startVal + 'T00:00:00').getTime();
        const end   = new Date(endVal   + 'T23:59:59.999').getTime();
        if (start > end) return null;

        const doRedemptions  = document.getElementById('clearRedemptions').checked;
        const doPointsLog    = document.getElementById('clearPointsLog').checked;
        const doInventoryLog = document.getElementById('clearInventoryLog').checked;
        const doAuditLog     = document.getElementById('clearAuditLog').checked;
        if (!doRedemptions && !doPointsLog && !doInventoryLog && !doAuditLog) return null;

        const counts = {};
        if (doRedemptions)  counts.redemptions  = getRedemptions().filter(r => inDateRange(r.date, start, end)).length;
        if (doPointsLog)    counts.pointsLog    = getPointsLog().filter(e => inDateRange(e.date, start, end)).length;
        if (doInventoryLog) counts.inventoryLog = getInventoryLog().filter(e => inDateRange(e.date, start, end)).length;
        if (doAuditLog)     counts.auditLog     = getAuditLog().filter(e => inDateRange(e.date, start, end)).length;

        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        return { start, end, startVal, endVal, doRedemptions, doPointsLog, doInventoryLog, doAuditLog, counts, total };
    }

    // ===== 操作審計紀錄 =====
    function refreshAuditFilters() {
        const log = getAuditLog();
        const adminSel  = document.getElementById('auditFilterAdmin');
        const actionSel = document.getElementById('auditFilterAction');
        if (!adminSel || !actionSel) return;

        const prevAdmin = adminSel.value;
        const prevAction = actionSel.value;

        const usernames = [...new Set(log.map(e => e.adminUsername))].sort();
        adminSel.innerHTML = '<option value="">全部</option>' +
            usernames.map(u => `<option value="${escapeHtml(u)}" ${u === prevAdmin ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('');

        const actions = [...new Set(log.map(e => e.action))].sort();
        actionSel.innerHTML = '<option value="">全部</option>' +
            actions.map(a => `<option value="${escapeHtml(a)}" ${a === prevAction ? 'selected' : ''}>${escapeHtml(getAuditActionLabel(a))}</option>`).join('');
    }

    function getFilteredAudit() {
        const startVal = document.getElementById('auditFilterStart').value;
        const endVal   = document.getElementById('auditFilterEnd').value;
        const fAdmin   = document.getElementById('auditFilterAdmin').value;
        const fAction  = document.getElementById('auditFilterAction').value;
        // #8 keyword 搜尋（target + detail + adminUsername + action label）
        const fKeyword = (document.getElementById('auditFilterKeyword').value || '').trim().toLowerCase();

        const start = startVal ? new Date(startVal + 'T00:00:00').getTime()      : -Infinity;
        const end   = endVal   ? new Date(endVal   + 'T23:59:59.999').getTime() : Infinity;

        return getAuditLog()
            .filter(e => {
                const t = new Date(e.date).getTime();
                if (t < start || t > end) return false;
                if (fAdmin && e.adminUsername !== fAdmin) return false;
                if (fAction && e.action !== fAction) return false;
                if (fKeyword) {
                    const hay = [
                        e.target || '', e.detail || '',
                        e.adminUsername || '', getAuditActionLabel(e.action || '')
                    ].join(' ').toLowerCase();
                    if (!hay.includes(fKeyword)) return false;
                }
                return true;
            })
            .sort((a, b) => new Date(b.date) - new Date(a.date));
    }

    function renderAuditLog() {
        if (!Core.isSuper()) return;
        refreshAuditFilters();
        const filtered = getFilteredAudit();
        document.getElementById('auditCountInfo').textContent = `共 ${filtered.length} 筆`;
        const display = _auditShowAll ? filtered : filtered.slice(0, 30);
        const tbody = document.getElementById('auditLogTableBody');
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">尚無符合條件的紀錄</td></tr>';
            return;
        }
        tbody.innerHTML = display.map(e => `<tr>
            <td><small style="color:var(--text-secondary);">${Core.fmtDisp(e.date)}</small></td>
            <td><strong>${escapeHtml(e.adminUsername)}</strong></td>
            <td><span class="badge" style="background:#eff6ff; color:#1e40af;">${escapeHtml(getAuditActionLabel(e.action))}</span></td>
            <td>${escapeHtml(e.target || '')}</td>
            <td style="color:var(--text-secondary); font-size:0.875rem;">${escapeHtml(e.detail || '')}</td>
        </tr>`).join('');
    }

    // ===== 管理員管理 =====
    function renderAdminManagePage() {
        if (Core.isSuper()) renderAdminList();
    }

    function renderAdminList() {
        const admins = getAdmins();
        const tbody = document.getElementById('adminListTableBody');
        const me = Core.getCurrent();
        const fmtLogin = (iso) => iso ? Core.fmtDisp(iso) : '尚未登入';

        tbody.innerHTML = admins.map(a => {
            const isMe = me && a.id === me.id;
            const roleBadge = a.role === 'super'
                ? '<span class="badge" style="background:#d1fae5; color:#065f46;">super</span>'
                : '<span class="badge" style="background:#e2e8f0; color:#475569;">staff</span>';
            const statusBadge = a.status === 'active'
                ? '<span class="badge badge-active">使用中</span>'
                : '<span class="badge badge-expired">停用</span>';
            return `<tr>
                <td>
                    <strong>${escapeHtml(a.username)}</strong>
                    ${isMe ? '<span style="color:var(--primary-color); font-size:0.75rem; margin-left:0.4rem;">（我）</span>' : ''}
                </td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td><small style="color:var(--text-secondary);">${fmtLogin(a.lastLoginAt)}</small></td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-sm btn-outline admin-edit-btn" data-id="${escapeHtml(a.id)}">編輯</button>
                    ${isMe ? '' : `<button class="btn btn-sm admin-del-btn" data-id="${escapeHtml(a.id)}" style="margin-left:0.4rem; background:var(--danger); color:white;">刪除</button>`}
                </td>
            </tr>`;
        }).join('');
    }

    function openAdminEditModal(adminId) {
        document.getElementById('adminEditError').style.display = 'none';
        document.getElementById('adminEditForm').reset();
        const pwdInput = document.getElementById('adminEditPassword');
        const pwdHint = document.getElementById('adminEditPwdHint');
        const pwdLabel = document.getElementById('adminEditPwdLabel');
        const statusSelect = document.getElementById('adminEditStatus');
        const usernameInput = document.getElementById('adminEditUsername');
        const me = Core.getCurrent();

        if (adminId) {
            const a = getAdmins().find(x => x.id === adminId);
            if (!a) return;
            document.getElementById('adminEditTitle').textContent = `編輯管理員：${a.username}`;
            document.getElementById('adminEditId').value = a.id;
            usernameInput.value = a.username;
            document.getElementById('adminEditRole').value = a.role;
            statusSelect.value = a.status;
            pwdLabel.textContent = '新密碼（留空表示不修改）';
            pwdInput.required = false;
            pwdInput.placeholder = '留空保留原密碼';
            pwdHint.style.display = 'block';
            const editingSelf = me && a.id === me.id;
            document.getElementById('adminEditRole').disabled = editingSelf;
            statusSelect.disabled = editingSelf;
        } else {
            document.getElementById('adminEditTitle').textContent = '新增管理員';
            document.getElementById('adminEditId').value = '';
            pwdLabel.textContent = '密碼（至少 6 字元）';
            pwdInput.required = true;
            pwdInput.placeholder = '至少 6 個字元';
            pwdHint.style.display = 'none';
            document.getElementById('adminEditRole').value = 'staff';
            statusSelect.value = 'active';
            document.getElementById('adminEditRole').disabled = false;
            statusSelect.disabled = false;
        }
        Core.openModal('adminEditModal');
        setTimeout(() => usernameInput.focus(), 50);
    }

    function init() {
        // ---- CSV 匯出 ----
        document.getElementById('exportMembersBtn').addEventListener('click', () => {
            const members = getMembers();
            const headers = ['會員ID','姓名','電話','狀態','剩餘點數','加入日期','生日','地址','條碼'];
            const rows = members.map(m => [
                m.id, m.name, m.phone,
                m.status === 'active' ? '使用中' : '已過期停權',
                m.points, m.joinDate || '', m.birthday || '', m.address || '', m.barcode
            ]);
            Core.downloadCsv(`會員清單_${Core.todayStr()}.csv`, headers, rows);
        });
        document.getElementById('exportRedemptionsBtn').addEventListener('click', () => {
            const members = getMembers();
            const rows = getRedemptions()
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map(r => {
                    const m = members.find(x => x.id === r.memberId);
                    return [r.id, Core.fmtDateTime(r.date), r.memberId, m ? m.name : r.memberId, r.itemBarcode || '', r.itemName, r.category || '', r.pointsCost];
                });
            Core.downloadCsv(`兌換紀錄_${Core.todayStr()}.csv`,
                ['交易序號','兌換時間','會員ID','會員姓名','物品條碼','物品名稱','分類','扣除點數'], rows);
        });
        document.getElementById('exportPointsLogBtn').addEventListener('click', () => {
            const typeLabels = { init: '初始發放', topup: '補點', deduct: '扣點', redeem: '兌換核銷' };
            const rows = getPointsLog()
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map(e => [e.id, Core.fmtDateTime(e.date), e.memberId, e.memberName || '', e.delta, typeLabels[e.type] || e.type, e.note || '']);
            Core.downloadCsv(`點數異動紀錄_${Core.todayStr()}.csv`,
                ['記錄ID','時間','會員ID','會員姓名','異動點數','類型','備註'], rows);
        });
        document.getElementById('exportInventoryLogBtn').addEventListener('click', () => {
            const rows = getInventoryLog()
                .sort((a, b) => new Date(a.date) - new Date(b.date))
                .map(e => [e.id, Core.fmtDateTime(e.date), e.barcode, e.itemName, e.delta, e.note || '']);
            Core.downloadCsv(`入庫歷史_${Core.todayStr()}.csv`,
                ['記錄ID','時間','條碼','品項名稱','入庫數量','備註'], rows);
        });
        document.getElementById('exportInventoryBtn').addEventListener('click', () => {
            // 含批號展開：若有 batches，每批號一列；否則一列即可
            const rows = [];
            getInventory().forEach(i => {
                if (Array.isArray(i.batches) && i.batches.length > 0) {
                    i.batches.forEach(b => rows.push([i.barcode, i.name, i.category || '', b.quantity, i.pointsCost, b.expiryDate || '', b.batchId || '']));
                } else {
                    rows.push([i.barcode, i.name, i.category || '', i.quantity, i.pointsCost, '', '']);
                }
            });
            Core.downloadCsv(`現有庫存_${Core.todayStr()}.csv`,
                ['條碼','名稱','分類','庫存量','預設點數','有效期','批號'], rows);
        });

        // ---- 清除歷史 ----
        document.getElementById('previewClearBtn').addEventListener('click', () => {
            const previewBox = document.getElementById('clearPreviewBox');
            const job = computeClearPreview();
            if (!job) {
                previewBox.classList.remove('hidden');
                previewBox.innerHTML = '<span style="color:var(--danger);">請選擇有效的日期區間，並至少勾選一種資料類型。</span>';
                _pendingClearJob = null;
                return;
            }
            _pendingClearJob = job;
            const lines = [];
            if (job.doRedemptions)  lines.push(`• 兌換紀錄：<strong>${job.counts.redemptions}</strong> 筆`);
            if (job.doPointsLog)    lines.push(`• 點數異動紀錄：<strong>${job.counts.pointsLog}</strong> 筆`);
            if (job.doInventoryLog) lines.push(`• 入庫歷史：<strong>${job.counts.inventoryLog}</strong> 筆`);
            if (job.doAuditLog)     lines.push(`• 操作審計紀錄：<strong>${job.counts.auditLog}</strong> 筆`);
            previewBox.classList.remove('hidden');
            previewBox.innerHTML = `
                <div style="font-weight:600; margin-bottom:0.4rem; color:#92400e;">📅 清除範圍：${job.startVal} 至 ${job.endVal}</div>
                ${lines.join('<br>')}
                <div style="margin-top:0.5rem; color:${job.total > 0 ? 'var(--danger)' : 'var(--success)'}; font-weight:600;">
                    ${job.total > 0 ? `共 ${job.total} 筆資料將被刪除` : '此區間內無符合條件的資料'}
                </div>`;
        });

        document.getElementById('confirmClearBtn').addEventListener('click', () => {
            if (!_pendingClearJob) { alert('請先按「預覽將刪除的筆數」確認範圍。'); return; }
            if (_pendingClearJob.total === 0) { alert('此區間內無符合條件的資料，無需清除。'); return; }
            const { counts, doRedemptions, doPointsLog, doInventoryLog, doAuditLog, startVal, endVal } = _pendingClearJob;
            document.getElementById('clearDataSummary').innerHTML = `
                <p>確定要清除以下資料嗎？<strong style="color:var(--danger);">此操作無法復原。</strong></p>
                <ul style="margin:0.75rem 0 0 1.25rem;">
                    ${doRedemptions  ? `<li>兌換紀錄：<strong>${counts.redemptions}</strong> 筆</li>` : ''}
                    ${doPointsLog    ? `<li>點數異動紀錄：<strong>${counts.pointsLog}</strong> 筆</li>` : ''}
                    ${doInventoryLog ? `<li>入庫歷史：<strong>${counts.inventoryLog}</strong> 筆</li>` : ''}
                    ${doAuditLog     ? `<li>操作審計紀錄：<strong>${counts.auditLog}</strong> 筆</li>` : ''}
                </ul>
                <p style="margin-top:0.75rem;">日期範圍：<strong>${startVal} ～ ${endVal}</strong></p>`;
            document.getElementById('clearConfirmInput').value = '';
            document.getElementById('executeClearBtn').disabled = true;
            Core.openModal('clearDataModal');
        });

        document.getElementById('cancelClearModalBtn').addEventListener('click', () => Core.closeModal('clearDataModal'));
        document.getElementById('clearConfirmInput').addEventListener('input', (e) => {
            document.getElementById('executeClearBtn').disabled = e.target.value !== '確認清除';
        });

        document.getElementById('executeClearBtn').addEventListener('click', () => {
            if (!Core.isSuper()) { alert('權限不足：僅 super 管理員可清除歷史資料'); return; }
            if (!_pendingClearJob) return;
            const { start, end, startVal, endVal, doRedemptions, doPointsLog, doInventoryLog, doAuditLog, counts } = _pendingClearJob;

            if (doRedemptions)  saveRedemptions(getRedemptions().filter(r => !inDateRange(r.date, start, end)));
            if (doPointsLog)    savePointsLog(getPointsLog().filter(e => !inDateRange(e.date, start, end)));
            if (doInventoryLog) saveInventoryLog(getInventoryLog().filter(e => !inDateRange(e.date, start, end)));
            if (doAuditLog)     saveAuditLog(getAuditLog().filter(e => !inDateRange(e.date, start, end)));

            const detailParts = [];
            if (doRedemptions)  detailParts.push(`兌換 ${counts.redemptions}`);
            if (doPointsLog)    detailParts.push(`點數 ${counts.pointsLog}`);
            if (doInventoryLog) detailParts.push(`入庫 ${counts.inventoryLog}`);
            if (doAuditLog)     detailParts.push(`審計 ${counts.auditLog}`);
            // 順序：在 saveAuditLog 之後寫，避免被剛剛刪到
            logAdminAction('DATA_CLEAR_HISTORY', `${startVal}~${endVal}`, detailParts.join('、'));

            _pendingClearJob = null;
            Core.closeModal('clearDataModal');
            document.getElementById('clearPreviewBox').classList.add('hidden');
            document.getElementById('clearStartDate').value = '';
            document.getElementById('clearEndDate').value   = '';

            if (window.Dash) Dash.render();
            if (window.Rd)   Rd.renderHistory();
            if (window.Inv)  Inv.renderInventoryLog();
            renderAuditLog();

            Core.toast('歷史資料清除完成');
        });

        // ---- 操作審計篩選與匯出 ----
        ['auditFilterStart','auditFilterEnd','auditFilterAdmin','auditFilterAction','auditFilterKeyword'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', renderAuditLog);
        });
        document.getElementById('toggleAuditLog').addEventListener('click', () => {
            _auditShowAll = !_auditShowAll;
            document.getElementById('toggleAuditLog').textContent = _auditShowAll ? '只顯示最近 30 筆' : '顯示全部';
            renderAuditLog();
        });
        document.getElementById('exportAuditLogBtn').addEventListener('click', () => {
            const rows = getFilteredAudit().map(e => [
                e.id, Core.fmtDateTime(e.date), e.adminId, e.adminUsername,
                e.action, getAuditActionLabel(e.action), e.target || '', e.detail || ''
            ]);
            Core.downloadCsv(`操作審計紀錄_${Core.todayStr()}.csv`,
                ['記錄ID','時間','管理員ID','管理員帳號','動作代碼','動作說明','對象','細節'], rows);
        });

        // ---- 管理員管理：開啟修改密碼 Modal ----
        document.getElementById('changeMyPwdBtn').addEventListener('click', () => {
            document.getElementById('changeAdminPwdForm').reset();
            document.getElementById('adminPwdError').style.display = 'none';
            document.getElementById('adminPwdSuccess').style.display = 'none';
            Core.openModal('changeMyPwdModal');
            setTimeout(() => document.getElementById('adminCurrentPwd').focus(), 50);
        });

        // ---- 管理員管理：改密碼 ----
        document.getElementById('changeAdminPwdForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const errEl = document.getElementById('adminPwdError');
            const okEl = document.getElementById('adminPwdSuccess');
            errEl.style.display = 'none';
            okEl.style.display = 'none';

            const currentPwd = document.getElementById('adminCurrentPwd').value;
            const newPwd     = document.getElementById('adminNewPwd').value;
            const confirmPwd = document.getElementById('adminConfirmPwd').value;
            const showError = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };
            if (newPwd !== confirmPwd) { showError('新密碼與確認密碼不一致'); return; }

            const me = Core.getCurrent();
            const admins = getAdmins();
            const idx = admins.findIndex(a => a.id === me.id);
            if (idx === -1) { showError('找不到目前管理員資料'); return; }

            let currentMatch;
            if (isHashed(admins[idx].password)) {
                currentMatch = admins[idx].password === await hashPassword(currentPwd);
            } else {
                currentMatch = admins[idx].password === currentPwd;
            }
            if (!currentMatch) { showError('目前密碼錯誤'); return; }

            admins[idx].password = await hashPassword(newPwd);
            saveAdmins(admins);
            logAdminAction('ADMIN_PWD_CHANGE', admins[idx].username, '修改自己密碼');

            document.getElementById('changeAdminPwdForm').reset();
            okEl.style.display = 'block';
            setTimeout(() => {
                Core.closeModal('changeMyPwdModal');
                okEl.style.display = 'none';
            }, 1500);
        });

        // ---- 管理員管理：列表 ----
        document.getElementById('addAdminBtn').addEventListener('click', () => {
            if (!Core.isSuper()) { alert('權限不足'); return; }
            openAdminEditModal(null);
        });
        document.getElementById('adminListTableBody').addEventListener('click', async (e) => {
            if (!Core.isSuper()) return;
            const editBtn = e.target.closest('.admin-edit-btn');
            const delBtn = e.target.closest('.admin-del-btn');
            if (editBtn) { openAdminEditModal(editBtn.dataset.id); return; }
            if (delBtn) {
                const id = delBtn.dataset.id;
                const admins = getAdmins();
                const target = admins.find(a => a.id === id);
                if (!target) return;
                const me = Core.getCurrent();
                if (target.id === me.id) { alert('無法刪除自己'); return; }
                const remainingSupers = admins.filter(a => a.role === 'super' && a.status === 'active' && a.id !== id).length;
                if (target.role === 'super' && remainingSupers === 0) {
                    alert('無法刪除最後一位 super 管理員'); return;
                }
                if (!confirm(`確定要刪除管理員「${target.username}」嗎？`)) return;
                const next = admins.filter(a => a.id !== id);
                saveAdmins(next);
                logAdminAction('ADMIN_DELETE', target.username, `刪除管理員（角色 ${target.role}）`);
                renderAdminList();
            }
        });

        // ---- 管理員編輯 Form ----
        document.getElementById('adminEditForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!Core.isSuper()) { alert('權限不足'); return; }
            const errEl = document.getElementById('adminEditError');
            const showError = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };
            errEl.style.display = 'none';

            const id = document.getElementById('adminEditId').value;
            const username = document.getElementById('adminEditUsername').value.trim();
            const password = document.getElementById('adminEditPassword').value;
            const role = document.getElementById('adminEditRole').value;
            const status = document.getElementById('adminEditStatus').value;
            const me = Core.getCurrent();

            if (!username) { showError('帳號名稱不可為空'); return; }
            if (!id && (!password || password.length < 6)) { showError('密碼至少 6 個字元'); return; }
            if (password && password.length < 6) { showError('密碼至少 6 個字元'); return; }

            const admins = getAdmins();
            if (admins.some(a => a.username === username && a.id !== id)) {
                showError('此帳號名稱已被使用'); return;
            }

            if (id) {
                const idx = admins.findIndex(a => a.id === id);
                if (idx === -1) { showError('找不到管理員'); return; }
                const before = { ...admins[idx] };
                const wouldLoseLastSuper = before.role === 'super' && before.status === 'active' && (role !== 'super' || status !== 'active');
                if (wouldLoseLastSuper) {
                    const otherActiveSupers = admins.filter(a => a.id !== id && a.role === 'super' && a.status === 'active').length;
                    if (otherActiveSupers === 0) { showError('無法降級或停用最後一位 active super 管理員'); return; }
                }
                admins[idx].username = username;
                admins[idx].role = (id === me.id) ? before.role : role;
                admins[idx].status = (id === me.id) ? before.status : status;
                if (password) admins[idx].password = await hashPassword(password);
                saveAdmins(admins);

                const detailParts = [];
                if (before.username !== username) detailParts.push(`改名 ${before.username} → ${username}`);
                if (before.role !== admins[idx].role) detailParts.push(`角色 ${before.role} → ${admins[idx].role}`);
                if (before.status !== admins[idx].status) detailParts.push(`狀態 ${before.status} → ${admins[idx].status}`);
                if (password) detailParts.push('重設密碼');
                logAdminAction('ADMIN_UPDATE', username, detailParts.join('、') || '無變更');
            } else {
                const maxNum = admins.reduce((max, a) => {
                    const n = parseInt(String(a.id).replace(/\D/g, ''), 10) || 0;
                    return n > max ? n : max;
                }, 0);
                const newId = 'A' + String(maxNum + 1).padStart(3, '0');
                admins.push({
                    id: newId, username,
                    password: await hashPassword(password),
                    role, status,
                    createdAt: new Date().toISOString(),
                    lastLoginAt: null
                });
                saveAdmins(admins);
                logAdminAction('ADMIN_CREATE', username, `角色 ${role}、狀態 ${status}`);
            }
            Core.closeModal('adminEditModal');
            renderAdminList();
            if (id && me && id === me.id) Core.renderCurrentAdminBadge();
        });
    }

    return { init, renderAuditLog, renderAdminList, renderAdminManagePage };
})();
