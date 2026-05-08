// admin_app.js — 後台入口：bootstrap → 各模組 init → 初始 render
document.addEventListener('DOMContentLoaded', () => {
    Core.bootstrap(() => {
        // 各模組初始化（綁定事件）
        Dash.init();
        Inv.init();
        Mem.init();
        Rd.init();
        DataMgr.init();

        // 導覽設定（每個視圖切過去時的 hook）
        Core.setupNavigation({
            dashboardView:    () => Dash.renderActiveReport(),
            inventoryView:    () => Inv.renderInventoryLog(),
            dataView:         () => { if (Core.isSuper()) DataMgr.renderAuditLog(); },
            adminManageView:  () => DataMgr.renderAdminManagePage()
        });

        // Modal 關閉攔截（批量核銷與批量入庫有未送出資料時提示）
        Core.setupModalClose({
            batchRedeemModal:    () => Rd.intercept_batchRedeemModal(),
            batchInventoryModal: () => true
        });

        // 初始畫面渲染
        Inv.renderFilters();
        Inv.render();
        Inv.renderInventoryLog();
        Mem.render();
        Mem.updateBatchBar();
        Rd.renderHistory();
        Dash.render();

        Core.applyRoleVisibility();
        if (Core.isSuper()) DataMgr.renderAuditLog();
    });
});
