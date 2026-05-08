// admin_members.js — 會員管理：列表、行內編輯、新增、密碼還原、批量補點、CSV 匯入、兌換紀錄 Modal
window.Mem = (function () {
    let _memEditState   = {};
    let _memOriginalPts = {};
    let _selectedMemberIds = new Set();
    let _importClassified = null;

    function syncMemSaveBarTops() {
        const batchBar = document.getElementById('memBatchBar');
        const saveBar  = document.getElementById('memSaveBar');
        const batchVisible = !batchBar.classList.contains('hidden');
        saveBar.style.top = batchVisible ? (batchBar.offsetHeight + 'px') : '';
    }

    function updateBatchBar() {
        const count = _selectedMemberIds.size;
        document.getElementById('memBatchBar').classList.toggle('hidden', count === 0);
        document.getElementById('memBatchCount').textContent = count;
        const allIds = getMembers().map(m => m.id);
        const cb = document.getElementById('selectAllMembers');
        if (cb) {
            const allSel  = allIds.length > 0 && allIds.every(id => _selectedMemberIds.has(id));
            const noneSel = allIds.every(id => !_selectedMemberIds.has(id));
            cb.checked       = allSel;
            cb.indeterminate = !allSel && !noneSel;
        }
        syncMemSaveBarTops();
    }

    function updateSaveBar() {
        const count = Object.keys(_memEditState).length;
        document.getElementById('memSaveBar').classList.toggle('hidden', count === 0);
        document.getElementById('memEditCount').textContent = count;
        syncMemSaveBarTops();
    }

    function render() {
        const members = getMembers();
        const search  = document.getElementById('memSearchInput').value.trim().toLowerCase();
        const tbody   = document.getElementById('membersTableBody');
        tbody.innerHTML = '';

        members.filter(m => {
            if (search && !m.name.toLowerCase().includes(search) && !m.phone.includes(search) && !m.barcode.toLowerCase().includes(search)) return false;
            return true;
        }).forEach(m => {
            const isEditing = !!_memEditState[m.id];
            const d       = isEditing ? _memEditState[m.id] : m;
            const mid     = escapeHtml(m.id);
            const checked = _selectedMemberIds.has(m.id) ? 'checked' : '';
            const cbCell  = `<td style="text-align:center;"><input type="checkbox" class="mem-cb" data-id="${mid}" style="width:auto;" ${checked}></td>`;
            const tr      = document.createElement('tr');
            if (isEditing) tr.classList.add('editing-row');
            tr.innerHTML = isEditing ? `
                ${cbCell}
                <td><code>${escapeHtml(m.barcode)}</code></td>
                <td><input  type="text"   class="mem-field" data-id="${mid}" data-field="name"   value="${escapeHtml(d.name)}"></td>
                <td><input  type="text"   class="mem-field" data-id="${mid}" data-field="phone"  value="${escapeHtml(d.phone)}"></td>
                <td><select               class="mem-field" data-id="${mid}" data-field="status">
                    <option value="active"  ${d.status === 'active'  ? 'selected' : ''}>使用中</option>
                    <option value="expired" ${d.status === 'expired' ? 'selected' : ''}>已過期</option>
                </select></td>
                <td><input  type="number" class="mem-field" data-id="${mid}" data-field="points" value="${d.points}" min="0" style="width:90px;"></td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-sm btn-outline mem-cancel-btn" data-id="${mid}">取消</button>
                    <button class="btn btn-sm btn-outline mem-hist-btn"   data-id="${mid}" style="margin-left:0.4rem;">紀錄</button>
                </td>
            ` : `
                ${cbCell}
                <td><code>${escapeHtml(m.barcode)}</code></td>
                <td><strong>${escapeHtml(m.name)}</strong></td>
                <td>${escapeHtml(m.phone)}</td>
                <td>${m.status === 'active' ? '<span class="badge badge-active">使用中</span>' : '<span class="badge badge-expired">已過期</span>'}</td>
                <td><span style="color:var(--primary-color)">${m.points.toLocaleString()}</span></td>
                <td style="white-space:nowrap;">
                    <button class="btn btn-sm btn-outline mem-edit-btn"  data-id="${mid}">編輯</button>
                    <button class="btn btn-sm reset-pwd-btn" data-id="${mid}" data-phone="${escapeHtml(m.phone)}" style="margin-left:0.4rem; background:#f59e0b;">密碼還原</button>
                    <button class="btn btn-sm btn-outline mem-hist-btn"  data-id="${mid}" style="margin-left:0.4rem;">紀錄</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ===== 兌換紀錄 Modal =====
    function openMemberHistoryModal(memberId) {
        const m = getMembers().find(x => x.id === memberId);
        if (!m) return;
        document.getElementById('memberHistoryTitle').textContent = `${m.name} 的兌換紀錄`;

        const history = getRedemptions()
            .filter(r => r.memberId === memberId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('memberHistoryTableBody');
        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">尚無兌換紀錄</td></tr>';
        } else {
            tbody.innerHTML = history.map(r => {
                const cat = Core.resolveCategory(r);
                const cc  = Core.getCatColor(cat);
                return `<tr>
                    <td>${Core.fmtDisp(r.date)}</td>
                    <td>${escapeHtml(r.itemName)}</td>
                    <td><span class="badge" style="background:${cc.bg};color:${cc.text};">${escapeHtml(cat)}</span></td>
                    <td><span style="color:var(--danger);">-${r.pointsCost}</span></td>
                </tr>`;
            }).join('');
        }
        Core.openModal('memberHistoryModal');
    }

    // ===== CSV 匯入 =====
    function classifyImportRows(rows, mode) {
        const existing  = getMembers();
        const byId      = Object.fromEntries(existing.map(m => [m.id,    m]));
        const byPhone   = Object.fromEntries(existing.map(m => [m.phone, m]));
        const usedIds   = new Set(existing.map(m => m.id));
        const csvPhones = new Set();
        const csvIds    = new Set();

        let maxIdNum = existing.reduce((max, m) => {
            const n = parseInt(m.id.replace(/\D/g, ''), 10);
            return n > max ? n : max;
        }, 0);

        function nextId() {
            let id;
            do { maxIdNum++; id = 'M' + String(maxIdNum).padStart(3, '0'); } while (usedIds.has(id));
            return id;
        }

        return rows.map(row => {
            const name     = (row['姓名']     || '').trim();
            const phone    = (row['電話']     || '').trim();
            const rawId    = (row['會員ID']   || '').trim();
            const rawBc    = (row['條碼']     || '').trim();
            const status   = row['狀態'] === '已過期停權' ? 'expired' : 'active';
            const points   = Math.max(0, parseInt(row['剩餘點數'], 10) || 0);
            const joinDate = (row['加入日期'] || '').trim() || new Date().toISOString().split('T')[0];
            const birthday = (row['生日']     || '').trim();
            const address  = (row['地址']     || '').trim();

            const err = (reason) => ({ row, action: 'error', reason });
            if (!name)  return err('缺少必要欄位：姓名');
            if (!phone) return err('缺少必要欄位：電話');
            if (csvPhones.has(phone)) return err('CSV 內電話重複');
            if (rawId && csvIds.has(rawId)) return err('CSV 內會員ID重複');

            const phoneOwner = byPhone[phone];
            if (phoneOwner && phoneOwner.id !== rawId)
                return err(`電話已被其他會員（${phoneOwner.id}）使用`);

            csvPhones.add(phone);
            if (rawId) csvIds.add(rawId);

            if (rawId && byId[rawId]) {
                if (mode === 'upsert') {
                    const orig  = byId[rawId];
                    const delta = points - orig.points;
                    return {
                        row, action: 'update',
                        reason: delta !== 0 ? `點數 ${delta > 0 ? '+' : ''}${delta}` : '資料更新',
                        member: { ...orig, name, phone, status, points, birthday, address,
                                  barcode: rawBc || orig.barcode }
                    };
                }
                return { row, action: 'skip', reason: '會員ID已存在（跳過模式）' };
            }
            let newId = (rawId && !usedIds.has(rawId)) ? rawId : nextId();
            usedIds.add(newId);
            const barcode = rawBc || `${newId}-${phone}`;
            const note    = rawId && rawId !== newId ? `原 ID ${rawId} 衝突，已指派為 ${newId}` : '';
            return {
                row, action: 'add', reason: note,
                member: { id: newId, name, phone, password: '', isFirstLogin: true,
                          points, joinDate, birthday, address, status, barcode }
            };
        });
    }

    function renderImportPreview(classified) {
        const counts = { add: 0, update: 0, skip: 0, error: 0 };
        classified.forEach(r => counts[r.action]++);
        const parts = [];
        if (counts.add)    parts.push(`<span style="color:var(--success);font-weight:600;">✅ 新增 ${counts.add} 筆</span>`);
        if (counts.update) parts.push(`<span style="color:var(--primary-color);font-weight:600;">🔄 更新 ${counts.update} 筆</span>`);
        if (counts.skip)   parts.push(`<span style="color:var(--text-secondary);font-weight:600;">⏭️ 跳過 ${counts.skip} 筆</span>`);
        if (counts.error)  parts.push(`<span style="color:var(--danger);font-weight:600;">❌ 錯誤 ${counts.error} 筆</span>`);
        document.getElementById('importSummary').innerHTML =
            `<div style="display:flex;gap:1.25rem;flex-wrap:wrap;margin-bottom:0.75rem;">${parts.join('')}</div>`;

        const STYLE = {
            add:    { label: '新增', bg: '#d1fae5', color: '#065f46' },
            update: { label: '更新', bg: '#dbeafe', color: '#1e40af' },
            skip:   { label: '跳過', bg: '#f1f5f9', color: '#64748b' },
            error:  { label: '錯誤', bg: '#fee2e2', color: '#991b1b' },
        };

        const tbody = document.getElementById('importPreviewBody');
        tbody.innerHTML = classified.map(item => {
            const s     = STYLE[item.action];
            const id    = item.member?.id    || item.row['會員ID'] || '—';
            const name  = item.member?.name  || item.row['姓名']   || '—';
            const phone = item.member?.phone || item.row['電話']   || '—';
            const pts   = item.member != null ? item.member.points : (item.row['剩餘點數'] || '—');
            return `<tr>
                <td><span class="badge" style="background:${s.bg};color:${s.color};">${s.label}</span></td>
                <td><code>${escapeHtml(String(id))}</code></td>
                <td>${escapeHtml(String(name))}</td>
                <td>${escapeHtml(String(phone))}</td>
                <td>${escapeHtml(String(pts))}</td>
                <td style="font-size:0.8rem;color:${item.action === 'error' ? 'var(--danger)' : 'var(--text-secondary)'};">${escapeHtml(item.reason || '')}</td>
            </tr>`;
        }).join('');

        const canImport = counts.add + counts.update > 0;
        const btn = document.getElementById('importConfirmBtn');
        btn.classList.toggle('hidden', !canImport);
        if (canImport) btn.textContent = `確認匯入 ${counts.add + counts.update} 筆`;
    }

    function showImportError(msg) {
        const el = document.getElementById('importError');
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    function runImportParse() {
        const file = document.getElementById('importFileInput').files[0];
        if (!file) return;
        const errEl     = document.getElementById('importError');
        const previewEl = document.getElementById('importPreviewSection');
        errEl.classList.add('hidden');
        previewEl.classList.add('hidden');
        document.getElementById('importConfirmBtn').classList.add('hidden');
        _importClassified = null;

        const reader = new FileReader();
        reader.onerror = () => showImportError('讀取檔案失敗，請重試。');
        reader.onload  = (e) => {
            let rows;
            try { rows = Core.parseCsvText(e.target.result); }
            catch (err) { showImportError('解析 CSV 失敗：' + err.message); return; }
            if (rows === null)   { showImportError('CSV 格式錯誤：需包含標題列與至少一筆資料。'); return; }
            if (rows.length === 0) { showImportError('CSV 內無任何資料列（僅含標題）。'); return; }

            const missing = ['姓名', '電話'].filter(h => !(h in rows[0]));
            if (missing.length) {
                showImportError(`CSV 缺少必要欄位：${missing.join('、')}。請確認使用「會員清單」匯出的標準格式。`);
                return;
            }
            const mode = document.querySelector('input[name="importMode"]:checked').value;
            _importClassified = classifyImportRows(rows, mode);
            renderImportPreview(_importClassified);
            previewEl.classList.remove('hidden');
        };
        reader.readAsText(file, 'UTF-8');
    }

    // ===== 批量補點預覽 =====
    function updateBatchTopupPreview() {
        const amount = parseInt(document.getElementById('batchTopupAmount').value, 10);
        const preview = document.getElementById('batchTopupPreview');
        if (isNaN(amount) || amount === 0) { preview.classList.add('hidden'); return; }
        const members = getMembers().filter(m => _selectedMemberIds.has(m.id));
        const lines = members.map(m => {
            const newPts = Math.max(0, m.points + amount);
            const delta  = newPts - m.points;
            const sign   = delta >= 0 ? '+' : '';
            return `${escapeHtml(m.name)}：${m.points} → <strong>${newPts}</strong>（${sign}${delta}）`;
        });
        preview.classList.remove('hidden');
        preview.innerHTML = `<div style="font-weight:600; margin-bottom:0.4rem;">異動預覽</div>${lines.join('<br>')}`;
    }

    function init() {
        // 搜尋
        document.getElementById('memSearchInput').addEventListener('input', render);

        // 全選
        document.getElementById('selectAllMembers').addEventListener('change', (e) => {
            getMembers().forEach(m => e.target.checked ? _selectedMemberIds.add(m.id) : _selectedMemberIds.delete(m.id));
            render();
            updateBatchBar();
        });

        // 清除選取
        document.getElementById('memBatchClearBtn').addEventListener('click', () => {
            _selectedMemberIds.clear();
            render();
            updateBatchBar();
        });

        // 開啟批量補點 Modal
        document.getElementById('memBatchTopupBtn').addEventListener('click', () => {
            if (_selectedMemberIds.size === 0) return;
            if (Object.keys(_memEditState).length > 0) {
                if (!confirm('有會員資料尚未儲存，批量補點將套用至已儲存的資料。確定繼續嗎？')) return;
            }
            const names = getMembers().filter(m => _selectedMemberIds.has(m.id)).map(m => escapeHtml(m.name));
            document.getElementById('batchTopupInfo').innerHTML =
                `將對以下 <strong>${names.length}</strong> 位會員執行點數異動：<br>
                <span style="color:var(--text-secondary);">${names.join('、')}</span>`;
            document.getElementById('batchTopupForm').reset();
            document.getElementById('batchTopupError').style.display = 'none';
            document.getElementById('batchTopupPreview').classList.add('hidden');
            Core.openModal('batchTopupModal');
        });

        document.getElementById('batchTopupAmount').addEventListener('input', updateBatchTopupPreview);

        // 批量補點送出
        document.getElementById('batchTopupForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const errEl  = document.getElementById('batchTopupError');
            const amount = parseInt(document.getElementById('batchTopupAmount').value, 10);
            const note   = document.getElementById('batchTopupNote').value.trim();
            errEl.style.display = 'none';
            if (isNaN(amount) || amount === 0) { errEl.textContent = '請輸入有效的點數數量（不可為 0）'; errEl.style.display = 'block'; return; }
            if (!note) { errEl.textContent = '請填寫異動原因'; errEl.style.display = 'block'; return; }

            const members  = getMembers();
            const type     = amount > 0 ? 'topup' : 'deduct';
            const affected = _selectedMemberIds.size;
            _selectedMemberIds.forEach(id => {
                const idx = members.findIndex(m => m.id === id);
                if (idx === -1) return;
                const newPts     = Math.max(0, members[idx].points + amount);
                const actualDelta = newPts - members[idx].points;
                members[idx].points = newPts;
                logPointChange(id, members[idx].name, actualDelta, type, `批量${amount > 0 ? '補點' : '扣點'}：${note}`);
            });
            saveMembers(members);
            logAdminAction('MEMBER_BATCH_TOPUP', `${affected} 位會員`, `${amount > 0 ? '+' : ''}${amount} 點：${note}`);
            _selectedMemberIds.clear();
            Core.closeModal('batchTopupModal');
            render();
            updateBatchBar();
            if (window.Dash) Dash.render();
            Core.toast(`已完成批量${amount > 0 ? '補點' : '扣點'}，影響 ${affected} 位會員`);
        });

        // 行內編輯儲存全部
        document.getElementById('memSaveAllBtn').addEventListener('click', () => {
            const members = getMembers();
            const editedIds = Object.keys(_memEditState);
            Object.entries(_memEditState).forEach(([id, data]) => {
                const idx = members.findIndex(m => m.id === id);
                if (idx === -1) return;
                const origPts = _memOriginalPts[id] ?? members[idx].points;
                if (data.points !== origPts) {
                    logPointChange(id, members[idx].name, data.points - origPts, data.points > origPts ? 'topup' : 'deduct', '管理員列表直接編輯');
                }
                members[idx].name   = data.name;
                members[idx].phone  = data.phone;
                members[idx].points = data.points;
                members[idx].status = data.status;
            });
            saveMembers(members);
            logAdminAction('MEMBER_UPDATE', editedIds.join(','), `行內編輯會員 ${editedIds.length} 筆`);
            _memEditState = {};
            _memOriginalPts = {};
            render();
            updateSaveBar();
            if (window.Dash) Dash.render();
        });

        document.getElementById('memCancelAllBtn').addEventListener('click', () => {
            _memEditState = {};
            _memOriginalPts = {};
            render();
            updateSaveBar();
        });

        // 列表事件委派
        document.getElementById('membersTableBody').addEventListener('click', async (e) => {
            const editBtn   = e.target.closest('.mem-edit-btn');
            const cancelBtn = e.target.closest('.mem-cancel-btn');
            const resetBtn  = e.target.closest('.reset-pwd-btn');
            const histBtn   = e.target.closest('.mem-hist-btn');
            if (editBtn) {
                const m = getMembers().find(x => x.id === editBtn.dataset.id);
                if (!m) return;
                _memOriginalPts[m.id] = m.points;
                _memEditState[m.id]   = { name: m.name, phone: m.phone, points: m.points, status: m.status };
                updateSaveBar();
                render();
            } else if (cancelBtn) {
                delete _memEditState[cancelBtn.dataset.id];
                delete _memOriginalPts[cancelBtn.dataset.id];
                updateSaveBar();
                render();
            } else if (resetBtn) {
                if (confirm('確定要將此會員的密碼還原為他的手機號嗎？')) {
                    const mlist  = getMembers();
                    const target = mlist.find(x => x.id === resetBtn.dataset.id);
                    target.password    = await hashPassword(resetBtn.dataset.phone);
                    target.isFirstLogin = false;
                    saveMembers(mlist);
                    logAdminAction('MEMBER_PWD_RESET', `${target.id} ${target.name}`, `密碼還原為手機號`);
                    Core.toast(`已重設密碼為手機號：${resetBtn.dataset.phone}`);
                }
            } else if (histBtn) {
                openMemberHistoryModal(histBtn.dataset.id);
            }
        });
        document.getElementById('membersTableBody').addEventListener('change', (e) => {
            const cb = e.target.closest('.mem-cb');
            if (cb) {
                cb.checked ? _selectedMemberIds.add(cb.dataset.id) : _selectedMemberIds.delete(cb.dataset.id);
                updateBatchBar();
                return;
            }
            const field = e.target.closest('.mem-field');
            if (!field) return;
            const id = field.dataset.id, fn = field.dataset.field;
            if (!_memEditState[id]) return;
            _memEditState[id][fn] = fn === 'points' ? (parseInt(field.value, 10) || 0) : field.value;
        });

        // 新增會員
        document.getElementById('addMemberBtn').addEventListener('click', () => {
            document.getElementById('memModalTitle').textContent = '新增會員';
            document.getElementById('memberForm').reset();
            document.getElementById('memEditOnlySection').classList.add('hidden');
            Core.openModal('memberModal');
        });
        document.getElementById('memberForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const name    = document.getElementById('memName').value.trim();
            const phone   = document.getElementById('memPhone').value.trim();
            const members = getMembers();
            const maxNum  = members.reduce((max, m) => {
                const n = parseInt(m.id.replace(/\D/g, ''), 10);
                return n > max ? n : max;
            }, 0);
            const nextId = 'M' + String(maxNum + 1).padStart(3, '0');
            members.push({
                id: nextId, name, phone, password: '', isFirstLogin: true,
                points: 1000, joinDate: new Date().toISOString().split('T')[0],
                birthday: '', address: '', status: 'active', barcode: nextId + '-' + phone
            });
            logPointChange(nextId, name, 1000, 'init', '新會員初始點數');
            saveMembers(members);
            logAdminAction('MEMBER_CREATE', `${nextId} ${name}`, `電話 ${phone}、初始點數 1000`);
            render();
            if (window.Dash) Dash.render();
            Core.closeModal('memberModal');
        });

        // CSV 匯入
        document.getElementById('importMembersBtn').addEventListener('click', () => {
            document.getElementById('importFileInput').value = '';
            document.getElementById('importError').classList.add('hidden');
            document.getElementById('importPreviewSection').classList.add('hidden');
            document.getElementById('importConfirmBtn').classList.add('hidden');
            document.querySelector('input[name="importMode"][value="add"]').checked = true;
            _importClassified = null;
            Core.openModal('memberImportModal');
        });
        document.getElementById('importCancelBtn').addEventListener('click', () => Core.closeModal('memberImportModal'));
        document.getElementById('importFileInput').addEventListener('change', runImportParse);
        document.querySelectorAll('input[name="importMode"]').forEach(r =>
            r.addEventListener('change', () => {
                if (document.getElementById('importFileInput').files.length) runImportParse();
            })
        );
        document.getElementById('importConfirmBtn').addEventListener('click', () => {
            if (!_importClassified) return;
            const members = getMembers();
            let addCount = 0, updateCount = 0;
            _importClassified.forEach(item => {
                if (item.action === 'add') {
                    members.push(item.member);
                    if (item.member.points > 0)
                        logPointChange(item.member.id, item.member.name, item.member.points, 'init', '批量匯入初始點數');
                    addCount++;
                } else if (item.action === 'update') {
                    const idx = members.findIndex(m => m.id === item.member.id);
                    if (idx === -1) return;
                    const delta = item.member.points - members[idx].points;
                    if (delta !== 0)
                        logPointChange(item.member.id, item.member.name, delta,
                            delta > 0 ? 'topup' : 'deduct', '批量匯入更新點數');
                    members[idx] = item.member;
                    updateCount++;
                }
            });
            saveMembers(members);
            const importMode = document.querySelector('input[name="importMode"]:checked').value;
            logAdminAction('MEMBER_IMPORT', `新增 ${addCount}、更新 ${updateCount}`, `模式：${importMode === 'add' ? '僅新增' : '覆蓋更新'}`);
            _importClassified = null;
            Core.closeModal('memberImportModal');
            render();
            updateBatchBar();
            if (window.Dash) Dash.render();
            Core.toast(`匯入完成：新增 ${addCount} 筆、更新 ${updateCount} 筆`);
        });
    }

    return { init, render, updateBatchBar };
})();
