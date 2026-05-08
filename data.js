// 模擬後端資料與 API
const DB_MEMBERS_KEY = 'foodbank_members';
const DB_REDEMPTIONS_KEY = 'foodbank_redemptions';
const DB_INVENTORY_KEY = 'foodbank_inventory';
const DB_CATEGORIES_KEY = 'foodbank_categories';
const DB_ADMIN_KEY = 'foodbank_admin';            // legacy（單一管理員，僅供首次遷移讀取）
const DB_ADMINS_KEY = 'foodbank_admins';          // 多管理員列表
const DB_ADMIN_SESSION_KEY = 'foodbank_admin_session';
const DB_POINTS_LOG_KEY = 'foodbank_points_log';
const DB_INVENTORY_LOG_KEY = 'foodbank_inventory_log';
const DB_CAT_COLORS_KEY = 'foodbank_cat_colors';
const DB_AUDIT_LOG_KEY = 'foodbank_audit_log';    // 操作審計

// 初始化假資料
function initDB() {
    if (!localStorage.getItem(DB_CATEGORIES_KEY)) {
        localStorage.setItem(DB_CATEGORIES_KEY, JSON.stringify(['主食', '罐頭', '健康食品', '生活日用品', '醫療用品']));
    }

    if (!localStorage.getItem(DB_MEMBERS_KEY)) {
        const initialMembers = [
            { id: 'M001', name: '王大明', phone: '0912345678', password: '123', isFirstLogin: false, points: 1500, joinDate: '2025-01-15', birthday: '1980-05-20', address: '台北市信義區', status: 'active', barcode: 'M001-0912345678' },
            { id: 'M002', name: '李阿姨', phone: '0987654321', password: '123', isFirstLogin: false, points: 300, joinDate: '2025-02-20', birthday: '1965-11-10', address: '新北市板橋區', status: 'active', barcode: 'M002-0987654321' },
            { id: 'M003', name: '陳建國', phone: '0955111222', password: '', isFirstLogin: true, points: 50, joinDate: '2026-01-05', birthday: '', address: '', status: 'active', barcode: 'M003-0955111222' }
        ];
        localStorage.setItem(DB_MEMBERS_KEY, JSON.stringify(initialMembers));
    }

    if (!localStorage.getItem(DB_INVENTORY_KEY)) {
        const initialInventory = [
            { barcode: 'IT001', name: '白米 2kg', category: '主食', quantity: 50, pointsCost: 200 },
            { barcode: 'IT002', name: '沙拉油 1瓶', category: '生活日用品', quantity: 30, pointsCost: 150 },
            { barcode: 'IT003', name: '急難物資包', category: '醫療用品', quantity: 10, pointsCost: 500 },
            { barcode: 'IT004', name: '鮪魚罐頭組', category: '罐頭', quantity: 100, pointsCost: 100 }
        ];
        localStorage.setItem(DB_INVENTORY_KEY, JSON.stringify(initialInventory));
    }

    if (!localStorage.getItem(DB_REDEMPTIONS_KEY)) {
        const initialRedemptions = [
            { id: 'R001', memberId: 'M001', itemBarcode: 'IT001', itemName: '白米 2kg', category: '主食', pointsCost: 200, date: '2026-01-20T10:00:00' },
            { id: 'R002', memberId: 'M002', itemBarcode: 'IT002', itemName: '沙拉油 1瓶', category: '生活日用品', pointsCost: 150, date: '2026-02-15T14:30:00' }
        ];
        localStorage.setItem(DB_REDEMPTIONS_KEY, JSON.stringify(initialRedemptions));
    }

    // 管理員列表（多管理員）：若為舊版單一 admin 則自動遷移成單一 super 管理員
    if (!localStorage.getItem(DB_ADMINS_KEY)) {
        const legacy = JSON.parse(localStorage.getItem(DB_ADMIN_KEY) || 'null');
        const baseAdmin = legacy
            ? { username: legacy.username, password: legacy.password }
            : { username: 'admin', password: 'admin123' }; // 明文密碼在首次登入時自動升級為 hash
        const initialAdmins = [{
            id: 'A001',
            username: baseAdmin.username,
            password: baseAdmin.password,
            role: 'super',
            status: 'active',
            createdAt: new Date().toISOString(),
            lastLoginAt: null
        }];
        localStorage.setItem(DB_ADMINS_KEY, JSON.stringify(initialAdmins));
    }

    if (!localStorage.getItem(DB_POINTS_LOG_KEY)) {
        localStorage.setItem(DB_POINTS_LOG_KEY, JSON.stringify([]));
    }
    if (!localStorage.getItem(DB_INVENTORY_LOG_KEY)) {
        localStorage.setItem(DB_INVENTORY_LOG_KEY, JSON.stringify([]));
    }
    if (!localStorage.getItem(DB_CAT_COLORS_KEY)) {
        localStorage.setItem(DB_CAT_COLORS_KEY, JSON.stringify({}));
    }
    if (!localStorage.getItem(DB_AUDIT_LOG_KEY)) {
        localStorage.setItem(DB_AUDIT_LOG_KEY, JSON.stringify([]));
    }
}

// ---- Data Accessors ----
function getCategories() { return JSON.parse(localStorage.getItem(DB_CATEGORIES_KEY)) || []; }
function saveCategories(cats) { safeSetItem(DB_CATEGORIES_KEY, JSON.stringify(cats)); }

function getMembers() { return JSON.parse(localStorage.getItem(DB_MEMBERS_KEY)) || []; }
function saveMembers(members) { safeSetItem(DB_MEMBERS_KEY, JSON.stringify(members)); }

function getRedemptions() { return JSON.parse(localStorage.getItem(DB_REDEMPTIONS_KEY)) || []; }
function saveRedemptions(redemptions) { safeSetItem(DB_REDEMPTIONS_KEY, JSON.stringify(redemptions)); }

function getInventory() { return JSON.parse(localStorage.getItem(DB_INVENTORY_KEY)) || []; }
function saveInventory(inventory) { safeSetItem(DB_INVENTORY_KEY, JSON.stringify(inventory)); }

function getPointsLog() { return JSON.parse(localStorage.getItem(DB_POINTS_LOG_KEY)) || []; }
function savePointsLog(log) { safeSetItem(DB_POINTS_LOG_KEY, JSON.stringify(log)); }

function getInventoryLog() { return JSON.parse(localStorage.getItem(DB_INVENTORY_LOG_KEY)) || []; }
function saveInventoryLog(log) { safeSetItem(DB_INVENTORY_LOG_KEY, JSON.stringify(log)); }

function getCatColors() { return JSON.parse(localStorage.getItem(DB_CAT_COLORS_KEY)) || {}; }
function saveCatColors(c) { safeSetItem(DB_CAT_COLORS_KEY, JSON.stringify(c)); }

function getAdmins() { return JSON.parse(localStorage.getItem(DB_ADMINS_KEY)) || []; }
function saveAdmins(admins) { safeSetItem(DB_ADMINS_KEY, JSON.stringify(admins)); }

function getAuditLog() { return JSON.parse(localStorage.getItem(DB_AUDIT_LOG_KEY)) || []; }
function saveAuditLog(log) { safeSetItem(DB_AUDIT_LOG_KEY, JSON.stringify(log)); }

// ---- Log Helpers ----
function logPointChange(memberId, memberName, delta, type, note) {
    const log = getPointsLog();
    log.push({ id: 'PL' + Date.now() + Math.random().toString(36).slice(2, 6), memberId, memberName, delta, type, note, date: new Date().toISOString() });
    savePointsLog(log);
}

function logInventoryChange(barcode, itemName, delta, note) {
    const log = getInventoryLog();
    log.push({ id: 'IL' + Date.now() + Math.random().toString(36).slice(2, 6), barcode, itemName, delta, note, date: new Date().toISOString() });
    saveInventoryLog(log);
}

// 操作審計：自動帶上目前登入管理員資訊；若 explicitAdmin 提供則覆蓋（用於登入流程，session 尚未建立）
function logAdminAction(action, target = '', detail = '', explicitAdmin = null) {
    let admin = explicitAdmin;
    if (!admin) {
        const session = JSON.parse(localStorage.getItem(DB_ADMIN_SESSION_KEY) || 'null');
        if (!session || !session.adminId) return;
        admin = getAdmins().find(a => a.id === session.adminId);
        if (!admin) return;
    }
    const log = getAuditLog();
    log.push({
        id: 'AL' + Date.now() + Math.random().toString(36).slice(2, 6),
        adminId: admin.id,
        adminUsername: admin.username,
        action,
        target: target || '',
        detail: detail || '',
        date: new Date().toISOString()
    });
    saveAuditLog(log);
}

// ---- Utilities ----
function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            alert('儲存失敗：瀏覽器儲存空間已滿，請聯絡管理員清除舊資料。');
        } else {
            console.error('localStorage 寫入失敗：', e);
        }
        return false;
    }
}

async function hashPassword(pwd) {
    if (!pwd) return '';
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function isHashed(pwd) {
    return /^[a-f0-9]{64}$/.test(pwd);
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ---- Auth ----
async function loginUser(phone, password) {
    const members = getMembers();
    const user = members.find(m => m.phone === phone);
    if (!user) return { success: false, msg: '找不到此電話號碼' };
    if (user.status === 'expired') return { success: false, msg: '您的帳號已過期停權，請洽管理員' };

    if (user.isFirstLogin) {
        return { success: true, isFirstLogin: true, user };
    } else {
        let match;
        if (isHashed(user.password)) {
            match = user.password === await hashPassword(password);
        } else {
            // 舊版明文密碼：驗證後自動升級為 hash（懶遷移）
            match = user.password === password;
            if (match) {
                const allMembers = getMembers();
                const idx = allMembers.findIndex(m => m.id === user.id);
                allMembers[idx].password = await hashPassword(password);
                saveMembers(allMembers);
            }
        }
        if (!match) return { success: false, msg: '密碼錯誤' };
        return { success: true, isFirstLogin: false, user };
    }
}

async function loginAdmin(username, password) {
    const admins = getAdmins();
    const idx = admins.findIndex(a => a.username === username);
    if (idx === -1) return { success: false, msg: '管理員帳號或密碼錯誤' };
    const admin = admins[idx];
    if (admin.status === 'disabled') return { success: false, msg: '此管理員帳號已停用' };

    let match;
    if (isHashed(admin.password)) {
        match = admin.password === await hashPassword(password);
    } else {
        // 舊版明文：驗證後自動升級為 hash
        match = admin.password === password;
        if (match) {
            admins[idx].password = await hashPassword(password);
            saveAdmins(admins);
        }
    }

    if (!match) return { success: false, msg: '管理員帳號或密碼錯誤' };
    return { success: true, admin: admins[idx] };
}

// ---- Admin Session ----
async function createAdminSession(admin) {
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const tokenHash = await hashPassword(token);
    safeSetItem(DB_ADMIN_SESSION_KEY, JSON.stringify({
        adminId: admin.id,
        tokenHash,
        createdAt: new Date().toISOString()
    }));
    // 更新 lastLoginAt
    const admins = getAdmins();
    const idx = admins.findIndex(a => a.id === admin.id);
    if (idx !== -1) {
        admins[idx].lastLoginAt = new Date().toISOString();
        saveAdmins(admins);
    }
    return token;
}

async function verifyAdminSession(token) {
    if (!token) return false;
    const raw = localStorage.getItem(DB_ADMIN_SESSION_KEY);
    if (!raw) return false;
    let session;
    try { session = JSON.parse(raw); } catch { return false; }
    if (!session || !session.tokenHash || !session.adminId) return false;
    if (session.tokenHash !== await hashPassword(token)) return false;
    // 確認此 admin 仍存在且未被停用
    const admin = getAdmins().find(a => a.id === session.adminId);
    if (!admin || admin.status === 'disabled') return false;
    return true;
}

function getCurrentAdmin() {
    const raw = localStorage.getItem(DB_ADMIN_SESSION_KEY);
    if (!raw) return null;
    let session;
    try { session = JSON.parse(raw); } catch { return null; }
    if (!session || !session.adminId) return null;
    const admin = getAdmins().find(a => a.id === session.adminId);
    if (!admin) return null;
    // 不回傳 password
    const { password, ...rest } = admin;
    return rest;
}

function clearAdminSession() {
    localStorage.removeItem(DB_ADMIN_SESSION_KEY);
}

initDB();
