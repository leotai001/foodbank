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

    // ---- Modal helpers（含無障礙：role/aria、focus trap、焦點還原、Esc 關閉）----
    // 焦點工具 trapFocus / getFocusableElements 來自 data.js（會員端與後台共用）。
    const _modalReturnFocus = {}; // id -> 開啟前的觸發元素
    const _modalTrapDetach  = {}; // id -> focus trap 解除函式
    const _modalEscHandler  = {}; // id -> Esc 監聽器

    function openModal(id) {
        const overlay = document.getElementById(id);
        if (!overlay) return;
        const content = overlay.querySelector('.modal-content') || overlay;

        // role / aria 標記（讓螢幕閱讀器宣告為對話框並讀出標題）
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');
        const titleEl = content.querySelector('.modal-header h3') || content.querySelector('h3');
        if (titleEl) {
            if (!titleEl.id) titleEl.id = id + '-title';
            content.setAttribute('aria-labelledby', titleEl.id);
        }
        content.setAttribute('tabindex', '-1');

        // 記住觸發焦點，供關閉時還原
        _modalReturnFocus[id] = document.activeElement;

        overlay.classList.add('active');

        // focus trap：把 Tab 循環鎖在 modal 內
        _modalTrapDetach[id] = trapFocus(content);

        // Esc 關閉：優先點 close-btn（保留 setupModalClose 的攔截邏輯），否則直接關閉
        const onEsc = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            const closeBtn = overlay.querySelector(`.close-btn[data-modal="${id}"]`);
            if (closeBtn) closeBtn.click();
            else closeModal(id);
        };
        _modalEscHandler[id] = onEsc;
        overlay.addEventListener('keydown', onEsc);

        // 初始焦點放在對話框容器，讓螢幕閱讀器宣告標題；
        // 若呼叫端隨後自行 focus（如掃碼框），會在之後覆蓋此焦點。
        setTimeout(() => { try { content.focus(); } catch (e) {} }, 0);
    }

    function closeModal(id) {
        const overlay = document.getElementById(id);
        if (!overlay) return;
        overlay.classList.remove('active');
        if (_modalTrapDetach[id]) { _modalTrapDetach[id](); delete _modalTrapDetach[id]; }
        if (_modalEscHandler[id]) { overlay.removeEventListener('keydown', _modalEscHandler[id]); delete _modalEscHandler[id]; }
        const ret = _modalReturnFocus[id];
        delete _modalReturnFocus[id];
        if (ret && typeof ret.focus === 'function') { try { ret.focus(); } catch (e) { /* 元素可能已移除 */ } }
    }

    // ---- Confirm / Alert Modal ----
    // 共用實作已抽至 data.js 的 confirmDialog / alertDialog（會員端與後台共用），
    // 此處僅透過 Core.confirm / Core.alert 對外暴露（見模組 return）。

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

    // ---- 通用工具 ----
    // debounce：高頻事件（如搜尋框 input）延遲到停止輸入後才執行，避免每個字元都全表重繪
    function debounce(fn, wait = 200) {
        let t = null;
        const debounced = (...args) => {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(null, args), wait);
        };
        debounced.cancel = () => clearTimeout(t);
        return debounced;
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

    // CSV 解析（字元級狀態機；支援 BOM、雙引號跳脫、欄位內換行、跨平台換行）
    function parseCsvText(raw) {
        if (!raw) return null;
        if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

        const rows = [];
        let cells = [], cur = '', inQuotes = false;
        for (let i = 0; i < raw.length; i++) {
            const ch = raw[i];
            if (inQuotes) {
                if (ch === '"' && raw[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') inQuotes = false;
                else cur += ch;
            } else {
                if (ch === '"') inQuotes = true;
                else if (ch === ',') { cells.push(cur); cur = ''; }
                else if (ch === '\r') { /* 忽略 CR；LF 才視為列尾 */ }
                else if (ch === '\n') { cells.push(cur); rows.push(cells); cur = ''; cells = []; }
                else cur += ch;
            }
        }
        // 結尾若還有資料未收尾
        if (cur !== '' || cells.length > 0) { cells.push(cur); rows.push(cells); }

        // 過濾完全空白的列（例如尾端空行、或欄位都是空白）
        const nonEmpty = rows.filter(r => r.some(c => c.trim() !== ''));
        if (nonEmpty.length < 1) return null;

        const headers = nonEmpty[0].map(h => h.trim());
        if (nonEmpty.length < 2) return [];
        return nonEmpty.slice(1).map(cells => {
            const obj = {};
            headers.forEach((h, i) => { obj[h] = (cells[i] ?? '').trim(); });
            return obj;
        });
    }

    // ---- 目前管理員 / 權限 ----
    function refreshCurrentAdmin() { _currentAdmin = getCurrentAdmin(); return _currentAdmin; }
    function isSuper() { return _currentAdmin && _currentAdmin.role === 'super'; }
    function getCurrent() { return _currentAdmin; }

    function renderCurrentAdminBadge() {
        refreshCurrentAdmin();
        if (!_currentAdmin) return;
        const roleLabel = _currentAdmin.role === 'super'
            ? '<span style="color:var(--success); font-weight:600;">super</span>'
            : '<span style="color:var(--text-secondary); font-weight:600;">staff</span>';
        const html = `登入中：<strong>${escapeHtml(_currentAdmin.username)}</strong><br>角色：${roleLabel}`;
        const el = document.getElementById('currentAdminInfo');
        if (el) el.innerHTML = html;
        // 同步手機「更多」彈出選單中的管理員資訊
        const mEl = document.getElementById('mobileAdminInfo');
        if (mEl) mEl.innerHTML = html;
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
        // 「更多」彈出選單收納的次要分頁：切到這些 view 時，手機 tab bar 要把「更多」標記為 active
        const moreTargets = new Set(['dataView', 'adminManageView']);

        function switchTo(targetId) {
            sections.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('hidden', id !== targetId);
            });
            // active 狀態：主 tab 直接對應 data-target；若 target 屬於「更多」收納，則把 .nav-more 標 active
            navItems.forEach(n => {
                const t = n.getAttribute('data-target');
                const isMore = n.classList.contains('nav-more');
                let active = false;
                if (isMore) active = moreTargets.has(targetId);
                else active = (t === targetId);
                n.classList.toggle('active', active);
            });
            const handler = handlers && handlers[targetId];
            if (typeof handler === 'function') handler();
        }

        navItems.forEach(nav => {
            // 「更多」按鈕不切視圖，交給 setupMobileMoreMenu 處理
            if (nav.classList.contains('nav-more')) return;
            nav.addEventListener('click', (e) => {
                const targetId = nav.getAttribute('data-target');
                if (!targetId) return;
                switchTo(targetId);
            });
        });

        // 暴露給「更多」彈出選單使用（彈出項目點擊後切視圖）
        _navSwitchTo = switchTo;
    }

    // ---- 手機「更多」彈出選單 ----
    let _navSwitchTo = null;
    function setupMobileMoreMenu() {
        const moreBtn = document.getElementById('mobileMoreBtn');
        const menu = document.getElementById('mobileMoreMenu');
        const backdrop = document.getElementById('mobileMoreBackdrop');
        if (!moreBtn || !menu || !backdrop) return;

        const open = () => {
            menu.hidden = false;
            backdrop.hidden = false;
            document.addEventListener('keydown', onKey, true);
        };
        const close = () => {
            menu.hidden = true;
            backdrop.hidden = true;
            document.removeEventListener('keydown', onKey, true);
        };
        const onKey = (e) => { if (e.key === 'Escape') close(); };

        moreBtn.addEventListener('click', () => {
            (menu.hidden ? open : close)();
        });
        backdrop.addEventListener('click', close);

        // 彈出選單內的分頁項目 → 切視圖 + 關閉
        menu.querySelectorAll('[data-more-target]').forEach(item => {
            item.addEventListener('click', () => {
                const target = item.getAttribute('data-more-target');
                if (target && typeof _navSwitchTo === 'function') _navSwitchTo(target);
                close();
            });
        });

        // 彈出選單內的「修改密碼 / 登出」→ 觸發既有按鈕邏輯
        const mPwd = document.getElementById('mobileChangePwd');
        const mLogout = document.getElementById('mobileLogout');
        if (mPwd) mPwd.addEventListener('click', () => {
            close();
            document.getElementById('changeMyPwdBtn')?.click();
        });
        if (mLogout) mLogout.addEventListener('click', () => {
            close();
            document.getElementById('adminLogoutBtn')?.click();
        });
    }

    // ---- Modal close-btn 通用處理（intercepts: { modalId: () => boolean | Promise<boolean> | void }） ----
    function setupModalClose(intercepts = {}) {
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const modalId = btn.getAttribute('data-modal');
                const intercept = intercepts[modalId];
                if (typeof intercept === 'function') {
                    const result = await intercept();
                    if (result === false) return;
                }
                closeModal(modalId);
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
        _idleTimer = setTimeout(async () => {
            // 安全優先：先清除 session 再顯示提示，避免「等使用者按確認」期間 session 仍有效
            logAdminAction('LOGOUT', _currentAdmin ? _currentAdmin.username : '', '閒置自動登出');
            clearAdminSession();
            sessionStorage.removeItem('adminToken');
            await alertDialog('已閒置 30 分鐘，系統已自動登出，請重新登入。', { title: '安全提示' });
            window.location.href = 'index.html';
        }, IDLE_LIMIT_MS);
    }

    function startIdleWatcher() {
        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
            document.addEventListener(evt, resetIdleTimer, { passive: true });
        });
        resetIdleTimer();
    }

    // ---- 跨分頁同步：另一分頁變動時提示重新整理（cache 已由 data.js 自動 invalidate）----
    let _lastSyncToastAt = 0;
    function setupCrossTabSync() {
        window.addEventListener('storage', (e) => {
            if (!e.key) {
                toast('資料已在另一視窗大量變更，請重新整理頁面', 'warn', 6000);
                return;
            }
            if (!e.key.startsWith('foodbank_')) return;
            if (e.key === DB_ADMIN_SESSION_KEY) {
                // session 變更：通常是另一分頁登出或登入。重新驗證自身 session。
                verifyAdminSession(sessionStorage.getItem('adminToken')).then(valid => {
                    if (!valid) {
                        toast('您的登入狀態已失效，3 秒後跳回登入頁', 'warn', 3000);
                        setTimeout(() => { window.location.href = 'index.html'; }, 3000);
                    }
                });
                return;
            }
            // 一般資料變更：throttle 顯示提示
            const now = Date.now();
            if (now - _lastSyncToastAt < 2000) return;
            _lastSyncToastAt = now;
            toast('資料已在另一視窗變更，請重新整理以查看最新內容', 'warn', 6000);
        });
    }

    // ---- bootstrap ----
    async function bootstrap(onReady) {
        const adminToken = sessionStorage.getItem('adminToken');
        if (!await verifyAdminSession(adminToken)) {
            window.location.href = 'index.html';
            return;
        }
        refreshCurrentAdmin();

        document.getElementById('adminLogoutBtn').addEventListener('click', async () => {
            const ok = await confirmDialog('確定要登出後台嗎？', {
                title: '登出確認',
                confirmText: '登出',
                cancelText: '取消',
                type: 'danger'
            });
            if (ok) logoutAndRedirect();
        });
        renderCurrentAdminBadge();
        startIdleWatcher();
        setupCrossTabSync();
        setupMobileMoreMenu();

        if (typeof onReady === 'function') onReady();
    }

    return {
        bootstrap, setupNavigation, setupModalClose, logoutAndRedirect,
        isSuper, getCurrent, refreshCurrentAdmin, renderCurrentAdminBadge, applyRoleVisibility,
        openModal, closeModal, toast,
        confirm: confirmDialog, alert: alertDialog,
        debounce,
        fmtDisp, fmtDateTime, todayStr,
        drawChart, drawPie, buildStatCard, trendBadge,
        getCatColor, resolveCategory, clearCatCache,
        getAvailableYears,
        escapeCsvCell, downloadCsv, parseCsvText,
        LOW_STOCK_THRESHOLD, CAT_PALETTE
    };
})();
