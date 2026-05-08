// admin_core.js — 共用核心：認證、導覽、Modal、共用工具、目前管理員、權限可見性、閒置登出
window.Core = (function () {
    let _currentAdmin = null;
    const _charts = {};
    const _invCatCache = {};
    const IDLE_LIMIT_MS = 30 * 60 * 1000; // #6 閒置 30 分鐘自動登出
    let _idleTimer = null;

    // ---- 共用常數 ----
    const LOW_STOCK_THRESHOLD = 5;
    const chartColors = ['#f87171', '#fb923c', '#fbbf24', '#34d399', '#38bdf8', '#818cf8', '#c084fc', '#f472b6'];
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

    // ---- Modal helpers ----
    const openModal  = (id) => document.getElementById(id).classList.add('active');
    const closeModal = (id) => document.getElementById(id).classList.remove('active');

    // ---- Toast 通知 ----
    function ensureToastHost() {
        let host = document.getElementById('toastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'toastHost';
            host.className = 'toast-host';
            document.body.appendChild(host);
        }
        return host;
    }
    function toast(message, type = 'success', durationMs = 3000) {
        const host = ensureToastHost();
        const el = document.createElement('div');
        el.className = `toast toast-${type}`;
        el.textContent = message;
        host.appendChild(el);
        // 觸發進場動畫
        requestAnimationFrame(() => el.classList.add('toast-show'));
        setTimeout(() => {
            el.classList.remove('toast-show');
            el.addEventListener('transitionend', () => el.remove(), { once: true });
        }, durationMs);
    }

    // ---- 時間格式 ----
    function fmtDisp(isoStr) {
        const d = new Date(isoStr);
        return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    function fmtDateTime(isoStr) {
        if (!isoStr) return '';
        const d = new Date(isoStr);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    function todayStr() { return new Date().toISOString().split('T')[0]; }

    // ---- 圖表 ----
    function drawChart(id, type, dataConfig, optionsConfig = {}) {
        if (typeof Chart === 'undefined') return;
        const ctx = document.getElementById(id);
        if (!ctx) return;
        if (_charts[id]) _charts[id].destroy();
        _charts[id] = new Chart(ctx.getContext('2d'), {
            type, data: dataConfig,
            options: { responsive: true, maintainAspectRatio: false, ...optionsConfig }
        });
    }
    function drawPie(id, catMap) {
        const labels = Object.keys(catMap);
        drawChart(id, 'pie', {
            labels: labels.length ? labels : ['本期無資料'],
            datasets: [{ data: labels.length ? Object.values(catMap) : [1], backgroundColor: labels.length ? chartColors : ['#e2e8f0'], borderWidth: labels.length ? 1 : 0 }]
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

    // ---- 分類色票 / 分類解析 ----
    function getCatColor(cat) {
        const stored = getCatColors();
        if (stored[cat]) return stored[cat];
        const idx = getCategories().indexOf(cat);
        if (idx === -1) return { bg: '#f1f5f9', text: '#64748b' };
        return CAT_PALETTE[idx % CAT_PALETTE.length];
    }
    function resolveCategory(r) {
        if (!_invCatCache._built) {
            getInventory().forEach(i => { _invCatCache[i.barcode] = i.category; });
            _invCatCache._built = true;
        }
        return _invCatCache[r.itemBarcode] || r.category || '未分類';
    }
    function clearCatCache() { Object.keys(_invCatCache).forEach(k => delete _invCatCache[k]); _invCatCache._built = false; }

    // ---- 年份列表 ----
    function getAvailableYears() {
        const years = new Set(getRedemptions().map(r => new Date(r.date).getFullYear()));
        years.add(new Date().getFullYear());
        return [...years].sort((a, b) => b - a);
    }

    // ---- CSV 工具 ----
    function escapeCsvCell(val) {
        const s = String(val ?? '');
        if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
            return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
    }
    function downloadCsv(filename, headers, rows) {
        const bom = '﻿';
        const content = bom + [
            headers.map(escapeCsvCell).join(','),
            ...rows.map(row => row.map(escapeCsvCell).join(','))
        ].join('\r\n');
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
    }

    // CSV 解析（支援 BOM、雙引號跳脫、跨平台換行）
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
            } else if (line[i] === ',') { cells.push(cur); cur = ''; i++; }
            else { cur += line[i++]; }
        }
        cells.push(cur);
        return cells;
    }
    function parseCsvText(raw) {
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
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

    // ---- 目前管理員 / 權限 ----
    function refreshCurrentAdmin() { _currentAdmin = getCurrentAdmin(); return _currentAdmin; }
    function isSuper() { return _currentAdmin && _currentAdmin.role === 'super'; }
    function getCurrent() { return _currentAdmin; }

    function renderCurrentAdminBadge() {
        refreshCurrentAdmin();
        const el = document.getElementById('currentAdminInfo');
        if (!el || !_currentAdmin) return;
        const roleLabel = _currentAdmin.role === 'super'
            ? '<span style="color:var(--success); font-weight:600;">super</span>'
            : '<span style="color:var(--text-secondary); font-weight:600;">staff</span>';
        el.innerHTML = `登入中：<strong>${escapeHtml(_currentAdmin.username)}</strong><br>角色：${roleLabel}`;
    }

    function applyRoleVisibility() {
        const showSuperOnly = isSuper();
        document.querySelectorAll('[data-role-only="super"]').forEach(el => {
            el.classList.toggle('hidden', !showSuperOnly);
        });
    }

    // ---- 導覽 ----
    function setupNavigation(handlers) {
        const navItems = document.querySelectorAll('.nav-item');
        const sections = ['dashboardView', 'inventoryView', 'membersView', 'redemptionsView', 'dataView', 'adminManageView'];
        navItems.forEach(nav => {
            nav.addEventListener('click', (e) => {
                navItems.forEach(n => n.classList.remove('active'));
                e.target.classList.add('active');
                const targetId = e.target.getAttribute('data-target');
                sections.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.toggle('hidden', id !== targetId);
                });
                const handler = handlers && handlers[targetId];
                if (typeof handler === 'function') handler();
            });
        });
    }

    // ---- Modal close-btn 通用處理（intercepts: { modalId: () => boolean | void }） ----
    function setupModalClose(intercepts = {}) {
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const modalId = btn.getAttribute('data-modal');
                const intercept = intercepts[modalId];
                if (typeof intercept === 'function' && intercept() === false) return;
                document.getElementById(modalId).classList.remove('active');
            });
        });
    }

    // ---- #6 閒置自動登出 ----
    function logoutAndRedirect(reason) {
        logAdminAction('LOGOUT', _currentAdmin ? _currentAdmin.username : '', reason || '');
        clearAdminSession();
        sessionStorage.removeItem('adminToken');
        window.location.href = 'index.html';
    }

    function resetIdleTimer() {
        clearTimeout(_idleTimer);
        _idleTimer = setTimeout(() => {
            alert('已閒置 30 分鐘，自動登出。');
            logoutAndRedirect('閒置自動登出');
        }, IDLE_LIMIT_MS);
    }

    function startIdleWatcher() {
        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetIdleTimer, { passive: true });
        });
        resetIdleTimer();
    }

    // ---- bootstrap ----
    async function bootstrap(onReady) {
        const adminToken = sessionStorage.getItem('adminToken');
        if (!await verifyAdminSession(adminToken)) {
            window.location.href = 'index.html';
            return;
        }
        refreshCurrentAdmin();

        document.getElementById('adminLogoutBtn').addEventListener('click', () => logoutAndRedirect());
        renderCurrentAdminBadge();
        startIdleWatcher();

        if (typeof onReady === 'function') onReady();
    }

    return {
        bootstrap, setupNavigation, setupModalClose, logoutAndRedirect,
        isSuper, getCurrent, refreshCurrentAdmin, renderCurrentAdminBadge, applyRoleVisibility,
        openModal, closeModal, toast,
        fmtDisp, fmtDateTime, todayStr,
        drawChart, drawPie, buildStatCard, trendBadge,
        getCatColor, resolveCategory, clearCatCache,
        getAvailableYears,
        escapeCsvCell, downloadCsv, parseCsvText, parseCsvRow,
        LOW_STOCK_THRESHOLD, CAT_PALETTE
    };
})();
