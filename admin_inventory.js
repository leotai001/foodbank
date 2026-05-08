// admin_inventory.js — 庫存管理：列表、行內編輯、批量入庫、分類維護、CSV 匯入、批號/有效期
window.Inv = (function () {
    let _invEditState = {};
    let _batchInvList = [];
    let _inventoryLogShowAll = false;
    let _importInvClassified = null;

    // ---- 公用：批號與庫存量同步 ----
    // 規則：若 item.batches 存在且非空 → quantity 為各批號的加總；否則保留原 quantity
    function syncQuantity(item) {
        if (Array.isArray(item.batches) && item.batches.length > 0) {
            item.quantity = item.batches.reduce((s, b) => s + (parseInt(b.quantity, 10) || 0), 0);
        }
    }

    // 加入新批號（自動編號 BNNN）
    function addBatch(item, qty, expiryDate) {
        if (!Array.isArray(item.batches)) item.batches = [];
        const maxBn = item.batches.reduce((m, b) => {
            const n = parseInt(String(b.batchId || '').replace(/\D/g, ''), 10) || 0;
            return n > m ? n : m;
        }, 0);
        const batchId = 'B' + String(maxBn + 1).padStart(3, '0');
        item.batches.push({
            batchId,
            quantity: qty,
            expiryDate: expiryDate || '',
            receivedAt: new Date().toISOString()
        });
        syncQuantity(item);
        return batchId;
    }

    // 依 FEFO（最早到期先扣）扣 1 件；無批號則直接扣 quantity
    function deductOne(item) {
        if (Array.isArray(item.batches) && item.batches.length > 0) {
            // 過濾出仍有量的批號
            const candidates = item.batches.filter(b => (b.quantity || 0) > 0);
            if (candidates.length === 0) return false;
            // 有 expiry 的優先（最早），其後是無 expiry 的
            const withExpiry = candidates.filter(b => b.expiryDate)
                .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
            const noExpiry = candidates.filter(b => !b.expiryDate);
            const target = withExpiry[0] || noExpiry[0];
            target.quantity -= 1;
            // 清除完全為 0 且過期的批號
            item.batches = item.batches.filter(b => b.quantity > 0);
            syncQuantity(item);
            return true;
        }
        if (item.quantity > 0) { item.quantity -= 1; return true; }
        return false;
    }

    // 取得項目「最近到期」資訊：返回 {date, daysLeft, level} 或 null
    function getEarliestExpiry(item) {
        if (!Array.isArray(item.batches) || item.batches.length === 0) return null;
        const now = new Date();
        const candidates = item.batches
            .filter(b => b.quantity > 0 && b.expiryDate)
            .map(b => ({ date: b.expiryDate, t: new Date(b.expiryDate + 'T23:59:59').getTime() }))
            .sort((a, b) => a.t - b.t);
        if (candidates.length === 0) return null;
        const earliest = candidates[0];
        const daysLeft = Math.ceil((earliest.t - now.getTime()) / 86400000);
        let level = 'ok';
        if (daysLeft < 0) level = 'expired';
        else if (daysLeft <= 7) level = 'urgent';
        else if (daysLeft <= 30) level = 'warn';
        return { date: earliest.date, daysLeft, level };
    }

    function expiryBadge(info) {
        if (!info) return '';
        if (info.level === 'expired') return ` <span class="badge" style="background:#fee2e2; color:#991b1b; margin-left:0.4rem;">已過期</span>`;
        if (info.level === 'urgent')  return ` <span class="badge" style="background:#fed7aa; color:#9a3412; margin-left:0.4rem;">${info.daysLeft} 天到期</span>`;
        if (info.level === 'warn')    return ` <span class="badge" style="background:#fef3c7; color:#92400e; margin-left:0.4rem;">${info.daysLeft} 天</span>`;
        return ` <span style="color:var(--text-secondary); font-size:0.75rem; margin-left:0.4rem;">${info.daysLeft} 天</span>`;
    }

    // ===== 渲染庫存列表 =====
    function render() {
        const inventory = getInventory();
        const search    = document.getElementById('invSearchInput').value.trim().toLowerCase();
        const cat       = document.getElementById('invCategoryFilter').value;
        const tbody     = document.getElementById('inventoryTableBody');
        const cats      = getCategories();
        tbody.innerHTML = '';

        inventory.filter(i => {
            if (cat !== 'all' && i.category !== cat) return false;
            if (search && !i.name.toLowerCase().includes(search) && !i.barcode.toLowerCase().includes(search)) return false;
            return true;
        }).forEach(item => {
            const isEditing = !!_invEditState[item.barcode];
            const d = isEditing ? _invEditState[item.barcode] : item;
            const isOutOfStock = d.quantity === 0;
            const isLowStock   = !isOutOfStock && d.quantity <= Core.LOW_STOCK_THRESHOLD;
            const qtyColor     = isOutOfStock ? 'var(--danger)' : isLowStock ? '#d97706' : 'var(--primary-color)';
            const qtyBadge     = isOutOfStock
                ? '<span class="badge badge-expired" style="margin-left:0.4rem;">缺貨</span>'
                : isLowStock ? '<span class="badge" style="background:#fef3c7;color:#92400e;margin-left:0.4rem;">庫存偏低</span>'
                : '';
            const cc = Core.getCatColor(d.category || item.category);
            const bc = escapeHtml(item.barcode);
            const catOpts = cats.map(c =>
                `<option value="${escapeHtml(c)}" ${c === d.category ? 'selected' : ''}>${escapeHtml(c)}</option>`
            ).join('');

            const expInfo = getEarliestExpiry(item);
            const expCell = isEditing ? '<td><span style="color:var(--text-secondary);font-size:0.75rem;">儲存後可編輯批號</span></td>' :
                expInfo
                    ? `<td>${escapeHtml(expInfo.date)}${expiryBadge(expInfo)}</td>`
                    : `<td><span style="color:var(--text-secondary); font-size:0.85rem;">—</span></td>`;

            const tr = document.createElement('tr');
            if (isEditing) tr.classList.add('editing-row');
            tr.innerHTML = isEditing ? `
                <td><code>${bc}</code></td>
                <td><input type="text"   class="inv-field" data-barcode="${bc}" data-field="name"       value="${escapeHtml(d.name)}"></td>
                <td><select              class="inv-field" data-barcode="${bc}" data-field="category">${catOpts}</select></td>
                <td><input type="number" class="inv-field" data-barcode="${bc}" data-field="quantity"   value="${d.quantity}"   min="0" style="width:70px;"></td>
                <td><input type="number" class="inv-field" data-barcode="${bc}" data-field="pointsCost" value="${d.pointsCost}" min="1" style="width:70px;"></td>
                ${expCell}
                <td>
                    <button class="btn btn-sm btn-outline inv-cancel-btn" data-barcode="${bc}">取消</button>
                </td>
            ` : `
                <td><code>${bc}</code></td>
                <td><strong>${escapeHtml(item.name)}</strong></td>
                <td><span class="badge" style="background:${cc.bg}; color:${cc.text};">${escapeHtml(item.category || '需更新')}</span></td>
                <td><span style="font-size:1.1rem; color:${qtyColor}; font-weight:bold;">${item.quantity}</span>${qtyBadge}</td>
                <td>${item.pointsCost}</td>
                ${expCell}
                <td style="white-space:nowrap;">
                    <button class="btn btn-sm btn-outline inv-edit-btn" data-barcode="${bc}">編輯</button>
                    <button class="btn btn-sm btn-outline inv-batch-btn" data-barcode="${bc}" style="margin-left:0.4rem;">批號</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    function renderFilters() {
        const catFilter = document.getElementById('invCategoryFilter');
        const cats = getCategories();
        catFilter.innerHTML = '<option value="all">所有分類</option>';
        cats.forEach(c => catFilter.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`);
    }

    function renderInventoryLog() {
        const log = getInventoryLog().sort((a, b) => new Date(b.date) - new Date(a.date));
        const display = _inventoryLogShowAll ? log : log.slice(0, 15);
        const tbody = document.getElementById('inventoryLogTableBody');
        tbody.innerHTML = '';
        if (log.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">尚無入庫紀錄</td></tr>';
            return;
        }
        tbody.innerHTML = display.map(entry => `<tr>
                <td><small style="color:var(--text-secondary);">${Core.fmtDisp(entry.date)}</small></td>
                <td><code>${escapeHtml(entry.barcode)}</code></td>
                <td>${escapeHtml(entry.itemName)}</td>
                <td><span style="color:var(--success); font-weight:600;">+${entry.delta}</span></td>
                <td style="color:var(--text-secondary); font-size:0.875rem;">${escapeHtml(entry.note || '')}</td>
            </tr>`).join('');
    }

    function updateInvSaveBar() {
        const count = Object.keys(_invEditState).length;
        document.getElementById('invSaveBar').classList.toggle('hidden', count === 0);
        document.getElementById('invEditCount').textContent = count;
    }

    // ===== 批號管理 Modal =====
    let _batchEditingBarcode = null;

    function openBatchModal(barcode) {
        const item = getInventory().find(i => i.barcode === barcode);
        if (!item) return;
        _batchEditingBarcode = barcode;
        document.getElementById('batchManageTitle').textContent = `批號管理：${item.name}`;
        renderBatchManageList();
        document.getElementById('batchManageNewQty').value = '';
        document.getElementById('batchManageNewExpiry').value = '';
        Core.openModal('batchManageModal');
    }

    function renderBatchManageList() {
        const item = getInventory().find(i => i.barcode === _batchEditingBarcode);
        const tbody = document.getElementById('batchManageTableBody');
        if (!item) { tbody.innerHTML = ''; return; }
        const batches = Array.isArray(item.batches) ? item.batches : [];
        if (batches.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-secondary);">尚未啟用批號管理（核銷將直接扣總量）</td></tr>';
            return;
        }
        const sorted = [...batches].sort((a, b) => (a.expiryDate || '9999-99').localeCompare(b.expiryDate || '9999-99'));
        tbody.innerHTML = sorted.map(b => {
            const info = b.expiryDate
                ? getEarliestExpiry({ batches: [b] })
                : null;
            return `<tr>
                <td><code>${escapeHtml(b.batchId)}</code></td>
                <td>${escapeHtml(b.expiryDate || '—')}${info ? expiryBadge(info) : ''}</td>
                <td><input type="number" class="batch-qty-field" data-id="${escapeHtml(b.batchId)}" value="${b.quantity}" min="0" style="width:80px;"></td>
                <td><small style="color:var(--text-secondary);">${b.receivedAt ? Core.fmtDisp(b.receivedAt) : '—'}</small></td>
                <td><button class="btn btn-sm btn-danger batch-del-btn" data-id="${escapeHtml(b.batchId)}">刪除</button></td>
            </tr>`;
        }).join('');
    }

    // ===== 批量掃描入庫 Modal =====
    function renderBatchInvTable() {
        const tbody = document.getElementById('batchInvTableBody');
        const btn = document.getElementById('batchInvSubmitBtn');
        const cats = getCategories();
        tbody.innerHTML = '';

        if (_batchInvList.length === 0) {
            btn.disabled = true;
            btn.textContent = '無資料可送出';
            return;
        }

        btn.disabled = false;
        btn.textContent = `確認並送出 ${_batchInvList.length} 筆資料`;

        _batchInvList.forEach((item, idx) => {
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
                const cc2 = Core.getCatColor(item.category);
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
                <td><input type="date" class="b-exp" data-idx="${idx}" value="${escapeHtml(item.expiryDate || '')}" style="width:140px;"></td>
                <td><button type="button" class="btn btn-sm btn-danger b-del" data-idx="${idx}">刪除</button></td>
            `;
            tr.innerHTML = html;
            tbody.appendChild(tr);
        });
    }

    // ===== 分類維護 =====
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
            const current = colors[c] || Core.CAT_PALETTE[idx % Core.CAT_PALETTE.length];
            const swatches = Core.CAT_PALETTE.map((p, pi) => {
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

        list.querySelectorAll('.cat-color-swatch').forEach(s => {
            s.addEventListener('click', () => {
                const palette = Core.CAT_PALETTE[parseInt(s.dataset.pi)];
                const stored  = getCatColors();
                stored[s.dataset.cat] = palette;
                saveCatColors(stored);
                renderCategoryList();
                render();
            });
        });

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
                Core.clearCatCache();
                logAdminAction('CAT_DELETE', catName, inUse ? '分類仍有品項使用' : '');
                renderCategoryList();
                renderFilters();
            });
        });
    }

    // ===== #2 庫存 CSV 匯入 =====
    function classifyInvImport(rows, mode) {
        const existing = getInventory();
        const byBarcode = Object.fromEntries(existing.map(i => [i.barcode, i]));
        const csvBarcodes = new Set();
        const validCats = new Set(getCategories());

        return rows.map(row => {
            const barcode  = (row['條碼'] || '').trim();
            const name     = (row['名稱'] || '').trim();
            const category = (row['分類'] || '').trim();
            const qtyRaw   = row['庫存量'];
            const ptsRaw   = row['預設點數'];
            const expiry   = (row['有效期'] || '').trim();

            const err = (reason) => ({ row, action: 'error', reason });
            if (!barcode) return err('缺少條碼');
            if (!name)    return err('缺少名稱');
            if (csvBarcodes.has(barcode)) return err('CSV 內條碼重複');
            csvBarcodes.add(barcode);

            const quantity = Math.max(0, parseInt(qtyRaw, 10) || 0);
            const pointsCost = Math.max(1, parseInt(ptsRaw, 10) || 1);
            const finalCat = validCats.has(category) ? category : (getCategories()[0] || '未分類');

            // expiry 驗證
            let validExpiry = '';
            if (expiry) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return err('有效期需為 YYYY-MM-DD');
                validExpiry = expiry;
            }

            const note = (!validCats.has(category) && category) ? `分類「${category}」不存在，套用「${finalCat}」` : '';

            if (byBarcode[barcode]) {
                if (mode === 'upsert') {
                    const orig = byBarcode[barcode];
                    const newItem = { ...orig, name, category: finalCat, pointsCost };
                    // 數量處理：若有 expiry → 加入新批號；無 expiry → 直接寫入 quantity（清掉 batches）
                    if (validExpiry) {
                        newItem.batches = Array.isArray(orig.batches) ? [...orig.batches] : [];
                        if (quantity > 0) {
                            const maxBn = newItem.batches.reduce((m, b) => {
                                const n = parseInt(String(b.batchId || '').replace(/\D/g, ''), 10) || 0;
                                return n > m ? n : m;
                            }, 0);
                            newItem.batches.push({
                                batchId: 'B' + String(maxBn + 1).padStart(3, '0'),
                                quantity, expiryDate: validExpiry, receivedAt: new Date().toISOString()
                            });
                        }
                        newItem.quantity = newItem.batches.reduce((s, b) => s + (parseInt(b.quantity, 10) || 0), 0);
                    } else {
                        newItem.quantity = quantity;
                        // 若原本有 batches，覆蓋更新時保留以避免破壞
                    }
                    return { row, action: 'update', reason: note, item: newItem };
                }
                return { row, action: 'skip', reason: '條碼已存在（跳過模式）' };
            }
            // 全新項目
            const newItem = { barcode, name, category: finalCat, pointsCost, quantity };
            if (validExpiry && quantity > 0) {
                newItem.batches = [{
                    batchId: 'B001', quantity, expiryDate: validExpiry, receivedAt: new Date().toISOString()
                }];
            }
            return { row, action: 'add', reason: note, item: newItem };
        });
    }

    function renderInvImportPreview(classified) {
        const counts = { add: 0, update: 0, skip: 0, error: 0 };
        classified.forEach(r => counts[r.action]++);
        const parts = [];
        if (counts.add)    parts.push(`<span style="color:var(--success);font-weight:600;">✅ 新增 ${counts.add} 筆</span>`);
        if (counts.update) parts.push(`<span style="color:var(--primary-color);font-weight:600;">🔄 更新 ${counts.update} 筆</span>`);
        if (counts.skip)   parts.push(`<span style="color:var(--text-secondary);font-weight:600;">⏭️ 跳過 ${counts.skip} 筆</span>`);
        if (counts.error)  parts.push(`<span style="color:var(--danger);font-weight:600;">❌ 錯誤 ${counts.error} 筆</span>`);
        document.getElementById('importInvSummary').innerHTML =
            `<div style="display:flex;gap:1.25rem;flex-wrap:wrap;margin-bottom:0.75rem;">${parts.join('')}</div>`;

        const STYLE = {
            add:    { label: '新增', bg: '#d1fae5', color: '#065f46' },
            update: { label: '更新', bg: '#dbeafe', color: '#1e40af' },
            skip:   { label: '跳過', bg: '#f1f5f9', color: '#64748b' },
            error:  { label: '錯誤', bg: '#fee2e2', color: '#991b1b' },
        };

        const tbody = document.getElementById('importInvPreviewBody');
        tbody.innerHTML = classified.map(item => {
            const s = STYLE[item.action];
            const bc   = item.item?.barcode || item.row['條碼'] || '—';
            const name = item.item?.name    || item.row['名稱'] || '—';
            const cat  = item.item?.category|| item.row['分類'] || '—';
            const qty  = item.item != null ? item.item.quantity : (item.row['庫存量'] || '—');
            const exp  = (item.row['有效期'] || '').trim() || '—';
            return `<tr>
                <td><span class="badge" style="background:${s.bg};color:${s.color};">${s.label}</span></td>
                <td><code>${escapeHtml(String(bc))}</code></td>
                <td>${escapeHtml(String(name))}</td>
                <td>${escapeHtml(String(cat))}</td>
                <td>${escapeHtml(String(qty))}</td>
                <td>${escapeHtml(String(exp))}</td>
                <td style="font-size:0.8rem;color:${item.action === 'error' ? 'var(--danger)' : 'var(--text-secondary)'};">${escapeHtml(item.reason || '')}</td>
            </tr>`;
        }).join('');

        const canImport = counts.add + counts.update > 0;
        const btn = document.getElementById('importInvConfirmBtn');
        btn.classList.toggle('hidden', !canImport);
        if (canImport) btn.textContent = `確認匯入 ${counts.add + counts.update} 筆`;
    }

    function showInvImportError(msg) {
        const el = document.getElementById('importInvError');
        el.textContent = msg;
        el.classList.remove('hidden');
    }

    function runInvImportParse() {
        const file = document.getElementById('importInvFileInput').files[0];
        if (!file) return;
        const errEl = document.getElementById('importInvError');
        const previewEl = document.getElementById('importInvPreviewSection');
        errEl.classList.add('hidden');
        previewEl.classList.add('hidden');
        document.getElementById('importInvConfirmBtn').classList.add('hidden');
        _importInvClassified = null;

        const reader = new FileReader();
        reader.onerror = () => showInvImportError('讀取檔案失敗，請重試。');
        reader.onload = (e) => {
            let rows;
            try { rows = Core.parseCsvText(e.target.result); }
            catch (err) { showInvImportError('解析 CSV 失敗：' + err.message); return; }
            if (rows === null)   { showInvImportError('CSV 格式錯誤：需包含標題列與至少一筆資料。'); return; }
            if (rows.length === 0) { showInvImportError('CSV 內無任何資料列（僅含標題）。'); return; }

            const missing = ['條碼','名稱'].filter(h => !(h in rows[0]));
            if (missing.length) {
                showInvImportError(`CSV 缺少必要欄位：${missing.join('、')}。請參考「匯出 → 現有庫存」的格式（可額外加上「有效期」欄）。`);
                return;
            }
            const mode = document.querySelector('input[name="importInvMode"]:checked').value;
            _importInvClassified = classifyInvImport(rows, mode);
            renderInvImportPreview(_importInvClassified);
            previewEl.classList.remove('hidden');
        };
        reader.readAsText(file, 'UTF-8');
    }

    // ===== init() =====
    function init() {
        // 搜尋與篩選
        document.getElementById('invSearchInput').addEventListener('input', render);
        document.getElementById('invCategoryFilter').addEventListener('change', render);

        // 入庫 Log 展開
        document.getElementById('toggleInventoryLog').addEventListener('click', () => {
            _inventoryLogShowAll = !_inventoryLogShowAll;
            document.getElementById('toggleInventoryLog').textContent = _inventoryLogShowAll ? '只顯示最近 15 筆' : '顯示全部';
            renderInventoryLog();
        });

        // 行內編輯：儲存全部
        document.getElementById('invSaveAllBtn').addEventListener('click', () => {
            const inv = getInventory();
            const catChanges = {};
            const editedBarcodes = Object.keys(_invEditState);

            Object.entries(_invEditState).forEach(([barcode, data]) => {
                const idx = inv.findIndex(i => i.barcode === barcode);
                if (idx === -1) return;
                if (inv[idx].category !== data.category) catChanges[barcode] = data.category;
                // quantity 直接覆蓋；若有 batches，提示但仍依使用者輸入為主
                Object.assign(inv[idx], data);
                // 保留既有 batches 結構；若 quantity 與 batches 加總不一致，清掉 batches（讓使用者重新建立）
                if (Array.isArray(inv[idx].batches) && inv[idx].batches.length > 0) {
                    const sum = inv[idx].batches.reduce((s, b) => s + (parseInt(b.quantity,10) || 0), 0);
                    if (sum !== inv[idx].quantity) {
                        delete inv[idx].batches;
                    }
                }
            });
            saveInventory(inv);
            logAdminAction('INV_UPDATE', editedBarcodes.join(','), `行內編輯庫存 ${editedBarcodes.length} 筆`);

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

            Core.clearCatCache();
            _invEditState = {};
            render();
            updateInvSaveBar();
            if (window.Rd) Rd.renderHistory();
            if (window.Dash) Dash.render();
        });

        document.getElementById('invCancelAllBtn').addEventListener('click', () => {
            _invEditState = {};
            render();
            updateInvSaveBar();
        });

        // 列表事件委派
        document.getElementById('inventoryTableBody').addEventListener('click', (e) => {
            const editBtn   = e.target.closest('.inv-edit-btn');
            const cancelBtn = e.target.closest('.inv-cancel-btn');
            const batchBtn  = e.target.closest('.inv-batch-btn');
            if (editBtn) {
                const bc = editBtn.dataset.barcode;
                const item = getInventory().find(i => i.barcode === bc);
                _invEditState[bc] = { name: item.name, category: item.category, quantity: item.quantity, pointsCost: item.pointsCost };
                updateInvSaveBar();
                render();
            } else if (cancelBtn) {
                delete _invEditState[cancelBtn.dataset.barcode];
                updateInvSaveBar();
                render();
            } else if (batchBtn) {
                openBatchModal(batchBtn.dataset.barcode);
            }
        });
        document.getElementById('inventoryTableBody').addEventListener('change', (e) => {
            const field = e.target.closest('.inv-field');
            if (!field) return;
            const bc = field.dataset.barcode, fn = field.dataset.field;
            if (!_invEditState[bc]) return;
            _invEditState[bc][fn] = (fn === 'quantity' || fn === 'pointsCost') ? (parseInt(field.value, 10) || 0) : field.value;
        });

        // 分類維護
        document.getElementById('manageCategoryBtn').addEventListener('click', () => {
            renderCategoryList();
            Core.openModal('categoryModal');
        });
        document.getElementById('categoryForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const val = document.getElementById('newCategoryName').value.trim();
            const cats = getCategories();
            if (val && !cats.includes(val)) {
                cats.push(val);
                saveCategories(cats);
                logAdminAction('CAT_CREATE', val);
                document.getElementById('newCategoryName').value = '';
                renderCategoryList();
                renderFilters();
            }
        });

        // 批量入庫
        const invInput = document.getElementById('batchInvScanner');
        document.getElementById('batchInventoryBtn').addEventListener('click', () => {
            _batchInvList = [];
            renderBatchInvTable();
            Core.openModal('batchInventoryModal');
            setTimeout(() => invInput.focus(), 100);
        });
        invInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const code = e.target.value.trim();
                if (!code) return;
                e.target.value = '';
                if (_batchInvList.find(x => x.barcode === code)) {
                    Core.toast('此條碼已在編輯清單中', 'warn'); return;
                }
                const existing = getInventory().find(i => i.barcode === code);
                if (existing) {
                    _batchInvList.push({ isNew: false, barcode: code, name: existing.name, category: existing.category, pointsCost: existing.pointsCost, currentQty: existing.quantity, adjustQty: 1, expiryDate: '' });
                } else {
                    _batchInvList.push({ isNew: true, barcode: code, name: '', category: getCategories()[0] || '未分類', pointsCost: 100, currentQty: 0, adjustQty: 1, expiryDate: '' });
                }
                renderBatchInvTable();
            }
        });
        document.getElementById('batchInvTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('.b-del');
            if (!btn) return;
            _batchInvList.splice(parseInt(btn.dataset.idx), 1);
            renderBatchInvTable();
            invInput.focus();
        });
        document.getElementById('batchInvTableBody').addEventListener('change', (e) => {
            const el  = e.target;
            const idx = parseInt(el.dataset.idx);
            if (isNaN(idx)) return;
            if (el.classList.contains('b-name'))      _batchInvList[idx].name       = el.value;
            else if (el.classList.contains('b-cat'))  _batchInvList[idx].category   = el.value;
            else if (el.classList.contains('b-pts'))  _batchInvList[idx].pointsCost = parseInt(el.value, 10) || 1;
            else if (el.classList.contains('b-qty'))  _batchInvList[idx].adjustQty  = parseInt(el.value, 10) || 0;
            else if (el.classList.contains('b-exp'))  _batchInvList[idx].expiryDate = el.value;
        });
        document.getElementById('batchInvForm').addEventListener('submit', (e) => {
            e.preventDefault();
            for (let i of _batchInvList) {
                if (i.isNew && !i.name.trim()) { Core.toast(`條碼 ${i.barcode} 請輸入名稱`, 'error'); return; }
                if (i.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(i.expiryDate)) {
                    Core.toast(`條碼 ${i.barcode} 的有效期格式錯誤`, 'error'); return;
                }
            }
            const inv = getInventory();
            _batchInvList.forEach(item => {
                if (item.isNew) {
                    const newItem = { barcode: item.barcode, name: item.name, category: item.category, pointsCost: item.pointsCost, quantity: item.adjustQty };
                    if (item.expiryDate && item.adjustQty > 0) {
                        newItem.batches = [{
                            batchId: 'B001',
                            quantity: item.adjustQty,
                            expiryDate: item.expiryDate,
                            receivedAt: new Date().toISOString()
                        }];
                    }
                    inv.push(newItem);
                    logInventoryChange(item.barcode, item.name, item.adjustQty,
                        item.expiryDate ? `批量建檔入庫（到期 ${item.expiryDate}）` : '批量建檔入庫');
                } else {
                    const idx = inv.findIndex(x => x.barcode === item.barcode);
                    const target = inv[idx];
                    if (item.expiryDate && item.adjustQty > 0) {
                        addBatch(target, item.adjustQty, item.expiryDate);
                        logInventoryChange(item.barcode, item.name, item.adjustQty, `批號入庫（到期 ${item.expiryDate}）`);
                    } else {
                        // 無到期日 → 若已有批號，加入「無到期」批號；否則直接調整 quantity
                        if (Array.isArray(target.batches) && target.batches.length > 0 && item.adjustQty > 0) {
                            addBatch(target, item.adjustQty, '');
                        } else if (item.adjustQty > 0) {
                            target.quantity += item.adjustQty;
                        } else {
                            target.quantity += item.adjustQty;
                            if (target.quantity < 0) target.quantity = 0;
                        }
                        logInventoryChange(item.barcode, item.name, item.adjustQty, '批量掃描補庫存');
                    }
                }
            });
            const addedCount = _batchInvList.filter(i => i.isNew).length;
            const updatedCount = _batchInvList.length - addedCount;
            saveInventory(inv);
            logAdminAction('INV_BATCH_INBOUND', `${_batchInvList.length} 筆`, `新建 ${addedCount} 筆、補庫存 ${updatedCount} 筆`);
            _batchInvList = [];
            render();
            renderInventoryLog();
            if (window.Dash) Dash.render();
            Core.closeModal('batchInventoryModal');
            Core.toast(`入庫完成：新建 ${addedCount} 筆、補庫存 ${updatedCount} 筆`);
        });

        // 批號管理 Modal
        document.getElementById('batchManageTableBody').addEventListener('click', (e) => {
            const delBtn = e.target.closest('.batch-del-btn');
            if (!delBtn) return;
            const id = delBtn.dataset.id;
            if (!confirm(`確定刪除批號 ${id}？`)) return;
            const inv = getInventory();
            const idx = inv.findIndex(i => i.barcode === _batchEditingBarcode);
            if (idx === -1) return;
            inv[idx].batches = (inv[idx].batches || []).filter(b => b.batchId !== id);
            syncQuantity(inv[idx]);
            saveInventory(inv);
            logAdminAction('INV_BATCH_DELETE', `${inv[idx].barcode} ${id}`);
            renderBatchManageList();
            render();
            if (window.Dash) Dash.render();
        });
        document.getElementById('batchManageTableBody').addEventListener('change', (e) => {
            const f = e.target.closest('.batch-qty-field');
            if (!f) return;
            const id = f.dataset.id;
            const newQty = Math.max(0, parseInt(f.value, 10) || 0);
            const inv = getInventory();
            const idx = inv.findIndex(i => i.barcode === _batchEditingBarcode);
            if (idx === -1) return;
            const b = (inv[idx].batches || []).find(x => x.batchId === id);
            if (b) {
                b.quantity = newQty;
                inv[idx].batches = inv[idx].batches.filter(x => x.quantity > 0);
                syncQuantity(inv[idx]);
                saveInventory(inv);
                logAdminAction('INV_BATCH_UPDATE', `${inv[idx].barcode} ${id}`, `調整為 ${newQty}`);
                renderBatchManageList();
                render();
                if (window.Dash) Dash.render();
            }
        });
        document.getElementById('batchManageNewForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const qty = Math.max(1, parseInt(document.getElementById('batchManageNewQty').value, 10) || 0);
            const exp = document.getElementById('batchManageNewExpiry').value;
            if (qty < 1) { Core.toast('數量需大於 0', 'error'); return; }
            if (exp && !/^\d{4}-\d{2}-\d{2}$/.test(exp)) { Core.toast('有效期格式錯誤', 'error'); return; }
            const inv = getInventory();
            const idx = inv.findIndex(i => i.barcode === _batchEditingBarcode);
            if (idx === -1) return;
            const newId = addBatch(inv[idx], qty, exp);
            saveInventory(inv);
            logInventoryChange(inv[idx].barcode, inv[idx].name, qty, exp ? `新增批號 ${newId}（到期 ${exp}）` : `新增批號 ${newId}`);
            logAdminAction('INV_BATCH_CREATE', `${inv[idx].barcode} ${newId}`, `+${qty}${exp ? `, 到期 ${exp}` : ''}`);
            document.getElementById('batchManageNewQty').value = '';
            document.getElementById('batchManageNewExpiry').value = '';
            renderBatchManageList();
            render();
            renderInventoryLog();
            if (window.Dash) Dash.render();
        });

        // #2 庫存 CSV 匯入
        document.getElementById('importInvBtn').addEventListener('click', () => {
            document.getElementById('importInvFileInput').value = '';
            document.getElementById('importInvError').classList.add('hidden');
            document.getElementById('importInvPreviewSection').classList.add('hidden');
            document.getElementById('importInvConfirmBtn').classList.add('hidden');
            document.querySelector('input[name="importInvMode"][value="add"]').checked = true;
            _importInvClassified = null;
            Core.openModal('inventoryImportModal');
        });
        document.getElementById('importInvCancelBtn').addEventListener('click', () => Core.closeModal('inventoryImportModal'));
        document.getElementById('importInvFileInput').addEventListener('change', runInvImportParse);
        document.querySelectorAll('input[name="importInvMode"]').forEach(r =>
            r.addEventListener('change', () => {
                if (document.getElementById('importInvFileInput').files.length) runInvImportParse();
            })
        );
        document.getElementById('importInvConfirmBtn').addEventListener('click', () => {
            if (!_importInvClassified) return;
            const inv = getInventory();
            let addCount = 0, updateCount = 0;
            _importInvClassified.forEach(r => {
                if (r.action === 'add') {
                    inv.push(r.item);
                    logInventoryChange(r.item.barcode, r.item.name, r.item.quantity, '批量匯入新建');
                    addCount++;
                } else if (r.action === 'update') {
                    const idx = inv.findIndex(i => i.barcode === r.item.barcode);
                    if (idx === -1) return;
                    const beforeQty = inv[idx].quantity;
                    inv[idx] = r.item;
                    const delta = r.item.quantity - beforeQty;
                    if (delta !== 0) logInventoryChange(r.item.barcode, r.item.name, delta, '批量匯入更新');
                    updateCount++;
                }
            });
            saveInventory(inv);
            const mode = document.querySelector('input[name="importInvMode"]:checked').value;
            logAdminAction('INV_IMPORT', `新增 ${addCount}、更新 ${updateCount}`, `模式：${mode === 'add' ? '僅新增' : '覆蓋更新'}`);
            _importInvClassified = null;
            Core.closeModal('inventoryImportModal');
            render();
            renderFilters();
            renderInventoryLog();
            if (window.Dash) Dash.render();
            Core.toast(`匯入完成：新增 ${addCount} 筆、更新 ${updateCount} 筆`);
        });
    }

    return {
        init, render, renderFilters, renderInventoryLog,
        // 給 Redemption 模組共用：以 FEFO 扣 1 件
        deductOne,
        // 暴露給 Dashboard 用
        countExpiringSoon: function (days) {
            const now = new Date();
            const limit = new Date(now.getTime() + days * 86400000);
            let count = 0;
            getInventory().forEach(item => {
                if (!item.batches || item.batches.length === 0) return;
                for (const b of item.batches) {
                    if (!b.expiryDate || b.quantity <= 0) continue;
                    const exp = new Date(b.expiryDate + 'T23:59:59');
                    if (exp <= limit) { count++; return; }
                }
            });
            return count;
        }
    };
})();
