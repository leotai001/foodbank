document.addEventListener('DOMContentLoaded', async () => {
    // ==== Admin Auth & UI Init ====
    const adminToken = sessionStorage.getItem('adminToken');
    if (!await verifyAdminSession(adminToken)) {
        window.location.href = 'index.html';
        return;
    }

    document.getElementById('adminLogoutBtn').addEventListener('click', () => {
        clearAdminSession();
        sessionStorage.removeItem('adminToken');
        window.location.href = 'index.html';
    });

    // ==== 修改管理員密碼 ====
    document.getElementById('changeAdminPwdBtn').addEventListener('click', () => {
        document.getElementById('changeAdminPwdForm').reset();
        document.getElementById('adminPwdError').style.display = 'none';
        document.getElementById('adminPwdSuccess').style.display = 'none';
        openModal('changeAdminPwdModal');
    });

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

        // 驗證目前密碼
        const adminData = JSON.parse(localStorage.getItem(DB_ADMIN_KEY));
        let currentMatch;
        if (isHashed(adminData.password)) {
            currentMatch = adminData.password === await hashPassword(currentPwd);
        } else {
            currentMatch = adminData.password === currentPwd;
        }
        if (!currentMatch) { showError('目前密碼錯誤'); return; }

        // 儲存新密碼（hash）
        adminData.password = await hashPassword(newPwd);
        localStorage.setItem(DB_ADMIN_KEY, JSON.stringify(adminData));

        document.getElementById('changeAdminPwdForm').reset();
        okEl.style.display = 'block';
        setTimeout(() => closeModal('changeAdminPwdModal'), 1500);
    });

    function initAdminApp() {
        renderDashboard();
        renderInventoryFilters();
        renderInventory();
        renderMembers();
        renderRedemptionsHistory();
    }

    // ==== Navigation ====
    const navItems = document.querySelectorAll('.nav-item');
    const sections = ['dashboardView', 'inventoryView', 'membersView', 'redemptionsView', 'dataView'];

    navItems.forEach(nav => {
        nav.addEventListener('click', (e) => {
            navItems.forEach(n => n.classList.remove('active'));
            e.target.classList.add('active');
            const targetId = e.target.getAttribute('data-target');
            sections.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('hidden', id !== targetId);
            });
            if (targetId === 'dashboardView') renderActiveReport();
            else if (targetId === 'inventoryView') renderInventoryLog();
        });
    });

    // ==== Modals Base ====
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.getAttribute('data-modal');
            if (modalId === 'batchRedeemModal' && batchRedeemList.length > 0) {
                if (!confirm(`清單中有 ${batchRedeemList.length} 件物品尚未完成核銷，確定要關閉嗎？`)) return;
            }
            if (modalId === 'batchInventoryModal' && batchInvList.length > 0) {
                if (!confirm(`清單中有 ${batchInvList.length} 筆項目尚未送出，確定要關閉嗎？`)) return;
            }
            document.getElementById(modalId).classList.remove('active');
        });
    });
    const closeModal = (id) => document.getElementById(id).classList.remove('active');
    const openModal = (id) => document.getElementById(id).classList.add('active');
    const LOW_STOCK_THRESHOLD = 5;

    // ==== Dashboard ====
    let charts = {};
    const chartColors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#818cf8', '#c084fc', '#f472b6'];

    // 分類色票（依分類在列表中的順序穩定對應）
    const CAT_PALETTE = [
        { bg: '#dbeafe', text: '#1e40af' },
        { bg: '#d1fae5', text: '#065f46' },
        { bg: '#fef3c7', text: '#92400e' },
        { bg: '#fce7f3', text: '#9d174d' },
        { bg: '#ede9fe', text: '#5b21b6' },
        { bg: '#ffedd5', text: '#9a3412' },
        { bg: '#cffafe', text: '#164e63' },
        { bg: '#fef9c3', text: '#713f12' },
    ];
    function getCatColor(cat) {
        const stored = getCatColors();
        if (stored[cat]) return stored[cat];
        const idx = getCategories().indexOf(cat);
        if (idx === -1) return { bg: '#f1f5f9', text: '#64748b' };
        return CAT_PALETTE[idx % CAT_PALETTE.length];
    }

    // 永遠從目前庫存取得最新分類，找不到時退回紀錄中儲存的值
    const _invCatCache = {};
    function resolveCategory(r) {
        if (!_invCatCache._built) {
            getInventory().forEach(i => { _invCatCache[i.barcode] = i.category; });
            _invCatCache._built = true;
        }
        return _invCatCache[r.itemBarcode] || r.category || '未分類';
    }
    function clearCatCache() { Object.keys(_invCatCache).forEach(k => delete _invCatCache[k]); _invCatCache._built = false; }

    function fmtDisp(isoStr) {
        const d = new Date(isoStr);
        return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    function drawChart(id, type, dataConfig, optionsConfig = {}) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById(id);
        if (!ctx) return;
        if (charts[id]) charts[id].destroy();
        charts[id] = new Chart(ctx.getContext('2d'), {
            type,
            data: dataConfig,
            options: { responsive: true, maintainAspectRatio: false, ...optionsConfig }
        });
    }

    function buildStatCard(value, label, color = 'var(--primary-color)', trendHtml = '') {
        return `<div class="stat-card"><div class="stat-value" style="color:${color};">${value}</div><div class="stat-label">${label}${trendHtml}</div></div>`;
    }

    function trendBadge(current, prev) {
        if (prev === 0 && current === 0) return '';
        if (prev === 0) return ` <span style="font-size:0.75rem; color:var(--success); font-weight:600;">▲ NEW</span>`;
        const pct = ((current - prev) / prev * 100).toFixed(1);
        const up = current >= prev;
        return ` <span style="font-size:0.75rem; color:${up ? 'var(--success)' : 'var(--danger)'}; font-weight:600;">${up ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
    }

    function getAvailableYears() {
        const years = new Set(getRedemptions().map(r => new Date(r.date).getFullYear()));
        years.add(new Date().getFullYear());
        return [...years].sort((a, b) => b - a);
    }

    function drawPie(id, catMap) {
        const labels = Object.keys(catMap);
        drawChart(id, 'pie', {
            labels: labels.length ? labels : ['本期無資料'],
            datasets: [{ data: labels.length ? Object.values(catMap) : [1], backgroundColor: labels.length ? chartColors : ['#e2e8f0'], borderWidth: labels.length ? 1 : 0 }]
        });
    }

    function renderDashboard() {
        try {
            const members = getMembers();
            const redemptions = getRedemptions();
            const inventory = getInventory();

            document.getElementById('totalMembers').textContent = members.length;
            document.getElementById('totalRedemptions').textContent = redemptions.length;
            document.getElementById('totalPointsSpent').textContent = redemptions.reduce((sum, r) => sum + r.pointsCost, 0).toLocaleString();
            document.getElementById('lowStockCount').textContent = inventory.filter(i => i.quantity <= LOW_STOCK_THRESHOLD).length;

            const yearData = {};
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
                const cat = resolveCategory(r);
                if (!yearData[y]) yearData[y] = 0;
                yearData[y] += r.pointsCost;
                if (y === currentYear) monthData[date.getMonth()] += 1;
                redCatMap[cat] = (redCatMap[cat] || 0) + 1;
                });

            drawPie('invCategoryPieChart', invCatMap);
            drawPie('redemptionPieChart', redCatMap);

            drawChart('yearlyChart', 'bar', {
                labels: Object.keys(yearData),
                datasets: [{ label: '核銷點數', data: Object.values(yearData), backgroundColor: '#3b82f6', borderRadius: 4 }]
            });

            drawChart('monthlyChart', 'line', {
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
                if (lastTime === undefined) {
                    rfmNever++;
                } else {
                    const daysSince = (now - lastTime) / (1000 * 60 * 60 * 24);
                    if (daysSince <= 30) rfmActive++;
                    else if (daysSince <= 90) rfmDormant++;
                    else rfmLost++;
                }
            });
            document.getElementById('rfmStats').innerHTML =
                buildStatCard(rfmActive, '活躍 (30天內兌換)', 'var(--success)') +
                buildStatCard(rfmDormant, '沉睡 (31–90天)', '#f59e0b') +
                buildStatCard(rfmLost, '流失 (90天以上)', 'var(--danger)') +
                buildStatCard(rfmNever, '從未兌換', 'var(--text-secondary)');
            const rfmMap = {};
            if (rfmActive)  rfmMap['活躍']    = rfmActive;
            if (rfmDormant) rfmMap['沉睡']    = rfmDormant;
            if (rfmLost)    rfmMap['流失']    = rfmLost;
            if (rfmNever)   rfmMap['從未兌換'] = rfmNever;
            drawPie('rfmPieChart', rfmMap);

            renderPointsLog();
        } catch(e) {
            console.error('Dashboard rendering error:', e);
        }
    }

    // ==== Points Log ====
    let pointsLogShowAll = false;

    document.getElementById('togglePointsLog').addEventListener('click', () => {
        pointsLogShowAll = !pointsLogShowAll;
        document.getElementById('togglePointsLog').textContent = pointsLogShowAll ? '只顯示最近 15 筆' : '顯示全部';
        renderPointsLog();
    });

    function renderPointsLog() {
        const log = getPointsLog().sort((a, b) => new Date(b.date) - new Date(a.date));
        const display = pointsLogShowAll ? log : log.slice(0, 15);
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
                <td><small style="color:var(--text-secondary);">${fmtDisp(entry.date)}</small></td>
                <td>${escapeHtml(entry.memberName || entry.memberId)}</td>
                <td><strong style="color:${color};">${sign}${entry.delta}</strong></td>
                <td><span class="badge" style="background:#f1f5f9;color:#64748b;">${typeLabels[entry.type] || escapeHtml(entry.type)}</span></td>
                <td style="color:var(--text-secondary); font-size:0.875rem;">${escapeHtml(entry.note || '')}</td>
            </tr>`;
        }).join('');
    }

    // ==== Inventory Log ====
    let inventoryLogShowAll = false;

    document.getElementById('toggleInventoryLog').addEventListener('click', () => {
        inventoryLogShowAll = !inventoryLogShowAll;
        document.getElementById('toggleInventoryLog').textContent = inventoryLogShowAll ? '只顯示最近 15 筆' : '顯示全部';
        renderInventoryLog();
    });

    function renderInventoryLog() {
        const log = getInventoryLog().sort((a, b) => new Date(b.date) - new Date(a.date));
        const display = inventoryLogShowAll ? log : log.slice(0, 15);
        const tbody = document.getElementById('inventoryLogTableBody');
        tbody.innerHTML = '';
        if (log.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">尚無入庫紀錄</td></tr>';
            return;
        }
        tbody.innerHTML = display.map(entry => `<tr>
                <td><small style="color:var(--text-secondary);">${fmtDisp(entry.date)}</small></td>
                <td><code>${escapeHtml(entry.barcode)}</code></td>
                <td>${escapeHtml(entry.itemName)}</td>
                <td><span style="color:var(--success); font-weight:600;">+${entry.delta}</span></td>
                <td style="color:var(--text-secondary); font-size:0.875rem;">${escapeHtml(entry.note || '')}</td>
            </tr>`).join('');
    }

    // ==== Report Sub-tabs ====
    let currentReportTab = 'overview';

    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentReportTab = tab.dataset.report;
            ['reportOverview','reportYearly','reportMonthly','reportDaily'].forEach(id =>
                document.getElementById(id).classList.add('hidden')
            );
            document.getElementById('report' + currentReportTab.charAt(0).toUpperCase() + currentReportTab.slice(1)).classList.remove('hidden');
            renderActiveReport();
        });
    });

    function renderActiveReport() {
        if (currentReportTab === 'overview')  renderDashboard();
        else if (currentReportTab === 'yearly')  { initYearReportSelect();  renderYearlyReport();  }
        else if (currentReportTab === 'monthly') { initMonthReportSelects(); renderMonthlyReport(); }
        else if (currentReportTab === 'daily')   { initDailyReportDate();   renderDailyReport();   }
    }

    // ---- 年報 ----
    const yearReportSelect = document.getElementById('yearReportSelect');
    yearReportSelect.addEventListener('change', renderYearlyReport);

    function initYearReportSelect() {
        const current = parseInt(yearReportSelect.value) || new Date().getFullYear();
        yearReportSelect.innerHTML = getAvailableYears().map(y =>
            `<option value="${y}" ${y === current ? 'selected' : ''}>${y} 年</option>`
        ).join('');
    }

    function renderYearlyReport() {
        const year = parseInt(yearReportSelect.value) || new Date().getFullYear();
        const redemptions = getRedemptions().filter(r => new Date(r.date).getFullYear() === year);
        const newMembers  = getMembers().filter(m => m.joinDate && m.joinDate.startsWith(String(year))).length;

        document.getElementById('yearlyStats').innerHTML =
            buildStatCard(redemptions.length.toLocaleString(),                                  `${year} 年兌換次數`) +
            buildStatCard(redemptions.reduce((s,r)=>s+r.pointsCost,0).toLocaleString(), `${year} 年核銷點數`) +
            buildStatCard(newMembers.toLocaleString(),                                          `${year} 年新增會員`);

        const monthData = Array(12).fill(0);
        const catMap    = {};
        redemptions.forEach(r => {
            monthData[new Date(r.date).getMonth()]++;
            const cat = resolveCategory(r);
            catMap[cat] = (catMap[cat] || 0) + 1;
        });

        drawChart('yearMonthlyChart', 'bar', {
            labels: ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'],
            datasets: [{ label: '兌換次數', data: monthData, backgroundColor: '#3b82f6', borderRadius: 4 }]
        });
        drawPie('yearCatChart', catMap);
    }

    // ---- 月報 ----
    const monthReportYear  = document.getElementById('monthReportYear');
    const monthReportMonth = document.getElementById('monthReportMonth');
    monthReportYear.addEventListener('change', renderMonthlyReport);
    monthReportMonth.addEventListener('change', renderMonthlyReport);

    function initMonthReportSelects() {
        const now = new Date();
        const savedYear = parseInt(monthReportYear.value) || now.getFullYear();
        monthReportYear.innerHTML = getAvailableYears().map(y =>
            `<option value="${y}" ${y === savedYear ? 'selected' : ''}>${y} 年</option>`
        ).join('');
        if (!monthReportMonth.options.length) {
            monthReportMonth.innerHTML = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月']
                .map((name, i) => `<option value="${i}" ${i === now.getMonth() ? 'selected' : ''}>${name}</option>`).join('');
        }
    }

    function renderMonthlyReport() {
        const year  = parseInt(monthReportYear.value);
        const month = parseInt(monthReportMonth.value);
        if (isNaN(year) || isNaN(month)) return;
        const allRedemptions = getRedemptions();
        const redemptions = allRedemptions.filter(r => {
            const d = new Date(r.date);
            return d.getFullYear() === year && d.getMonth() === month;
        });

        // Previous month comparison
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
            buildStatCard(redemptions.length.toLocaleString(),   `${month+1} 月兌換次數`, 'var(--primary-color)', trendBadge(redemptions.length, prevRedemptions.length)) +
            buildStatCard(totalPoints.toLocaleString(),           `${month+1} 月核銷點數`, 'var(--primary-color)', trendBadge(totalPoints, prevTotalPoints)) +
            buildStatCard(uniqueMembers.toLocaleString(),         `${month+1} 月服務人次`, 'var(--primary-color)', trendBadge(uniqueMembers, prevUniqueMembers));

        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const dayData = Array(daysInMonth).fill(0);
        const catMap  = {};
        redemptions.forEach(r => {
            dayData[new Date(r.date).getDate() - 1]++;
            const cat = resolveCategory(r);
            catMap[cat] = (catMap[cat] || 0) + 1;
        });

        drawChart('monthDailyChart', 'bar', {
            labels: Array.from({length: daysInMonth}, (_, i) => `${i+1}日`),
            datasets: [{ label: '兌換次數', data: dayData, backgroundColor: '#10b981', borderRadius: 4 }]
        });
        drawPie('monthCatChart', catMap);
    }

    // ---- 日報 ----
    const dailyReportDate = document.getElementById('dailyReportDate');
    dailyReportDate.addEventListener('change', renderDailyReport);

    function initDailyReportDate() {
        if (!dailyReportDate.value) dailyReportDate.value = new Date().toISOString().split('T')[0];
    }

    function renderDailyReport() {
        const dateStr = dailyReportDate.value;
        if (!dateStr) return;

        const members     = getMembers();
        const redemptions = getRedemptions()
            .filter(r => r.date.startsWith(dateStr))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        const uniqueMembers = new Set(redemptions.map(r => r.memberId)).size;

        document.getElementById('dailyStats').innerHTML =
            buildStatCard(redemptions.length.toLocaleString(),                                  '當日兌換次數') +
            buildStatCard(redemptions.reduce((s,r)=>s+r.pointsCost,0).toLocaleString(), '當日核銷點數') +
            buildStatCard(uniqueMembers.toLocaleString(),                                       '服務人次（不重複）');

        const hourData = Array(24).fill(0);
        redemptions.forEach(r => { hourData[new Date(r.date).getHours()]++; });

        drawChart('dailyHourChart', 'bar', {
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
            const cat  = resolveCategory(r);
            const cc   = getCatColor(cat);
            return `<tr>
                <td>${time}</td>
                <td>${escapeHtml(m ? m.name : r.memberId)}</td>
                <td>${escapeHtml(r.itemName)} <span class="badge" style="background:${cc.bg};color:${cc.text};margin-left:0.4rem;">${escapeHtml(cat)}</span></td>
                <td><span style="color:var(--danger);">-${r.pointsCost}</span></td>
            </tr>`;
        }).join('');
    }

    // ==== Inventory Management & Search ====
    document.getElementById('invSearchInput').addEventListener('input', renderInventory);
    document.getElementById('invCategoryFilter').addEventListener('change', renderInventory);

    function renderInventoryFilters() {
        const catFilter = document.getElementById('invCategoryFilter');
        const cats = getCategories();
        catFilter.innerHTML = '<option value="all">所有分類</option>';
        cats.forEach(c => catFilter.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
    }

    function renderInventory() {
        const inventory = getInventory();
        const search = document.getElementById('invSearchInput').value.trim().toLowerCase();
        const cat    = document.getElementById('invCategoryFilter').value;
        const tbody  = document.getElementById('inventoryTableBody');
        const cats   = getCategories();
        tbody.innerHTML = '';

        inventory.filter(i => {
            if (cat !== 'all' && i.category !== cat) return false;
            if (search && !i.name.toLowerCase().includes(search) && !i.barcode.toLowerCase().includes(search)) return false;
            return true;
        }).forEach(item => {
            const isEditing = !!invEditState[item.barcode];
            const d = isEditing ? invEditState[item.barcode] : item;
            const isOutOfStock = d.quantity === 0;
            const isLowStock   = !isOutOfStock && d.quantity <= LOW_STOCK_THRESHOLD;
            const qtyColor     = isOutOfStock ? 'var(--danger)' : isLowStock ? '#d97706' : 'var(--primary-color)';
            const qtyBadge     = isOutOfStock
                ? '<span class="badge badge-expired" style="margin-left:0.4rem;">缺貨</span>'
                : isLowStock ? '<span class="badge" style="background:#fef3c7;color:#92400e;margin-left:0.4rem;">庫存偏低</span>'
                : '';
            const cc = getCatColor(d.category || item.category);
            const bc = escapeHtml(item.barcode);
            const catOpts = cats.map(c =>
                `<option value="${escapeHtml(c)}" ${c === d.category ? 'selected' : ''}>${escapeHtml(c)}</option>`
            ).join('');

            const tr = document.createElement('tr');
            if (isEditing) tr.classList.add('editing-row');
            tr.innerHTML = isEditing ? `
                <td><code>${bc}</code></td>
                <td><input type="text"   class="inv-field" data-barcode="${bc}" data-field="name"       value="${escapeHtml(d.name)}"></td>
                <td><select              class="inv-field" data-barcode="${bc}" data-field="category">${catOpts}</select></td>
                <td><input type="number" class="inv-field" data-barcode="${bc}" data-field="quantity"   value="${d.quantity}"   min="0" style="width:70px;"></td>
                <td><input type="number" class="inv-field" data-barcode="${bc}" data-field="pointsCost" value="${d.pointsCost}" min="1" style="width:70px;"></td>
                <td><button class="btn btn-sm btn-outline inv-cancel-btn" data-barcode="${bc}">取消</button></td>
            ` : `
                <td><code>${bc}</code></td>
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td><span class="badge" style="background:${cc.bg}; color:${cc.text};">${escapeHtml(item.category || '需更新')}</span></td>
                <td><span style="font-size:1.1rem; color:${qtyColor}; font-weight:bold;">${item.quantity}</span>${qtyBadge}</td>
                <td>${item.pointsCost}</td>
                <td><button class="btn btn-sm btn-outline inv-edit-btn" data-barcode="${bc}">編輯</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // ==== Inventory Inline Edit State ====
    let invEditState = {};

    function updateInvSaveBar() {
        const count = Object.keys(invEditState).length;
        document.getElementById('invSaveBar').classList.toggle('hidden', count === 0);
        document.getElementById('invEditCount').textContent = count;
    }

    document.getElementById('invSaveAllBtn').addEventListener('click', () => {
        const inv = getInventory();
        const catChanges = {}; // { barcode: newCategory }

        Object.entries(invEditState).forEach(([barcode, data]) => {
            const idx = inv.findIndex(i => i.barcode === barcode);
            if (idx === -1) return;
            if (inv[idx].category !== data.category) {
                catChanges[barcode] = data.category;
            }
            Object.assign(inv[idx], data);
        });
        saveInventory(inv);

        // 同步分類變動到核銷歷史
        if (Object.keys(catChanges).length > 0) {
            const redemptions = getRedemptions();
            let dirty = false;
            redemptions.forEach(r => {
                if (catChanges[r.itemBarcode] !== undefined) {
                    r.category = catChanges[r.itemBarcode];
                    dirty = true;
                }
            });
            if (dirty) saveRedemptions(redemptions);
        }

        clearCatCache();
        invEditState = {};
        renderInventory();
        updateInvSaveBar();
        renderRedemptionsHistory();
        renderDashboard();
    });

    document.getElementById('invCancelAllBtn').addEventListener('click', () => {
        invEditState = {};
        renderInventory();
        updateInvSaveBar();
    });

    // 事件委派：inventoryTableBody
    document.getElementById('inventoryTableBody').addEventListener('click', (e) => {
        const editBtn   = e.target.closest('.inv-edit-btn');
        const cancelBtn = e.target.closest('.inv-cancel-btn');
        if (editBtn) {
            const bc = editBtn.dataset.barcode;
            const item = getInventory().find(i => i.barcode === bc);
            invEditState[bc] = { name: item.name, category: item.category, quantity: item.quantity, pointsCost: item.pointsCost };
            updateInvSaveBar();
            renderInventory();
        } else if (cancelBtn) {
            delete invEditState[cancelBtn.dataset.barcode];
            updateInvSaveBar();
            renderInventory();
        }
    });
    document.getElementById('inventoryTableBody').addEventListener('change', (e) => {
        const field = e.target.closest('.inv-field');
        if (!field) return;
        const bc = field.dataset.barcode, fn = field.dataset.field;
        if (!invEditState[bc]) return;
        invEditState[bc][fn] = (fn === 'quantity' || fn === 'pointsCost') ? (parseInt(field.value, 10) || 0) : field.value;
    });

    // -- Category Maintenance --
    document.getElementById('manageCategoryBtn').addEventListener('click', () => {
        renderCategoryList();
        openModal('categoryModal');
    });

    function renderCategoryList() {
        const cats   = getCategories();
        const colors = getCatColors();
        const list   = document.getElementById('categoryList');
        list.innerHTML = '';
        if (cats.length === 0) {
            list.innerHTML = '<li style="list-style:none; color:var(--text-secondary);">尚無分類</li>';
            return;
        }
        cats.forEach((c, idx) => {
            const current = colors[c] || CAT_PALETTE[idx % CAT_PALETTE.length];
            const swatches = CAT_PALETTE.map((p, pi) => {
                const sel = (current.bg === p.bg && current.text === p.text);
                return `<span class="cat-color-swatch" data-cat="${escapeHtml(c)}" data-pi="${pi}"
                    style="display:inline-block;width:20px;height:20px;border-radius:50%;background:${p.bg};cursor:pointer;margin-right:3px;
                    border:2px solid ${sel ? p.text : 'transparent'};box-shadow:${sel ? '0 0 0 1px '+p.text : 'none'};vertical-align:middle;" title="${p.bg}"></span>`;
            }).join('');
            const li = document.createElement('li');
            li.style.cssText = 'list-style:none; padding:0.5rem 0; border-bottom:1px solid var(--border-color);';
            li.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.35rem;">
                    <span class="badge" style="background:${current.bg}; color:${current.text}; font-size:0.85rem;">${escapeHtml(c)}</span>
                    <button type="button" class="btn btn-sm btn-danger del-cat-btn" data-idx="${idx}" style="padding:0.2rem 0.6rem; font-size:0.75rem;">刪除</button>
                </div>
                <div>${swatches}</div>`;
            list.appendChild(li);
        });

        // 色票點擊
        list.querySelectorAll('.cat-color-swatch').forEach(s => {
            s.addEventListener('click', () => {
                const palette = CAT_PALETTE[parseInt(s.dataset.pi)];
                const stored  = getCatColors();
                stored[s.dataset.cat] = palette;
                saveCatColors(stored);
                renderCategoryList();
                renderInventory();
            });
        });

        // 刪除按鈕
        list.querySelectorAll('.del-cat-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx     = parseInt(e.target.closest('[data-idx]').dataset.idx);
                const cats    = getCategories();
                const catName = cats[idx];
                const inUse   = getInventory().some(i => i.category === catName);
                const msg = inUse
                    ? `分類「${catName}」仍有庫存項目使用，刪除後相關項目將顯示為「需更新」，確定要繼續嗎？`
                    : `確定要刪除分類「${catName}」嗎？`;
                if (!confirm(msg)) return;
                cats.splice(idx, 1);
                saveCategories(cats);
                const stored = getCatColors();
                delete stored[catName];
                saveCatColors(stored);
                clearCatCache();
                renderCategoryList();
                renderInventoryFilters();
            });
        });
    }

    document.getElementById('categoryForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const val = document.getElementById('newCategoryName').value.trim();
        const cats = getCategories();
        if (val && !cats.includes(val)) {
            cats.push(val);
            saveCategories(cats);
            document.getElementById('newCategoryName').value = '';
            renderCategoryList();
            renderInventoryFilters();
        }
    });

    // -- Batch Inventory Dialog --
    let batchInvList = [];
    const invInput = document.getElementById('batchInvScanner');

    document.getElementById('batchInventoryBtn').addEventListener('click', () => {
        batchInvList = [];
        renderBatchInvTable();
        openModal('batchInventoryModal');
        setTimeout(() => invInput.focus(), 100);
    });

    invInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const code = e.target.value.trim();
            if (!code) return;
            e.target.value = '';

            // Check if already in pending list
            if (batchInvList.find(x => x.barcode === code)) {
                alert('已在目前的編輯清單中！'); return;
            }

            const existing = getInventory().find(i => i.barcode === code);
            if (existing) {
                batchInvList.push({ isNew: false, barcode: code, name: existing.name, category: existing.category, pointsCost: existing.pointsCost, currentQty: existing.quantity, adjustQty: 1 });
            } else {
                batchInvList.push({ isNew: true, barcode: code, name: '', category: getCategories()[0] || '未分類', pointsCost: 100, currentQty: 0, adjustQty: 1 });
            }
            renderBatchInvTable();
        }
    });

    // 事件委派：batchInvTableBody（一次性綁定，取代每次重繪後重新綁定）
    document.getElementById('batchInvTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('.b-del');
        if (!btn) return;
        batchInvList.splice(parseInt(btn.dataset.idx), 1);
        renderBatchInvTable();
        invInput.focus();
    });
    document.getElementById('batchInvTableBody').addEventListener('change', (e) => {
        const el  = e.target;
        const idx = parseInt(el.dataset.idx);
        if (isNaN(idx)) return;
        if (el.classList.contains('b-name'))      batchInvList[idx].name       = el.value;
        else if (el.classList.contains('b-cat'))  batchInvList[idx].category   = el.value;
        else if (el.classList.contains('b-pts'))  batchInvList[idx].pointsCost = parseInt(el.value, 10) || 1;
        else if (el.classList.contains('b-qty'))  batchInvList[idx].adjustQty  = parseInt(el.value, 10) || 0;
    });

    function renderBatchInvTable() {
        const tbody = document.getElementById('batchInvTableBody');
        const btn = document.getElementById('batchInvSubmitBtn');
        const cats = getCategories();
        tbody.innerHTML = '';

        if (batchInvList.length === 0) {
            btn.disabled = true;
            btn.textContent = '無資料可送出';
            return;
        }

        btn.disabled = false;
        btn.textContent = `確認並送出 ${batchInvList.length} 筆資料`;

        batchInvList.forEach((item, idx) => {
            const tr = document.createElement('tr');
            
            let html = `<td><code>${escapeHtml(item.barcode)}</code> <span class="badge ${item.isNew?'badge-active':'badge-expired'}">${item.isNew?'全新建檔':'現有項目'}</span></td>`;

            if (item.isNew) {
                let catOpts = cats.map(c => `<option value="${escapeHtml(c)}" ${c === item.category ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
                html += `
                    <td><input type="text" class="b-name" data-idx="${idx}" value="${escapeHtml(item.name)}" placeholder="輸入名稱" required></td>
                    <td><select class="b-cat" data-idx="${idx}">${catOpts}</select></td>
                    <td><input type="number" class="b-pts" data-idx="${idx}" value="${item.pointsCost}" style="width:70px;" required min="1"></td>
                `;
            } else {
                const cc2 = getCatColor(item.category);
                html += `
                    <td>${escapeHtml(item.name)}</td>
                    <td><span class="badge" style="background:${cc2.bg}; color:${cc2.text};">${escapeHtml(item.category)}</span></td>
                    <td>${item.pointsCost}</td>
                `;
            }

            html += `
                <td>
                    <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:0.2rem;">現有:${item.currentQty}</div>
                    <input type="number" class="b-qty" data-idx="${idx}" value="${item.adjustQty}" style="width:80px;" required>
                </td>
                <td><button type="button" class="btn btn-sm btn-danger b-del" data-idx="${idx}">刪除</button></td>
            `;
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });

    }

    document.getElementById('batchInvForm').addEventListener('submit', (e) => {
        e.preventDefault();
        
        // Validate
        for (let i of batchInvList) {
            if (i.isNew && !i.name.trim()) { alert(`條碼 ${i.barcode} 請輸入名稱！`); return; }
        }

        const inv = getInventory();
        batchInvList.forEach(item => {
            if (item.isNew) {
                inv.push({ barcode: item.barcode, name: item.name, category: item.category, pointsCost: item.pointsCost, quantity: item.adjustQty });
                logInventoryChange(item.barcode, item.name, item.adjustQty, '批量建檔入庫');
            } else {
                const idx = inv.findIndex(x => x.barcode === item.barcode);
                inv[idx].quantity += item.adjustQty;
                if(inv[idx].quantity < 0) inv[idx].quantity = 0;
                logInventoryChange(item.barcode, item.name, item.adjustQty, '批量掃描補庫存');
            }
        });

        const addedCount = batchInvList.filter(i => i.isNew).length;
        const updatedCount = batchInvList.length - addedCount;
        saveInventory(inv);
        batchInvList = [];
        renderInventory();
        renderInventoryLog();
        closeModal('batchInventoryModal');
        alert(`入庫完成！新建品項 ${addedCount} 筆，補庫存 ${updatedCount} 筆。`);
    });

    // ==== Members ====
    let memEditState    = {};
    let memOriginalPts  = {};
    let selectedMemberIds = new Set();

    function syncMemSaveBarTops() {
        const batchBar = document.getElementById('memBatchBar');
        const saveBar  = document.getElementById('memSaveBar');
        const batchVisible = !batchBar.classList.contains('hidden');
        saveBar.style.top = batchVisible ? (batchBar.offsetHeight + 'px') : '';
    }

    function updateMemBatchBar() {
        const count = selectedMemberIds.size;
        document.getElementById('memBatchBar').classList.toggle('hidden', count === 0);
        document.getElementById('memBatchCount').textContent = count;
        const allIds = getMembers().map(m => m.id);
        const cb = document.getElementById('selectAllMembers');
        if (cb) {
            const allSel  = allIds.length > 0 && allIds.every(id => selectedMemberIds.has(id));
            const noneSel = allIds.every(id => !selectedMemberIds.has(id));
            cb.checked       = allSel;
            cb.indeterminate = !allSel && !noneSel;
        }
        syncMemSaveBarTops();
    }

    document.getElementById('selectAllMembers').addEventListener('change', (e) => {
        getMembers().forEach(m => e.target.checked ? selectedMemberIds.add(m.id) : selectedMemberIds.delete(m.id));
        renderMembers();
        updateMemBatchBar();
    });

    document.getElementById('memBatchClearBtn').addEventListener('click', () => {
        selectedMemberIds.clear();
        renderMembers();
        updateMemBatchBar();
    });

    document.getElementById('memBatchTopupBtn').addEventListener('click', () => {
        if (selectedMemberIds.size === 0) return;
        if (Object.keys(memEditState).length > 0) {
            if (!confirm('有會員資料尚未儲存，批量補點將套用至已儲存的資料。確定繼續嗎？')) return;
        }
        const names = getMembers().filter(m => selectedMemberIds.has(m.id)).map(m => escapeHtml(m.name));
        document.getElementById('batchTopupInfo').innerHTML =
            `將對以下 <strong>${names.length}</strong> 位會員執行點數異動：<br>
            <span style="color:var(--text-secondary);">${names.join('、')}</span>`;
        document.getElementById('batchTopupForm').reset();
        document.getElementById('batchTopupError').style.display = 'none';
        document.getElementById('batchTopupPreview').classList.add('hidden');
        openModal('batchTopupModal');
    });

    // 即時預覽補點結果
    document.getElementById('batchTopupAmount').addEventListener('input', updateBatchTopupPreview);

    function updateBatchTopupPreview() {
        const amount = parseInt(document.getElementById('batchTopupAmount').value, 10);
        const preview = document.getElementById('batchTopupPreview');
        if (isNaN(amount) || amount === 0) { preview.classList.add('hidden'); return; }
        const members = getMembers().filter(m => selectedMemberIds.has(m.id));
        const lines = members.map(m => {
            const newPts = Math.max(0, m.points + amount);
            const delta  = newPts - m.points;
            const sign   = delta >= 0 ? '+' : '';
            return `${escapeHtml(m.name)}：${m.points} → <strong>${newPts}</strong>（${sign}${delta}）`;
        });
        preview.classList.remove('hidden');
        preview.innerHTML = `<div style="font-weight:600; margin-bottom:0.4rem;">異動預覽</div>${lines.join('<br>')}`;
    }

    document.getElementById('batchTopupForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const errEl  = document.getElementById('batchTopupError');
        const amount = parseInt(document.getElementById('batchTopupAmount').value, 10);
        const note   = document.getElementById('batchTopupNote').value.trim();

        errEl.style.display = 'none';
        if (isNaN(amount) || amount === 0) {
            errEl.textContent = '請輸入有效的點數數量（不可為 0）';
            errEl.style.display = 'block'; return;
        }
        if (!note) {
            errEl.textContent = '請填寫異動原因';
            errEl.style.display = 'block'; return;
        }

        const members  = getMembers();
        const type     = amount > 0 ? 'topup' : 'deduct';
        const affected = selectedMemberIds.size;

        selectedMemberIds.forEach(id => {
            const idx = members.findIndex(m => m.id === id);
            if (idx === -1) return;
            const newPts     = Math.max(0, members[idx].points + amount);
            const actualDelta = newPts - members[idx].points;
            members[idx].points = newPts;
            logPointChange(id, members[idx].name, actualDelta, type, `批量${amount > 0 ? '補點' : '扣點'}：${note}`);
        });

        saveMembers(members);
        selectedMemberIds.clear();
        closeModal('batchTopupModal');
        renderMembers();
        updateMemBatchBar();
        renderDashboard();
        alert(`已完成批量${amount > 0 ? '補點' : '扣點'}，共影響 ${affected} 位會員。`);
    });

    function updateMemSaveBar() {
        const count = Object.keys(memEditState).length;
        document.getElementById('memSaveBar').classList.toggle('hidden', count === 0);
        document.getElementById('memEditCount').textContent = count;
        syncMemSaveBarTops();
    }

    document.getElementById('memSaveAllBtn').addEventListener('click', () => {
        const members = getMembers();
        Object.entries(memEditState).forEach(([id, data]) => {
            const idx = members.findIndex(m => m.id === id);
            if (idx === -1) return;
            const origPts = memOriginalPts[id] ?? members[idx].points;
            if (data.points !== origPts) {
                logPointChange(id, members[idx].name, data.points - origPts, data.points > origPts ? 'topup' : 'deduct', '管理員列表直接編輯');
            }
            members[idx].name   = data.name;
            members[idx].phone  = data.phone;
            members[idx].points = data.points;
            members[idx].status = data.status;
        });
        saveMembers(members);
        memEditState   = {};
        memOriginalPts = {};
        renderMembers();
        updateMemSaveBar();
        renderDashboard();
    });

    document.getElementById('memCancelAllBtn').addEventListener('click', () => {
        memEditState   = {};
        memOriginalPts = {};
        renderMembers();
        updateMemSaveBar();
    });

    // 事件委派：membersTableBody
    document.getElementById('membersTableBody').addEventListener('click', async (e) => {
        const editBtn   = e.target.closest('.mem-edit-btn');
        const cancelBtn = e.target.closest('.mem-cancel-btn');
        const resetBtn  = e.target.closest('.reset-pwd-btn');
        const histBtn   = e.target.closest('.mem-hist-btn');
        if (editBtn) {
            const m = getMembers().find(x => x.id === editBtn.dataset.id);
            if (!m) return;
            memOriginalPts[m.id] = m.points;
            memEditState[m.id]   = { name: m.name, phone: m.phone, points: m.points, status: m.status };
            updateMemSaveBar();
            renderMembers();
        } else if (cancelBtn) {
            delete memEditState[cancelBtn.dataset.id];
            delete memOriginalPts[cancelBtn.dataset.id];
            updateMemSaveBar();
            renderMembers();
        } else if (resetBtn) {
            if (confirm('確定要將此會員的密碼還原為他的手機號嗎？')) {
                const mlist  = getMembers();
                const target = mlist.find(x => x.id === resetBtn.dataset.id);
                target.password    = await hashPassword(resetBtn.dataset.phone);
                target.isFirstLogin = false;
                saveMembers(mlist);
                alert(`已重設為手機號：${resetBtn.dataset.phone}`);
            }
        } else if (histBtn) {
            openMemberHistoryModal(histBtn.dataset.id);
        }
    });
    document.getElementById('membersTableBody').addEventListener('change', (e) => {
        const cb = e.target.closest('.mem-cb');
        if (cb) {
            cb.checked ? selectedMemberIds.add(cb.dataset.id) : selectedMemberIds.delete(cb.dataset.id);
            updateMemBatchBar();
            return;
        }
        const field = e.target.closest('.mem-field');
        if (!field) return;
        const id = field.dataset.id, fn = field.dataset.field;
        if (!memEditState[id]) return;
        memEditState[id][fn] = fn === 'points' ? (parseInt(field.value, 10) || 0) : field.value;
    });

    document.getElementById('memSearchInput').addEventListener('input', renderMembers);

    function renderMembers() {
        const members = getMembers();
        const search  = document.getElementById('memSearchInput').value.trim().toLowerCase();
        const tbody   = document.getElementById('membersTableBody');
        tbody.innerHTML = '';

        members.filter(m => {
            if (search && !m.name.toLowerCase().includes(search) && !m.phone.includes(search) && !m.barcode.toLowerCase().includes(search)) return false;
            return true;
        }).forEach(m => {
            const isEditing = !!memEditState[m.id];
            const d       = isEditing ? memEditState[m.id] : m;
            const mid     = escapeHtml(m.id);
            const checked = selectedMemberIds.has(m.id) ? 'checked' : '';
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

    document.getElementById('addMemberBtn').addEventListener('click', () => openMemberModal());

    function openMemberModal() {
        document.getElementById('memModalTitle').textContent = '新增會員';
        document.getElementById('memberForm').reset();
        document.getElementById('memEditOnlySection').classList.add('hidden');
        openModal('memberModal');
    }

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
        renderMembers();
        closeModal('memberModal');
    });

    // ==== 會員資料匯入 ====
    let _importClassified = null;

    document.getElementById('importMembersBtn').addEventListener('click', () => {
        document.getElementById('importFileInput').value = '';
        document.getElementById('importError').classList.add('hidden');
        document.getElementById('importPreviewSection').classList.add('hidden');
        document.getElementById('importConfirmBtn').classList.add('hidden');
        document.querySelector('input[name="importMode"][value="add"]').checked = true;
        _importClassified = null;
        openModal('memberImportModal');
    });

    document.getElementById('importCancelBtn').addEventListener('click', () => closeModal('memberImportModal'));

    document.getElementById('importFileInput').addEventListener('change', runImportParse);
    document.querySelectorAll('input[name="importMode"]').forEach(r =>
        r.addEventListener('change', () => {
            if (document.getElementById('importFileInput').files.length) runImportParse();
        })
    );

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
            try { rows = parseCsvText(e.target.result); }
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

    function showImportError(msg) {
        const el = document.getElementById('importError');
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    // ---- CSV 解析 ----
    function parseCsvText(raw) {
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // strip BOM
        const lines = raw.split(/\r?\n/).filter(l => l.trim() !== '');
        if (lines.length < 1) return null;
        const headers = parseCsvRow(lines[0]);
        if (lines.length < 2) return [];
        return lines.slice(1).map(line => {
            const cells = parseCsvRow(line);
            const obj = {};
            headers.forEach((h, i) => { obj[h.trim()] = (cells[i] ?? '').trim(); });
            return obj;
        });
    }

    function parseCsvRow(line) {
        const cells = [];
        let i = 0, cur = '';
        while (i < line.length) {
            if (line[i] === '"') {
                i++;
                while (i < line.length) {
                    if (line[i] === '"' && line[i + 1] === '"') { cur += '"'; i += 2; }
                    else if (line[i] === '"') { i++; break; }
                    else { cur += line[i++]; }
                }
            } else if (line[i] === ',') {
                cells.push(cur); cur = ''; i++;
            } else {
                cur += line[i++];
            }
        }
        cells.push(cur);
        return cells;
    }

    // ---- 驗證與分類 ----
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

            // 電話是否被其他 ID 使用
            const phoneOwner = byPhone[phone];
            if (phoneOwner && phoneOwner.id !== rawId)
                return err(`電話已被其他會員（${phoneOwner.id}）使用`);

            csvPhones.add(phone);
            if (rawId) csvIds.add(rawId);

            // 已存在的 ID → 依模式決定更新或跳過
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

            // 全新會員 — 確認或產生 ID
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

    // ---- 預覽渲染 ----
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
        tbody.innerHTML = '';
        classified.forEach(item => {
            const s     = STYLE[item.action];
            const id    = item.member?.id    || item.row['會員ID'] || '—';
            const name  = item.member?.name  || item.row['姓名']   || '—';
            const phone = item.member?.phone || item.row['電話']   || '—';
            const pts   = item.member != null ? item.member.points : (item.row['剩餘點數'] || '—');
            const tr    = document.createElement('tr');
            tr.innerHTML = `
                <td><span class="badge" style="background:${s.bg};color:${s.color};">${s.label}</span></td>
                <td><code>${escapeHtml(String(id))}</code></td>
                <td>${escapeHtml(String(name))}</td>
                <td>${escapeHtml(String(phone))}</td>
                <td>${escapeHtml(String(pts))}</td>
                <td style="font-size:0.8rem;color:${item.action === 'error' ? 'var(--danger)' : 'var(--text-secondary)'};">${escapeHtml(item.reason || '')}</td>
            `;
            tbody.appendChild(tr);
        });

        const canImport = counts.add + counts.update > 0;
        const btn = document.getElementById('importConfirmBtn');
        btn.classList.toggle('hidden', !canImport);
        if (canImport) btn.textContent = `確認匯入 ${counts.add + counts.update} 筆`;
    }

    // ---- 執行匯入 ----
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
        _importClassified = null;
        closeModal('memberImportModal');
        renderMembers();
        updateMemBatchBar();
        renderDashboard();
        alert(`匯入完成！新增 ${addCount} 筆，更新 ${updateCount} 筆。`);
    });

    // ==== Batch Redemptions ====
    const redeemTargetMember = { lock: null };
    let batchRedeemList = [];

    // 事件委派：brTableBody（一次性綁定）
    document.getElementById('brTableBody').addEventListener('click', (e) => {
        const btn = e.target.closest('.br-del');
        if (!btn) return;
        batchRedeemList.splice(parseInt(btn.dataset.idx), 1);
        renderBatchRedeemTable();
        document.getElementById('brItemScanner').focus();
    });

    function resetBatchRedeem() {
        redeemTargetMember.lock = null;
        batchRedeemList = [];
        renderBatchRedeemTable(); // 清空 DOM 並隱藏 table/summary/submit
        document.getElementById('brStep2').classList.add('hidden');
        document.getElementById('brMemberScanner').disabled = false;
        document.getElementById('brMemberScanner').value = '';
        document.getElementById('brItemScanner').value = '';
    }

    document.getElementById('brClearAllBtn').addEventListener('click', () => {
        if (!confirm(`確定要清空清單中的 ${batchRedeemList.length} 件物品嗎？`)) return;
        batchRedeemList = [];
        renderBatchRedeemTable();
        document.getElementById('brItemScanner').focus();
    });

    document.getElementById('startRedeemBtn').addEventListener('click', () => {
        resetBatchRedeem();
        openModal('batchRedeemModal');
        setTimeout(() => document.getElementById('brMemberScanner').focus(), 100);
    });

    document.getElementById('brMemberScanner').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const val = e.target.value.trim();
            const m = getMembers().find(x => x.barcode === val || x.id === val || x.phone === val);
            if (!m) { alert('查無此會員！'); e.target.value = ''; return; }
            if (m.status === 'expired') { alert('過期會員無法兌換！'); e.target.value = ''; return; }
            
            redeemTargetMember.lock = m;
            e.target.disabled = true;
            document.getElementById('brStep2').classList.remove('hidden');
            document.getElementById('brMemberDisplay').innerHTML = `🛒 ${escapeHtml(m.name)}`;
            updateBrBalanceDisplay(0);
            setTimeout(() => document.getElementById('brItemScanner').focus(), 50);
        }
    });

    document.getElementById('brChangeMemberBtn').addEventListener('click', () => {
        redeemTargetMember.lock = null;
        batchRedeemList = [];
        document.getElementById('brStep2').classList.add('hidden');
        const mInput = document.getElementById('brMemberScanner');
        mInput.disabled = false;
        mInput.value = '';
        mInput.focus();
        renderBatchRedeemTable();
    });

    let debounceT = null;
    document.getElementById('brItemScanner').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const code = e.target.value.trim();
            e.target.value = '';
            if (!code) return;

            // Simple debounce if scanner scans too fast
            clearTimeout(debounceT);
            debounceT = setTimeout(() => {
                const i = getInventory().find(x => x.barcode === code);
                if (!i) { alert('查無此物品條碼！'); return; }
                
                // Track scanned quantity vs inventory
                const existsCount = batchRedeemList.filter(x => x.barcode === code).length;
                if (existsCount + 1 > i.quantity) {
                    alert(`【${i.name}】扣除本次已掃描數量後，庫存不足！`); return;
                }

                batchRedeemList.push(i);
                renderBatchRedeemTable();
                
                // return focus natively
            }, 50);
        }
    });

    function updateBrBalanceDisplay(usedPts) {
        const el = document.getElementById('brRunningBalance');
        if (!el || !redeemTargetMember.lock) return;
        const balance = redeemTargetMember.lock.points;
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
        const tbody = document.getElementById('brTableBody');
        const ts    = document.getElementById('brTableSection');
        const sum   = document.getElementById('brSummarySection');
        const sub   = document.getElementById('batchRedeemSubmitBtn');
        const warn  = document.getElementById('brPointsWarning');
        const clearRow = document.getElementById('brClearAllRow');
        tbody.innerHTML = '';

        if (batchRedeemList.length === 0) {
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

        batchRedeemList.forEach((r, idx) => {
            totalPts += r.pointsCost;
            const scannedCount = batchRedeemList.filter(x => x.barcode === r.barcode).length;
            const remainingQty = r.quantity - scannedCount;
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

        document.getElementById('brTotalCount').textContent = batchRedeemList.length;
        document.getElementById('brTotalPoints').textContent = totalPts;
        updateBrBalanceDisplay(totalPts);

        const memberBalance = redeemTargetMember.lock.points;
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

    document.getElementById('batchRedeemForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const member = redeemTargetMember.lock;
        let totalPts = batchRedeemList.reduce((sum, item) => sum + item.pointsCost, 0);
        
        if (member.points < totalPts) return; // double check

        const redemptions = getRedemptions();
        const inventory = getInventory();
        const members = getMembers();

        const maxRId = redemptions.reduce((max, r) => {
            const n = parseInt(r.id.replace(/\D/g, ''), 10) || 0;
            return n > max ? n : max;
        }, 0);
        let baseId = maxRId;
        batchRedeemList.forEach((item, i) => {
            // Deduct Inv
            const invIdx = inventory.findIndex(x => x.barcode === item.barcode);
            inventory[invIdx].quantity -= 1;

            // Record
            baseId++;
            const redeemDate = new Date().toISOString();
            redemptions.push({
                id: 'R' + String(baseId).padStart(3, '0'),
                memberId: member.id,
                itemBarcode: item.barcode,
                itemName: item.name,
                category: item.category,
                pointsCost: item.pointsCost,
                date: redeemDate
            });
            logPointChange(member.id, member.name, -item.pointsCost, 'redeem', `兌換：${item.name}`);
        });

        // Deduct Pts
        const memIdx = members.findIndex(x => x.id === member.id);
        members[memIdx].points -= totalPts;

        saveInventory(inventory);
        saveRedemptions(redemptions);
        saveMembers(members);

        resetBatchRedeem();
        closeModal('batchRedeemModal');
        renderRedemptionsHistory();
        renderDashboard();
        renderInventory();
        renderMembers();
    });

    let redemptionShowAll = false;

    document.getElementById('redemptionSearchInput').addEventListener('input', renderRedemptionsHistory);
    document.getElementById('toggleShowAllRedemptions').addEventListener('click', () => {
        redemptionShowAll = !redemptionShowAll;
        document.getElementById('toggleShowAllRedemptions').textContent = redemptionShowAll ? '只顯示最近 15 筆' : '顯示全部';
        renderRedemptionsHistory();
    });

    function renderRedemptionsHistory() {
        const search  = document.getElementById('redemptionSearchInput').value.trim().toLowerCase();
        const members = getMembers();
        const all     = getRedemptions().sort((a, b) => new Date(b.date) - new Date(a.date));

        const filtered = all.filter(r => {
            if (!search) return true;
            const m = members.find(x => x.id === r.memberId);
            const name = m ? m.name.toLowerCase() : r.memberId.toLowerCase();
            return name.includes(search) || r.itemName.toLowerCase().includes(search);
        });

        const display = redemptionShowAll ? filtered : filtered.slice(0, 15);
        const tb = document.getElementById('redemptionTableBody');
        tb.innerHTML = '';

        tb.innerHTML = display.map(r => {
            const m   = members.find(x => x.id === r.memberId);
            const cat = resolveCategory(r);
            const cc  = getCatColor(cat);
            return `<tr>
                <td><small style="color:var(--text-secondary)">${escapeHtml(r.id)}</small></td>
                <td>${fmtDisp(r.date)}</td>
                <td><strong>${escapeHtml(m ? m.name : r.memberId)}</strong></td>
                <td>${escapeHtml(r.itemName)} <span class="badge" style="background:${cc.bg};color:${cc.text};margin-left:0.4rem;">${escapeHtml(cat)}</span></td>
                <td><span style="color:var(--danger);">-${r.pointsCost}</span></td>
            </tr>`;
        }).join('');

        document.getElementById('redemptionCountInfo').textContent =
            search ? `搜尋結果：顯示 ${display.length} / ${filtered.length} 筆` :
            redemptionShowAll ? `共 ${filtered.length} 筆` : `顯示最近 ${display.length} 筆（共 ${filtered.length} 筆）`;
    }


    // ==== 會員兌換紀錄 Modal ====
    function openMemberHistoryModal(memberId) {
        const m = getMembers().find(x => x.id === memberId);
        if (!m) return;
        document.getElementById('memberHistoryTitle').textContent = `${m.name} 的兌換紀錄`;

        const history = getRedemptions()
            .filter(r => r.memberId === memberId)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('memberHistoryTableBody');
        tbody.innerHTML = '';

        if (history.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-secondary);">尚無兌換紀錄</td></tr>';
        } else {
            tbody.innerHTML = history.map(r => {
                const cat = resolveCategory(r);
                const cc  = getCatColor(cat);
                return `<tr>
                    <td>${fmtDisp(r.date)}</td>
                    <td>${escapeHtml(r.itemName)}</td>
                    <td><span class="badge" style="background:${cc.bg};color:${cc.text};">${escapeHtml(cat)}</span></td>
                    <td><span style="color:var(--danger);">-${r.pointsCost}</span></td>
                </tr>`;
            }).join('');
        }

        openModal('memberHistoryModal');
    }

    // ==== 資料管理 ====

    // CSV 工具
    function escapeCsvCell(val) {
        const s = String(val ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }

    function downloadCsv(filename, headers, rows) {
        const bom = '\uFEFF'; // UTF-8 BOM，讓 Excel 正確辨識繁中
        const content = bom + [
            headers.map(escapeCsvCell).join(','),
            ...rows.map(row => row.map(escapeCsvCell).join(','))
        ].join('\r\n');
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function fmtDateTime(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    function todayStr() {
        return new Date().toISOString().split('T')[0];
    }

    // ---- 匯出事件 ----
    document.getElementById('exportMembersBtn').addEventListener('click', () => {
        const members = getMembers();
        const headers = ['會員ID','姓名','電話','狀態','剩餘點數','加入日期','生日','地址','條碼'];
        const rows = members.map(m => [
            m.id, m.name, m.phone,
            m.status === 'active' ? '使用中' : '已過期停權',
            m.points, m.joinDate || '', m.birthday || '', m.address || '', m.barcode
        ]);
        downloadCsv(`會員清單_${todayStr()}.csv`, headers, rows);
    });

    document.getElementById('exportRedemptionsBtn').addEventListener('click', () => {
        const members = getMembers();
        const rows = getRedemptions()
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(r => {
                const m = members.find(x => x.id === r.memberId);
                return [r.id, fmtDateTime(r.date), r.memberId, m ? m.name : r.memberId, r.itemBarcode || '', r.itemName, r.category || '', r.pointsCost];
            });
        downloadCsv(`兌換紀錄_${todayStr()}.csv`,
            ['交易序號','兌換時間','會員ID','會員姓名','物品條碼','物品名稱','分類','扣除點數'],
            rows);
    });

    document.getElementById('exportPointsLogBtn').addEventListener('click', () => {
        const typeLabels = { init: '初始發放', topup: '補點', deduct: '扣點', redeem: '兌換核銷' };
        const rows = getPointsLog()
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(e => [e.id, fmtDateTime(e.date), e.memberId, e.memberName || '', e.delta, typeLabels[e.type] || e.type, e.note || '']);
        downloadCsv(`點數異動紀錄_${todayStr()}.csv`,
            ['記錄ID','時間','會員ID','會員姓名','異動點數','類型','備註'],
            rows);
    });

    document.getElementById('exportInventoryLogBtn').addEventListener('click', () => {
        const rows = getInventoryLog()
            .sort((a, b) => new Date(a.date) - new Date(b.date))
            .map(e => [e.id, fmtDateTime(e.date), e.barcode, e.itemName, e.delta, e.note || '']);
        downloadCsv(`入庫歷史_${todayStr()}.csv`,
            ['記錄ID','時間','條碼','品項名稱','入庫數量','備註'],
            rows);
    });

    document.getElementById('exportInventoryBtn').addEventListener('click', () => {
        const rows = getInventory().map(i => [i.barcode, i.name, i.category || '', i.quantity, i.pointsCost]);
        downloadCsv(`現有庫存_${todayStr()}.csv`,
            ['條碼','名稱','分類','庫存量','預設點數'],
            rows);
    });

    // ---- 清除歷史資料 ----
    let pendingClearJob = null;

    function inDateRange(isoStr, start, end) {
        const t = new Date(isoStr).getTime();
        return t >= start && t <= end;
    }

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
        if (!doRedemptions && !doPointsLog && !doInventoryLog) return null;

        const counts = {};
        if (doRedemptions)  counts.redemptions  = getRedemptions().filter(r => inDateRange(r.date, start, end)).length;
        if (doPointsLog)    counts.pointsLog    = getPointsLog().filter(e => inDateRange(e.date, start, end)).length;
        if (doInventoryLog) counts.inventoryLog = getInventoryLog().filter(e => inDateRange(e.date, start, end)).length;

        const total = Object.values(counts).reduce((s, n) => s + n, 0);
        return { start, end, startVal, endVal, doRedemptions, doPointsLog, doInventoryLog, counts, total };
    }

    document.getElementById('previewClearBtn').addEventListener('click', () => {
        const previewBox = document.getElementById('clearPreviewBox');
        const job = computeClearPreview();

        if (!job) {
            previewBox.classList.remove('hidden');
            previewBox.innerHTML = '<span style="color:var(--danger);">請選擇有效的日期區間，並至少勾選一種資料類型。</span>';
            pendingClearJob = null;
            return;
        }

        pendingClearJob = job;
        const lines = [];
        if (job.doRedemptions)  lines.push(`• 兌換紀錄：<strong>${job.counts.redemptions}</strong> 筆`);
        if (job.doPointsLog)    lines.push(`• 點數異動紀錄：<strong>${job.counts.pointsLog}</strong> 筆`);
        if (job.doInventoryLog) lines.push(`• 入庫歷史：<strong>${job.counts.inventoryLog}</strong> 筆`);

        previewBox.classList.remove('hidden');
        previewBox.innerHTML = `
            <div style="font-weight:600; margin-bottom:0.4rem; color:#92400e;">📅 清除範圍：${job.startVal} 至 ${job.endVal}</div>
            ${lines.join('<br>')}
            <div style="margin-top:0.5rem; color:${job.total > 0 ? 'var(--danger)' : 'var(--success)'}; font-weight:600;">
                ${job.total > 0 ? `共 ${job.total} 筆資料將被刪除` : '此區間內無符合條件的資料'}
            </div>`;
    });

    document.getElementById('confirmClearBtn').addEventListener('click', () => {
        if (!pendingClearJob) { alert('請先按「預覽將刪除的筆數」確認範圍。'); return; }
        if (pendingClearJob.total === 0) { alert('此區間內無符合條件的資料，無需清除。'); return; }

        const { counts, doRedemptions, doPointsLog, doInventoryLog, startVal, endVal } = pendingClearJob;
        document.getElementById('clearDataSummary').innerHTML = `
            <p>確定要清除以下資料嗎？<strong style="color:var(--danger);">此操作無法復原。</strong></p>
            <ul style="margin:0.75rem 0 0 1.25rem;">
                ${doRedemptions  ? `<li>兌換紀錄：<strong>${counts.redemptions}</strong> 筆</li>` : ''}
                ${doPointsLog    ? `<li>點數異動紀錄：<strong>${counts.pointsLog}</strong> 筆</li>` : ''}
                ${doInventoryLog ? `<li>入庫歷史：<strong>${counts.inventoryLog}</strong> 筆</li>` : ''}
            </ul>
            <p style="margin-top:0.75rem;">日期範圍：<strong>${startVal} ～ ${endVal}</strong></p>`;

        document.getElementById('clearConfirmInput').value = '';
        document.getElementById('executeClearBtn').disabled = true;
        openModal('clearDataModal');
    });

    document.getElementById('cancelClearModalBtn').addEventListener('click', () => closeModal('clearDataModal'));

    document.getElementById('clearConfirmInput').addEventListener('input', (e) => {
        document.getElementById('executeClearBtn').disabled = e.target.value !== '確認清除';
    });

    document.getElementById('executeClearBtn').addEventListener('click', () => {
        if (!pendingClearJob) return;
        const { start, end, doRedemptions, doPointsLog, doInventoryLog } = pendingClearJob;

        if (doRedemptions)  saveRedemptions(getRedemptions().filter(r => !inDateRange(r.date, start, end)));
        if (doPointsLog)    savePointsLog(getPointsLog().filter(e => !inDateRange(e.date, start, end)));
        if (doInventoryLog) saveInventoryLog(getInventoryLog().filter(e => !inDateRange(e.date, start, end)));

        pendingClearJob = null;
        closeModal('clearDataModal');
        document.getElementById('clearPreviewBox').classList.add('hidden');
        document.getElementById('clearStartDate').value = '';
        document.getElementById('clearEndDate').value   = '';

        renderDashboard();
        renderRedemptionsHistory();
        renderInventoryLog();

        alert('歷史資料清除完成！');
    });

    // 最後執行畫面初始化，避免中斷前面的事件綁定
    initAdminApp();
});
