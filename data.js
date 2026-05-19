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

// ---- In-memory cache 層 ----
// 設計：所有 getter / setter 共用一份記憶體副本，避免重複 JSON.parse / localStorage IO。
// 約定：呼叫端取得 reference 後可直接 mutate，但每次修改後 *必須* 呼叫對應的 save*，
// 否則 cache 與 localStorage 不一致（重整後變更會消失）。
// 注意：跨分頁不會自動同步；如需多視窗同步，待後續導入 storage 事件處理。
const _cache = Object.create(null);

function _readKey(key, fallback) {
    if (_cache[key] !== undefined) return _cache[key];
    try {
        const raw = localStorage.getItem(key);
        _cache[key] = raw === null ? fallback : (JSON.parse(raw) ?? fallback);
    } catch {
        _cache[key] = fallback;
    }
    return _cache[key];
}
function _writeKey(key, value) {
    _cache[key] = value;
    return safeSetItem(key, JSON.stringify(value));
}
function _invalidateCache(key) {
    if (key === undefined) {
        for (const k of Object.keys(_cache)) delete _cache[k];
    } else {
        delete _cache[key];
    }
}

// ---- Data Accessors ----
function getCategories()       { return _readKey(DB_CATEGORIES_KEY, []); }
function saveCategories(cats)  { return _writeKey(DB_CATEGORIES_KEY, cats); }

function getMembers()          { return _readKey(DB_MEMBERS_KEY, []); }
function saveMembers(members)  { return _writeKey(DB_MEMBERS_KEY, members); }

function getRedemptions()      { return _readKey(DB_REDEMPTIONS_KEY, []); }
function saveRedemptions(rs)   { return _writeKey(DB_REDEMPTIONS_KEY, rs); }

function getInventory()        { return _readKey(DB_INVENTORY_KEY, []); }
function saveInventory(inv)    { return _writeKey(DB_INVENTORY_KEY, inv); }

function getPointsLog()        { return _readKey(DB_POINTS_LOG_KEY, []); }
function savePointsLog(log)    { return _writeKey(DB_POINTS_LOG_KEY, log); }

function getInventoryLog()     { return _readKey(DB_INVENTORY_LOG_KEY, []); }
function saveInventoryLog(log) { return _writeKey(DB_INVENTORY_LOG_KEY, log); }

function getCatColors()        { return _readKey(DB_CAT_COLORS_KEY, {}); }
function saveCatColors(c)      { return _writeKey(DB_CAT_COLORS_KEY, c); }

function getAdmins()           { return _readKey(DB_ADMINS_KEY, []); }
function saveAdmins(admins)    { return _writeKey(DB_ADMINS_KEY, admins); }

function getAuditLog()         { return _readKey(DB_AUDIT_LOG_KEY, []); }
function saveAuditLog(log)     { return _writeKey(DB_AUDIT_LOG_KEY, log); }

// ---- Log Helpers ----
// extra 為可選的額外欄位（例如兌換時的 itemName / itemBarcode），合併進 log entry
function logPointChange(memberId, memberName, delta, type, note, extra = null) {
    const log = getPointsLog();
    const entry = {
        id: 'PL' + Date.now() + Math.random().toString(36).slice(2, 6),
        memberId, memberName, delta, type, note,
        date: new Date().toISOString()
    };
    if (extra && typeof extra === 'object') Object.assign(entry, extra);
    log.push(entry);
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

// 估算 foodbank_* 在 localStorage 的用量
// 註：localStorage 內部以 UTF-16 儲存，每字元 2 bytes；不同瀏覽器上限不同（多數 5 MB / origin）
const LOCAL_STORAGE_LIMIT_BYTES = 5 * 1024 * 1024;
function getLocalStorageUsage() {
    let bytes = 0;
    let keys = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('foodbank_')) continue;
        const val = localStorage.getItem(key) || '';
        bytes += (key.length + val.length) * 2;
        keys++;
    }
    return {
        bytes,
        keys,
        mb: bytes / (1024 * 1024),
        limitMb: LOCAL_STORAGE_LIMIT_BYTES / (1024 * 1024),
        pct: bytes / LOCAL_STORAGE_LIMIT_BYTES
    };
}

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

// 通用 SHA-256（仍用於 session token hash）
async function hashPassword(pwd) {
    if (!pwd) return '';
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pwd));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 產生 16 bytes salt（32 hex chars）
function genSalt() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 帶 salt 的密碼雜湊，回傳 "salt$hash" 格式
async function hashPasswordSalted(pwd) {
    if (!pwd) return '';
    const salt = genSalt();
    const hash = await hashPassword(salt + pwd);
    return salt + '$' + hash;
}

// 格式判斷
function isLegacyUnsaltedHash(s) { return /^[a-f0-9]{64}$/.test(s || ''); }
function isSaltedHash(s)         { return /^[a-f0-9]{32}\$[a-f0-9]{64}$/.test(s || ''); }
function isHashed(s)             { return isSaltedHash(s) || isLegacyUnsaltedHash(s); }

// 統一密碼驗證：自動辨識三種格式（salted / unsalted hash / plaintext）
// 回傳 { match, needsUpgrade }；needsUpgrade=true 表示應該升級為 salted 格式
async function verifyStoredPassword(pwd, stored) {
    if (isSaltedHash(stored)) {
        const [salt, hash] = stored.split('$');
        const match = (await hashPassword(salt + pwd)) === hash;
        return { match, needsUpgrade: false };
    }
    if (isLegacyUnsaltedHash(stored)) {
        const match = (await hashPassword(pwd)) === stored;
        return { match, needsUpgrade: match };
    }
    // 舊版明文
    const match = (stored || '') === (pwd || '');
    return { match, needsUpgrade: match };
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
    }
    const { match, needsUpgrade } = await verifyStoredPassword(password, user.password);
    if (!match) return { success: false, msg: '密碼錯誤' };
    if (needsUpgrade) {
        // 懶遷移：舊版明文或無 salt 的 hash，登入成功後升級為 salted
        const allMembers = getMembers();
        const idx = allMembers.findIndex(m => m.id === user.id);
        if (idx !== -1) {
            allMembers[idx].password = await hashPasswordSalted(password);
            saveMembers(allMembers);
        }
    }
    return { success: true, isFirstLogin: false, user };
}

async function loginAdmin(username, password) {
    const admins = getAdmins();
    const idx = admins.findIndex(a => a.username === username);
    if (idx === -1) return { success: false, msg: '管理員帳號或密碼錯誤' };
    const admin = admins[idx];
    if (admin.status === 'disabled') return { success: false, msg: '此管理員帳號已停用' };

    const { match, needsUpgrade } = await verifyStoredPassword(password, admin.password);
    if (!match) return { success: false, msg: '管理員帳號或密碼錯誤' };
    if (needsUpgrade) {
        admins[idx].password = await hashPasswordSalted(password);
        saveAdmins(admins);
    }
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

const MAX_SESSION_AGE_MS = 24 * 60 * 60 * 1000; // 24 小時硬上限

async function verifyAdminSession(token) {
    if (!token) return false;
    const raw = localStorage.getItem(DB_ADMIN_SESSION_KEY);
    if (!raw) return false;
    let session;
    try { session = JSON.parse(raw); } catch { return false; }
    if (!session || !session.tokenHash || !session.adminId) return false;

    // 24 小時硬上限：超過直接視為無效並清除（避免 stale session 物件殘留）
    if (session.createdAt) {
        const ageMs = Date.now() - new Date(session.createdAt).getTime();
        if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_SESSION_AGE_MS) {
            clearAdminSession();
            return false;
        }
    } else {
        // 沒有 createdAt 視為非法 session
        clearAdminSession();
        return false;
    }

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

// 跨分頁同步：另一分頁變更 localStorage 時 invalidate 對應 cache key
// 註：storage 事件只在「其他分頁」變更時觸發，當前分頁的變更不會觸發
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('storage', (e) => {
        if (!e.key) {
            // null key 表示 localStorage.clear() 被呼叫
            _invalidateCache();
            return;
        }
        if (e.key.startsWith('foodbank_')) {
            _invalidateCache(e.key);
        }
    });
}

initDB();
