// admin_redemption.js — 掃碼兌換作業（多筆批量）
window.Rd = (function () {
    const _redeemTargetMember = { lock: null };
    let _batchRedeemList = [];
    let _redemptionShowAll = false;
    let _debounceT = null;

    function resetBatchRedeem() {
        _redeemTargetMember.lock = null;
        _batchRedeemList = [];
        renderBatchRedeemTable();
        document.getElementById('brStep2').classList.add('hidden');
        document.getElementById('brMemberScanner').disabled = false;
        document.getElementById('brMemberScanner').value = '';
        document.getElementById('brItemScanner').value = '';
    }

    function updateBrBalanceDisplay(usedPts) {
        const el = document.getElementById('brRunningBalance');
        if (!el || !_redeemTargetMember.lock) return;
        const balance = _redeemTargetMember.lock.points;
        const remaining = balance - usedPts;
        if (usedPts === 0) {
            el.innerHTML = `帳戶餘額：<strong style="color:#065f46;">${balance.toLocaleString()}</strong> 點`;
        } else if (remaining >= 0) {
            el.innerHTML = `帳戶餘額：${balance.toLocaleString()} 點 → 兌換後剩 <strong style="color:#065f46;">${remaining.toLocaleString()}</strong> 點`;
        } else {
            el.innerHTML = `帳戶餘額：${balance.toLocaleString()} 點 → <strong style="color:var(--danger);">超出 ${Math.abs(remaining).toLocaleString()} 點</strong>`;
        }
    }

    function renderBatchRedeemTable() {
        const tbody    = document.getElementById('brTableBody');
        const ts       = document.getElementById('brTableSection');
        const sum      = document.getElementById('brSummarySection');
        const sub      = document.getElementById('batchRedeemSubmitBtn');
        const warn     = document.getElementById('brPointsWarning');
        const clearRow = document.getElementById('brClearAllRow');
        tbody.innerHTML = '';

        if (_batchRedeemList.length === 0) {
            ts.classList.add('hidden');
            sum.classList.add('hidden');
            sub.classList.add('hidden');
            warn.classList.add('hidden');
            clearRow.classList.add('hidden');
            updateBrBalanceDisplay(0);
            return;
        }

        ts.classList.remove('hidden');
        sum.classList.remove('hidden');
        sub.classList.remove('hidden');
        clearRow.classList.remove('hidden');
        let totalPts = 0;

        // 預先計算每個條碼的掃描次數，避免每列重新 filter
        const scanCountByBarcode = _batchRedeemList.reduce((m, x) => {
            m[x.barcode] = (m[x.barcode] || 0) + 1;
            return m;
        }, {});

        _batchRedeemList.forEach((r, idx) => {
            totalPts += r.pointsCost;
            const remainingQty = r.quantity - scanCountByBarcode[r.barcode];
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><code>${escapeHtml(r.barcode)}</code></td>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td><span style="font-size:0.85rem; color:${remainingQty <= 0 ? 'var(--danger)' : 'var(--text-secondary)'};">還剩 ${remainingQty} 件</span></td>
                <td><span style="color:var(--danger);">-${r.pointsCost}</span></td>
                <td><button type="button" class="btn btn-sm btn-danger br-del" data-idx="${idx}">移除</button></td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('brTotalCount').textContent = _batchRedeemList.length;
        document.getElementById('brTotalPoints').textContent = totalPts;
        updateBrBalanceDisplay(totalPts);

        const memberBalance = _redeemTargetMember.lock.points;
        const shortage = totalPts - memberBalance;
        if (shortage > 0) {
            warn.classList.remove('hidden');
            warn.innerHTML = `⚠️ 點數不足！清單共需 <strong>${totalPts.toLocaleString()}</strong> 點，帳戶餘額僅 <strong>${memberBalance.toLocaleString()}</strong> 點，尚缺 <strong>${shortage.toLocaleString()}</strong> 點。請移除部分項目後再送出。`;
            document.getElementById('brTotalPoints').style.color = 'var(--danger)';
            sub.disabled = true;
            sub.style.background = '#d1d5db';
        } else {
            warn.classList.add('hidden');
            document.getElementById('brTotalPoints').style.color = 'var(--danger)';
            sub.disabled = false;
            sub.style.background = 'var(--primary-color)';
        }
    }

    function renderHistory() {
        const search  = document.getElementById('redemptionSearchInput').value.trim().toLowerCase();
        const members = getMembers();
        const all     = getRedemptions().sort((a, b) => new Date(b.date) - new Date(a.date));

        const filtered = all.filter(r => {
            if (!search) return true;
            const m = members.find(x => x.id === r.memberId);
            const name = m ? m.name.toLowerCase() : r.memberId.toLowerCase();
            return name.includes(search) || r.itemName.toLowerCase().includes(search);
        });

        const display = _redemptionShowAll ? filtered : filtered.slice(0, 15);
        const tb = document.getElementById('redemptionTableBody');

        tb.innerHTML = display.map(r => {
            const m   = members.find(x => x.id === r.memberId);
            const cat = Core.resolveCategory(r);
            const cc  = Core.getCatColor(cat);
            return `<tr>
                <td><small style="color:var(--text-secondary)">${escapeHtml(r.id)}</small></td>
                <td>${Core.fmtDisp(r.date)}</td>
                <td><strong>${escapeHtml(m ? m.name : r.memberId)}</strong></td>
                <td>${escapeHtml(r.itemName)} <span class="badge" style="background:${cc.bg};color:${cc.text};margin-left:0.4rem;">${escapeHtml(cat)}</span></td>
                <td><span style="color:var(--danger);">-${r.pointsCost}</span></td>
            </tr>`;
        }).join('');

        document.getElementById('redemptionCountInfo').textContent =
            search ? `搜尋結果：顯示 ${display.length} / ${filtered.length} 筆` :
            _redemptionShowAll ? `共 ${filtered.length} 筆` : `顯示最近 ${display.length} 筆（共 ${filtered.length} 筆）`;
    }

    function init() {
        document.getElementById('brTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('.br-del');
            if (!btn) return;
            _batchRedeemList.splice(parseInt(btn.dataset.idx), 1);
            renderBatchRedeemTable();
            document.getElementById('brItemScanner').focus();
        });

        document.getElementById('brClearAllBtn').addEventListener('click', () => {
            if (!confirm(`確定要清空清單中的 ${_batchRedeemList.length} 件物品嗎？`)) return;
            _batchRedeemList = [];
            renderBatchRedeemTable();
            document.getElementById('brItemScanner').focus();
        });

        document.getElementById('startRedeemBtn').addEventListener('click', () => {
            resetBatchRedeem();
            Core.openModal('batchRedeemModal');
            setTimeout(() => document.getElementById('brMemberScanner').focus(), 100);
        });

        document.getElementById('brMemberScanner').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const val = e.target.value.trim();
                const m = getMembers().find(x => x.barcode === val || x.id === val || x.phone === val);
                if (!m) { Core.toast('查無此會員', 'error'); e.target.value = ''; return; }
                if (m.status === 'expired') { Core.toast('過期會員無法兌換', 'error'); e.target.value = ''; return; }
                _redeemTargetMember.lock = m;
                e.target.disabled = true;
                document.getElementById('brStep2').classList.remove('hidden');
                document.getElementById('brMemberDisplay').innerHTML = `🛒 ${escapeHtml(m.name)}`;
                updateBrBalanceDisplay(0);
                setTimeout(() => document.getElementById('brItemScanner').focus(), 50);
            }
        });

        document.getElementById('brChangeMemberBtn').addEventListener('click', () => {
            _redeemTargetMember.lock = null;
            _batchRedeemList = [];
            document.getElementById('brStep2').classList.add('hidden');
            const mInput = document.getElementById('brMemberScanner');
            mInput.disabled = false;
            mInput.value = '';
            mInput.focus();
            renderBatchRedeemTable();
        });

        document.getElementById('brItemScanner').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const code = e.target.value.trim();
                e.target.value = '';
                if (!code) return;
                clearTimeout(_debounceT);
                _debounceT = setTimeout(() => {
                    const i = getInventory().find(x => x.barcode === code);
                    if (!i) { Core.toast('查無此物品條碼', 'error'); return; }
                    const existsCount = _batchRedeemList.filter(x => x.barcode === code).length;
                    if (existsCount + 1 > i.quantity) {
                        Core.toast(`【${i.name}】庫存不足`, 'error'); return;
                    }
                    _batchRedeemList.push(i);
                    renderBatchRedeemTable();
                }, 50);
            }
        });

        document.getElementById('redemptionSearchInput').addEventListener('input', renderHistory);
        document.getElementById('toggleShowAllRedemptions').addEventListener('click', () => {
            _redemptionShowAll = !_redemptionShowAll;
            document.getElementById('toggleShowAllRedemptions').textContent = _redemptionShowAll ? '只顯示最近 15 筆' : '顯示全部';
            renderHistory();
        });

        // 送出核銷
        document.getElementById('batchRedeemForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const member = _redeemTargetMember.lock;
            const totalPts = _batchRedeemList.reduce((sum, item) => sum + item.pointsCost, 0);
            if (member.points < totalPts) return;

            const redemptions = getRedemptions();
            const inventory   = getInventory();
            const members     = getMembers();
            const invByBarcode = new Map(inventory.map(i => [i.barcode, i]));

            const maxRId = redemptions.reduce((max, r) => {
                const n = parseInt(r.id.replace(/\D/g, ''), 10) || 0;
                return n > max ? n : max;
            }, 0);
            let baseId = maxRId;

            _batchRedeemList.forEach(item => {
                const invItem = invByBarcode.get(item.barcode);
                if (!invItem) return;
                // FEFO 扣 1 件（自動使用最早到期批號）
                if (window.Inv && typeof Inv.deductOne === 'function') {
                    Inv.deductOne(invItem);
                } else {
                    invItem.quantity -= 1;
                }
                baseId++;
                redemptions.push({
                    id: 'R' + String(baseId).padStart(3, '0'),
                    memberId: member.id,
                    itemBarcode: item.barcode,
                    itemName: item.name,
                    category: item.category,
                    pointsCost: item.pointsCost,
                    date: new Date().toISOString()
                });
                logPointChange(member.id, member.name, -item.pointsCost, 'redeem', `兌換：${item.name}`);
            });

            const memIdx = members.findIndex(x => x.id === member.id);
            members[memIdx].points -= totalPts;

            saveInventory(inventory);
            saveRedemptions(redemptions);
            saveMembers(members);
            logAdminAction('REDEMPTION_BATCH', `${member.id} ${member.name}`, `${_batchRedeemList.length} 件、扣 ${totalPts} 點`);

            resetBatchRedeem();
            Core.closeModal('batchRedeemModal');
            renderHistory();
            if (window.Dash) Dash.render();
            if (window.Inv)  Inv.render();
            if (window.Mem)  Mem.render();
        });
    }

    function intercept_batchRedeemModal() {
        if (_batchRedeemList.length > 0) {
            return confirm(`清單中有 ${_batchRedeemList.length} 件物品尚未完成核銷，確定要關閉嗎？`);
        }
        return true;
    }

    return { init, renderHistory, intercept_batchRedeemModal };
})();
