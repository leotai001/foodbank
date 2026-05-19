// admin_dashboard.js — 資料統計（全覽 / 年 / 月 / 日 + 點數異動 + 自訂區間）
window.Dash = (function () {
    let _currentReportTab = 'overview';
    let _pointsLogShowAll = false;

    function init() {
        // 報表分頁切換
        document.querySelectorAll('.report-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                _currentReportTab = tab.dataset.report;
                ['reportOverview','reportYearly','reportMonthly','reportDaily','reportCustom'].forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                });
                const pane = document.getElementById('report' + _currentReportTab.charAt(0).toUpperCase() + _currentReportTab.slice(1));
                if (pane) pane.classList.remove('hidden');
                renderActiveReport();
            });
        });

        // 點數異動展開
        document.getElementById('togglePointsLog').addEventListener('click', () => {
            _pointsLogShowAll = !_pointsLogShowAll;
            document.getElementById('togglePointsLog').textContent = _pointsLogShowAll ? '只顯示最近 15 筆' : '顯示全部';
            renderPointsLog();
        });

        // 各報表選擇器
        document.getElementById('yearReportSelect').addEventListener('change', renderYearlyReport);
        document.getElementById('monthReportYear').addEventListener('change', renderMonthlyReport);
        document.getElementById('monthReportMonth').addEventListener('change', renderMonthlyReport);
        document.getElementById('dailyReportDate').addEventListener('change', renderDailyReport);

        // #9 自訂區間
        const customStart = document.getElementById('customReportStart');
        const customEnd = document.getElementById('customReportEnd');
        if (customStart) customStart.addEventListener('change', renderCustomReport);
        if (customEnd)   customEnd.addEventListener('change', renderCustomReport);
    }

    function render() {
        try {
            const members     = getMembers();
            const redemptions = getRedemptions();
            const inventory   = getInventory();

            document.getElementById('totalMembers').textContent      = members.length;
            document.getElementById('totalRedemptions').textContent  = redemptions.length;
            document.getElementById('totalPointsSpent').textContent  = redemptions.reduce((s,r)=>s+r.pointsCost,0).toLocaleString();
            document.getElementById('lowStockCount').textContent     = inventory.filter(i => i.quantity <= Core.LOW_STOCK_THRESHOLD).length;

            // #3 30 天內到期品項數量（若有 expiringCount 容器則填）
            const expiringEl = document.getElementById('expiringCount');
            if (expiringEl) expiringEl.textContent = countExpiringSoon(inventory, 30);

            const yearData  = {};
            const monthData = Array(12).fill(0);
            const redCatMap = {};
            const invCatMap = {};

            inventory.forEach(i => {
                const cat = i.category || '未分類';
                invCatMap[cat] = (invCatMap[cat] || 0) + i.quantity;
            });

            const currentYear = new Date().getFullYear();
            redemptions.forEach(r => {
                const date = new Date(r.date);
                const y = date.getFullYear();
                const cat = Core.resolveCategory(r);
                if (!yearData[y]) yearData[y] = 0;
                yearData[y] += r.pointsCost;
                if (y === currentYear) monthData[date.getMonth()] += 1;
                redCatMap[cat] = (redCatMap[cat] || 0) + 1;
            });

            Core.drawPie('invCategoryPieChart', invCatMap);
            Core.drawPie('redemptionPieChart', redCatMap);

            Core.drawChart('yearlyChart', 'bar', {
                labels: Object.keys(yearData),
                datasets: [{ label: '核銷點數', data: Object.values(yearData), backgroundColor: '#3b82f6', borderRadius: 4 }]
            });
            Core.drawChart('monthlyChart', 'line', {
                labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
                datasets: [{ label: '兌換筆數', data: monthData, fill: true, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', tension: 0.4 }]
            });

            // RFM 會員分群
            const now = new Date();
            let rfmActive = 0, rfmDormant = 0, rfmLost = 0, rfmNever = 0;
            const lastRedeemMap = new Map();
            redemptions.forEach(r => {
                const t = new Date(r.date).getTime();
                if (!lastRedeemMap.has(r.memberId) || t > lastRedeemMap.get(r.memberId)) {
                    lastRedeemMap.set(r.memberId, t);
                }
            });
            members.forEach(m => {
                const lastTime = lastRedeemMap.get(m.id);
                if (lastTime === undefined) rfmNever++;
                else {
                    const daysSince = (now - lastTime) / (1000 * 60 * 60 * 24);
                    if (daysSince <= 30) rfmActive++;
                    else if (daysSince <= 90) rfmDormant++;
                    else rfmLost++;
                }
            });
            document.getElementById('rfmStats').innerHTML =
                Core.buildStatCard(rfmActive,  '活躍 (30天內兌換)', 'var(--success)') +
                Core.buildStatCard(rfmDormant, '沉睡 (31–90天)',    '#f59e0b') +
                Core.buildStatCard(rfmLost,    '流失 (90天以上)',  'var(--danger)') +
                Core.buildStatCard(rfmNever,   '從未兌換',         'var(--text-secondary)');
            const rfmMap = {};
            if (rfmActive)  rfmMap['活躍']    = rfmActive;
            if (rfmDormant) rfmMap['沉睡']    = rfmDormant;
            if (rfmLost)    rfmMap['流失']    = rfmLost;
            if (rfmNever)   rfmMap['從未兌換'] = rfmNever;
            Core.drawPie('rfmPieChart', rfmMap);

            renderPointsLog();
        } catch (e) {
            console.error('Dashboard rendering error:', e);
        }
    }

    function countExpiringSoon(inventory, days) {
        const now = new Date();
        const limit = new Date(now.getTime() + days * 86400000);
        let count = 0;
        inventory.forEach(item => {
            if (!item.batches || item.batches.length === 0) return;
            // 任一批號在限期內到期且仍有量 → 計入
            for (const b of item.batches) {
                if (!b.expiryDate || b.quantity <= 0) continue;
                const exp = new Date(b.expiryDate + 'T23:59:59');
                if (exp <= limit) { count++; return; }
            }
        });
        return count;
    }

    function renderPointsLog() {
        const log = getPointsLog().sort((a, b) => new Date(b.date) - new Date(a.date));
        const display = _pointsLogShowAll ? log : log.slice(0, 15);
        const tbody = document.getElementById('pointsLogTableBody');
        tbody.innerHTML = '';
        if (log.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">尚無點數異動紀錄</td></tr>';
            return;
        }
        const typeLabels = { init: '初始發放', topup: '補點', deduct: '扣點', redeem: '兌換核銷' };
        tbody.innerHTML = display.map(entry => {
            const color = entry.delta > 0 ? 'var(--success)' : 'var(--danger)';
            const sign  = entry.delta > 0 ? '+' : '';
            return `<tr>
                <td><small style="color:var(--text-secondary);">${Core.fmtDisp(entry.date)}</small></td>
                <td>${escapeHtml(entry.memberName || entry.memberId)}</td>
                <td><strong style="color:${color};">${sign}${entry.delta}</strong></td>
                <td><span class="badge" style="background:#f1f5f9;color:#64748b;">${typeLabels[entry.type] || escapeHtml(entry.type)}</span></td>
                <td style="color:var(--text-secondary); font-size:0.875rem;">${escapeHtml(entry.note || '')}</td>
            </tr>`;
        }).join('');
    }

    // ---- 年報 ----
    function initYearReportSelect() {
        const sel = document.getElementById('yearReportSelect');
        const current = parseInt(sel.value) || new Date().getFullYear();
        sel.innerHTML = Core.getAvailableYears().map(y =>
            `<option value="${y}" ${y === current ? 'selected' : ''}>${y} 年</option>`
        ).join('');
    }

    function renderYearlyReport() {
        const sel = document.getElementById('yearReportSelect');
        const year = parseInt(sel.value) || new Date().getFullYear();
        const redemptions = getRedemptions().filter(r => new Date(r.date).getFullYear() === year);
        const newMembers  = getMembers().filter(m => m.joinDate && m.joinDate.startsWith(String(year))).length;

        document.getElementById('yearlyStats').innerHTML =
            Core.buildStatCard(redemptions.length.toLocaleString(),                            `${year} 年兌換次數`) +
            Core.buildStatCard(redemptions.reduce((s,r)=>s+r.pointsCost,0).toLocaleString(),  `${year} 年核銷點數`) +
            Core.buildStatCard(newMembers.toLocaleString(),                                    `${year} 年新增會員`);

        const monthData = Array(12).fill(0);
        const catMap    = {};
        redemptions.forEach(r => {
            monthData[new Date(r.date).getMonth()]++;
            const cat = Core.resolveCategory(r);
            catMap[cat] = (catMap[cat] || 0) + 1;
        });

        Core.drawChart('yearMonthlyChart', 'bar', {
            labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
            datasets: [{ label: '兌換次數', data: monthData, backgroundColor: '#3b82f6', borderRadius: 4 }]
        });
        Core.drawPie('yearCatChart', catMap);
    }

    // ---- 月報 ----
    function initMonthReportSelects() {
        const monthYearSel  = document.getElementById('monthReportYear');
        const monthMonthSel = document.getElementById('monthReportMonth');
        const now = new Date();
        const savedYear = parseInt(monthYearSel.value) || now.getFullYear();
        monthYearSel.innerHTML = Core.getAvailableYears().map(y =>
            `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y} 年</option>`
        ).join('');
        if (!monthMonthSel.options.length) {
            monthMonthSel.innerHTML = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
                .map((name, i) => `<option value="${i}" ${i === now.getMonth() ? 'selected' : ''}>${name}</option>`).join('');
        }
    }

    function renderMonthlyReport() {
        const year  = parseInt(document.getElementById('monthReportYear').value);
        const month = parseInt(document.getElementById('monthReportMonth').value);
        if (isNaN(year) || isNaN(month)) return;
        const allRedemptions = getRedemptions();
        const redemptions = allRedemptions.filter(r => {
            const d = new Date(r.date);
            return d.getFullYear() === year && d.getMonth() === month;
        });
        const prevDate  = new Date(year, month - 1, 1);
        const prevYear  = prevDate.getFullYear();
        const prevMonth = prevDate.getMonth();
        const prevRedemptions = allRedemptions.filter(r => {
            const d = new Date(r.date);
            return d.getFullYear() === prevYear && d.getMonth() === prevMonth;
        });

        const uniqueMembers     = new Set(redemptions.map(r => r.memberId)).size;
        const prevUniqueMembers = new Set(prevRedemptions.map(r => r.memberId)).size;
        const totalPoints       = redemptions.reduce((s,r)=>s+r.pointsCost,0);
        const prevTotalPoints   = prevRedemptions.reduce((s,r)=>s+r.pointsCost,0);

        document.getElementById('monthlyStats').innerHTML =
            Core.buildStatCard(redemptions.length.toLocaleString(),  `${month+1} 月兌換次數`, 'var(--primary-color)', Core.trendBadge(redemptions.length, prevRedemptions.length)) +
            Core.buildStatCard(totalPoints.toLocaleString(),          `${month+1} 月核銷點數`, 'var(--primary-color)', Core.trendBadge(totalPoints, prevTotalPoints)) +
            Core.buildStatCard(uniqueMembers.toLocaleString(),        `${month+1} 月服務人次`, 'var(--primary-color)', Core.trendBadge(uniqueMembers, prevUniqueMembers));

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const dayData = Array(daysInMonth).fill(0);
        const catMap  = {};
        redemptions.forEach(r => {
            dayData[new Date(r.date).getDate() - 1]++;
            const cat = Core.resolveCategory(r);
            catMap[cat] = (catMap[cat] || 0) + 1;
        });

        Core.drawChart('monthDailyChart', 'bar', {
            labels: Array.from({length: daysInMonth}, (_, i) => `${i+1}日`),
            datasets: [{ label: '兌換次數', data: dayData, backgroundColor: '#10b981', borderRadius: 4 }]
        });
        Core.drawPie('monthCatChart', catMap);
    }

    // ---- 日報 ----
    function initDailyReportDate() {
        const sel = document.getElementById('dailyReportDate');
        if (!sel.value) sel.value = new Date().toISOString().split('T')[0];
    }

    function renderDailyReport() {
        const dateStr = document.getElementById('dailyReportDate').value;
        if (!dateStr) return;

        const members     = getMembers();
        const redemptions = getRedemptions()
            .filter(r => {
                const d = new Date(r.date);
                const local = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                return local === dateStr;
            })
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const uniqueMembers = new Set(redemptions.map(r => r.memberId)).size;

        document.getElementById('dailyStats').innerHTML =
            Core.buildStatCard(redemptions.length.toLocaleString(),                            '當日兌換次數') +
            Core.buildStatCard(redemptions.reduce((s,r)=>s+r.pointsCost,0).toLocaleString(),  '當日核銷點數') +
            Core.buildStatCard(uniqueMembers.toLocaleString(),                                 '服務人次（不重複）');

        const hourData = Array(24).fill(0);
        redemptions.forEach(r => { hourData[new Date(r.date).getHours()]++; });

        Core.drawChart('dailyHourChart', 'bar', {
            labels: Array.from({length: 24}, (_, i) => `${i}時`),
            datasets: [{ label: '兌換次數', data: hourData, backgroundColor: '#8b5cf6', borderRadius: 4 }]
        });

        const tbody = document.getElementById('dailyDetailBody');
        tbody.innerHTML = '';
        if (redemptions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">當日無兌換記錄</td></tr>';
            return;
        }
        tbody.innerHTML = redemptions.map(r => {
            const d    = new Date(r.date);
            const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
            const m    = members.find(x => x.id === r.memberId);
            const cat  = Core.resolveCategory(r);
            const cc   = Core.getCatColor(cat);
            return `<tr>
                <td>${time}</td>
                <td>${escapeHtml(m ? m.name : r.memberId)}</td>
                <td>${escapeHtml(r.itemName)} <span class="badge" style="background:${cc.bg};color:${cc.text};margin-left:0.4rem;">${escapeHtml(cat)}</span></td>
                <td><span style="color:var(--danger);">-${r.pointsCost}</span></td>
            </tr>`;
        }).join('');
    }

    // ---- #9 自訂區間 ----
    function initCustomReport() {
        const start = document.getElementById('customReportStart');
        const end   = document.getElementById('customReportEnd');
        if (!start.value || !end.value) {
            const now = new Date();
            const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            start.value = firstOfMonth.toISOString().split('T')[0];
            end.value   = new Date().toISOString().split('T')[0];
        }
    }

    function renderCustomReport() {
        const startVal = document.getElementById('customReportStart').value;
        const endVal   = document.getElementById('customReportEnd').value;
        const errEl    = document.getElementById('customReportError');
        const statsEl  = document.getElementById('customStats');

        errEl.style.display = 'none';
        if (!startVal || !endVal) {
            statsEl.innerHTML = '<p style="color:var(--text-secondary);">請選擇起始與結束日期。</p>';
            return;
        }
        const start = new Date(startVal + 'T00:00:00').getTime();
        const end   = new Date(endVal   + 'T23:59:59.999').getTime();
        if (start > end) {
            errEl.textContent = '起始日期不可晚於結束日期';
            errEl.style.display = 'block';
            return;
        }

        const allRedemptions = getRedemptions();
        const redemptions = allRedemptions.filter(r => {
            const t = new Date(r.date).getTime();
            return t >= start && t <= end;
        });
        const dayDiff = Math.max(1, Math.round((end - start) / 86400000) + 1);
        const uniqueMembers = new Set(redemptions.map(r => r.memberId)).size;
        const totalPoints   = redemptions.reduce((s,r)=>s+r.pointsCost,0);

        statsEl.innerHTML =
            Core.buildStatCard(redemptions.length.toLocaleString(),  '兌換次數') +
            Core.buildStatCard(totalPoints.toLocaleString(),          '核銷點數') +
            Core.buildStatCard(uniqueMembers.toLocaleString(),        '服務人次（不重複）') +
            Core.buildStatCard(dayDiff.toLocaleString() + ' 天',      '區間天數');

        // 按日期堆疊
        const dayMap = {};
        redemptions.forEach(r => {
            const d = new Date(r.date);
            const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            dayMap[key] = (dayMap[key] || 0) + 1;
        });
        const sortedDays = Object.keys(dayMap).sort();
        Core.drawChart('customDailyChart', 'bar', {
            labels: sortedDays,
            datasets: [{ label: '兌換次數', data: sortedDays.map(k => dayMap[k]), backgroundColor: '#3b82f6', borderRadius: 4 }]
        });

        const catMap = {};
        redemptions.forEach(r => {
            const cat = Core.resolveCategory(r);
            catMap[cat] = (catMap[cat] || 0) + 1;
        });
        Core.drawPie('customCatChart', catMap);
    }

    function renderActiveReport() {
        if (_currentReportTab === 'overview')      render();
        else if (_currentReportTab === 'yearly')   { initYearReportSelect();  renderYearlyReport();  }
        else if (_currentReportTab === 'monthly')  { initMonthReportSelects(); renderMonthlyReport(); }
        else if (_currentReportTab === 'daily')    { initDailyReportDate();   renderDailyReport();   }
        else if (_currentReportTab === 'custom')   { initCustomReport();      renderCustomReport();   }
    }

    return { init, render, renderActiveReport, renderPointsLog };
})();
