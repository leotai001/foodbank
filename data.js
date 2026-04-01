// 模擬後端資料與 API
const DB_MEMBERS_KEY = 'foodbank_members';
const DB_REDEMPTIONS_KEY = 'foodbank_redemptions';
const DB_INVENTORY_KEY = 'foodbank_inventory';
const DB_CATEGORIES_KEY = 'foodbank_categories';
const DB_ADMIN_KEY = 'foodbank_admin';
const DB_ADMIN_SESSION_KEY = 'foodbank_admin_session';
const DB_POINTS_LOG_KEY = 'foodbank_points_log';
const DB_INVENTORY_LOG_KEY = 'foodbank_inventory_log';
const DB_CAT_COLORS_KEY = 'foodbank_cat_colors';

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

    // 管理員帳號（明文密碼在首次登入時自動升級為 hash）
    if (!localStorage.getItem(DB_ADMIN_KEY)) {
        localStorage.setItem(DB_ADMIN_KEY, JSON.stringify({ username: 'admin', password: 'admin123' }));
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
    const adminData = JSON.parse(localStorage.getItem(DB_ADMIN_KEY));
    if (!adminData || adminData.username !== username) {
        return { success: false, msg: '管理員帳號或密碼錯誤' };
    }

    let match;
    if (isHashed(adminData.password)) {
        match = adminData.password === await hashPassword(password);
    } else {
        // 舊版明文：驗證後自動升級為 hash
        match = adminData.password === password;
        if (match) {
            adminData.password = await hashPassword(password);
            safeSetItem(DB_ADMIN_KEY, JSON.stringify(adminData));
        }
    }

    if (!match) return { success: false, msg: '管理員帳號或密碼錯誤' };
    return { success: true };
}

// ---- Admin Session ----
async function createAdminSession() {
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(tokenBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const tokenHash = await hashPassword(token);
    safeSetItem(DB_ADMIN_SESSION_KEY, tokenHash);
    return token;
}

async function verifyAdminSession(token) {
    if (!token) return false;
    const storedHash = localStorage.getItem(DB_ADMIN_SESSION_KEY);
    if (!storedHash) return false;
    return storedHash === await hashPassword(token);
}

function clearAdminSession() {
    localStorage.removeItem(DB_ADMIN_SESSION_KEY);
}

initDB();
