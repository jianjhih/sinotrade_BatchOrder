// ==UserScript==
// @name         永豐金證券批次委託注入助手
// @namespace    https://github.com/jianjhih/sinotrade_BatchOrder/blob/master/SinotradeBatchHelper.js
// @version      4.2.4 // 最終穩定版：修正 UI 凍結 + 整合多 XML 檔案匯入
// @description  支援一次匯入多個 MDJ/XML 批次委託檔案，依序解析數據後注入到永豐金證券網頁 DataTables。
// @author       jianjhih
// @match        https://www.sinotrade.com.tw/inside/Batch_Order
// @icon         https://www.sinotrade.com.tw/newweb/images/icons/512.png
// @grant        none
// @license      MIT
// @homepage     https://github.com/jianjhih/sinotrade_BatchOrder
// ==/UserScript==

(function () {
    'use strict';

    console.log("🚀 程式夥伴：零股 JSON 注入腳本 V4.2.4 載入成功！ (多檔案整合)");

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ====================================================================
    // A. 輔助函式 (邏輯不變)
    // ====================================================================

    function getCookieValue(name) {
        const value = `; ${document.cookie}`;
        const parts = value.split(`; ${name}=`);
        if (parts.length === 2) return parts.pop().split(';').shift();
        return null;
    }

    function getDynamicOrderParams(accountSelectOption) {
        let identityParams = {};

        if (accountSelectOption) {
            try {
                const jsonString = accountSelectOption.value.replace(/&quot;/g, '"');
                const decodedParams = JSON.parse(jsonString);
                identityParams = {
                    ID: decodedParams.idno, account: decodedParams.account,
                    broker_id: decodedParams.broker_id, user_name: decodedParams.username,
                    accttype: decodedParams.accttype
                };
            } catch (e) {
                console.error("❌ 身份參數解析失敗 (DOM):", e);
            }
        }

        const tokenFromCookie = getCookieValue('token');
        const ipFromCookie = getCookieValue('client_ip');

        const params = {
            ID: identityParams.ID || null, account: identityParams.account || null,
            broker_id: identityParams.broker_id || null, user_name: identityParams.user_name || null,
            accttype: identityParams.accttype || null, token: tokenFromCookie || null,
            IP: ipFromCookie || null
        };

        if (!params.token) {
             console.error("❌ 嚴重錯誤：無法從 Cookie 獲取有效的 Token！注入將會失敗。");
        } else {
             console.log("✅ 程式夥伴：Token 已從 Cookie 動態獲取。");
        }

        return params;
    }

    function waitForElement(selector, timeout = 10000, interval = 100) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const timer = setInterval(() => {
                const element = document.querySelector(selector);
                if (element) {
                    clearInterval(timer);
                    resolve(element);
                } else if (Date.now() - startTime >= timeout) {
                    clearInterval(timer);
                    reject(new Error(`Timeout waiting for element: ${selector}`));
                }
            }, interval);
        });
    }

    function getModeMappingFromXML(stockId, vol) {
        const isOddLot = (stockId.toLowerCase().includes('.tw') && vol < 1000) || vol < 1000;

        if (isOddLot) {
            return { ord_type: 'C', session: 'C', market_id: 'S', isWholeShare: false, finalQty: vol };
        } else {
             const sharesPerLot = 1000;
             const lots = Math.floor(vol / sharesPerLot);
             return { ord_type: '0', session: '0', market_id: 'S', isWholeShare: true, finalQty: lots };
        }
    }

    function clearSyncedData() {
        try {
            const appElement = document.querySelector('#app-container') || document.body;
            const frameworkInstance = appElement.__vue__ || appElement._reactRootContainer;

            if (frameworkInstance) {
                const possiblePaths = ['orderList', 'batchOrders', 'rows', 'tableData', 'data.orderList'];
                for (const path of possiblePaths) {
                    let orderDataModel = frameworkInstance[path] || (frameworkInstance.$data && frameworkInstance.$data[path]);

                    if (Array.isArray(orderDataModel)) {
                        orderDataModel.length = 0;
                        return true;
                    }
                }
            }
        } catch (error) {
             console.warn("⚠️ 數據同步失敗：無法找到或清空前端框架的訂單數據模型。", error);
        }
        return false;
    }


    // ====================================================================
    // C. 核心 XML 解析與注入 (單檔案處理邏輯)
    // ====================================================================

    /**
     * 處理單個 XML 檔案的注入邏輯，只負責添加數據到 DataTables。
     * @param {string} fileContent XML 檔案內容
     * @param {object} dataTable DataTables 實例
     * @returns {Promise<number>} 成功注入的筆數
     */
    async function processSingleFile(fileContent, dataTable) {
        // 1. 解析 XML 內容
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(fileContent, "application/xml");
        const ordersXML = xmlDoc.getElementsByTagName('Order');

        if (ordersXML.length === 0) { return 0; }

        const DYNAMIC_PARAMS = getDynamicOrderParams(document.querySelector('.dropdown.account__select option'));

        const ORDER_TEMPLATE = {
            ...DYNAMIC_PARAMS, "market_id": "S", "ord_bs": "B",
            "ord_cond": "0", "ord_type": "C", "price_type": " ", "session": "C",
            "time_in_force": "0", "isSelected": true, "stock_id": null,
            "product_name": null, "ord_price": null, "ord_qty": null,
        };

        let injectedCount = 0;

        // 2. 遍歷並批量添加 XML 訂單 (不繪製)
        for (let i = 0; i < ordersXML.length; i++) {
            const orderNode = ordersXML[i];

            const stockIdFull = orderNode.getAttribute('ID');
            const stockId = stockIdFull.replace(/\.TW/i, '');
            const price = parseFloat(orderNode.getAttribute('Price'));
            const vol = parseInt(orderNode.getAttribute('Vol'));
            const bs = orderNode.getAttribute('BS') || 'B';

            if (stockId && !isNaN(price) && vol > 0) {

                const modeMap = getModeMappingFromXML(stockIdFull, vol);
                const newOrder = { ...ORDER_TEMPLATE };

                newOrder.ord_type = modeMap.ord_type;
                newOrder.session = modeMap.session;
                newOrder.market_id = modeMap.market_id;
                newOrder.ord_bs = bs;

                newOrder.stock_id = stockId;
                newOrder.product_name = stockId;
                newOrder.ord_price = price.toFixed(2).toString();
                newOrder.ord_qty = modeMap.finalQty;

                dataTable.row.add(newOrder); // 僅添加數據
                injectedCount++;
            }
        }

        return injectedCount;
    }


    // ------------------------------------------
    // D. UI/初始化 (整合多檔案處理)
    // ------------------------------------------

    async function initializeScript(mainButton, infoContainer, fileInput) {
        let DYNAMIC_PARAMS = getDynamicOrderParams(null);

        try {
            const accountSelectOption = await waitForElement('.dropdown.account__select option');
            DYNAMIC_PARAMS = getDynamicOrderParams(accountSelectOption);
            infoContainer.innerHTML = `身份資訊：<b>${DYNAMIC_PARAMS.user_name || 'N/A'}</b><br>帳號：<b>${DYNAMIC_PARAMS.account || 'N/A'}</b>`;

        } catch (error) {
            console.error(`❌ 腳本身份資訊初始化失敗: ${error.message}`);
        }

        // --- 檢查 DataTables 實例 ---
        let dataTable = null;
        try {
            await waitForElement('#batch-stock__table', 10000, 100);

            if (!$.fn.dataTable.isDataTable('#batch-stock__table')) {
                 console.warn("⚠️ DataTables 實例未找到，核心功能無法啟用。");
                 return;
            }
            dataTable = $('#batch-stock__table').DataTable();

        } catch (error) {
             console.error("❌ DataTables 表格元素未找到，核心功能無法啟用。", error);
             return;
        }

        const $tableWrapper = $('#batch-stock__table_wrapper');


        // --- 點擊事件 (處理多檔案邏輯) ---
        mainButton.addEventListener('click', () => { fileInput.click(); });

        fileInput.addEventListener('change', async (event) => {
            const files = event.target.files;
            if (!files || files.length === 0) return;

            if (!DYNAMIC_PARAMS.token || !DYNAMIC_PARAMS.account) {
                 alert("❌ 錯誤：Token/帳號資訊未獲取，請檢查登入狀態。");
                 return;
            }

            mainButton.disabled = true;
            let totalInjectedCount = 0;
            let fileCount = 0;

            $tableWrapper.css('opacity', 0);

            try {
                // 異步循環處理每個檔案
                for (const file of files) {
                    fileCount++;
                    mainButton.innerText = `⚙️ 處理檔案 ${fileCount}/${files.length} (${file.name})...`;

                    const fileContent = await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = (e) => resolve(e.target.result);
                        reader.onerror = reject;
                        reader.readAsText(file);
                    });

                    // ⭐ 串行注入：只添加數據
                    const injectedCount = await processSingleFile(fileContent, dataTable);
                    totalInjectedCount += injectedCount;
                }

                // --- 4. 批量繪製和 UI 修正 ---
                console.log(`📦 ${fileCount} 個檔案數據添加完畢，共 ${totalInjectedCount} 筆，開始單次批量繪製表格...`);

                // ⭐ 關鍵：單次繪製
                dataTable.draw(false);
                await sleep(50);

                // 執行 UI 修正 (買賣方向顏色等)
                const rows = dataTable.rows().nodes().toArray();
                const newRows = rows.slice(-totalInjectedCount);
                const $bsDropdowns = $(newRows).find('.batch-stock__ord-BS__dropDown');

                $bsDropdowns.each(function() {
                    const $dropdown = $(this);
                    const rowData = dataTable.row($dropdown.closest('tr')).data();
                    const actualBS = rowData.ord_bs || 'B';

                    let color = 'black';
                    if (actualBS === 'B') { color = 'red'; } else if (actualBS === 'S') { color = 'green'; }

                    if (actualBS === 'B' || actualBS === 'S') {
                        if ($dropdown.val() !== actualBS) { $dropdown.val(actualBS); }
                        $dropdown.find(`option[value="${actualBS}"]`).prop('selected', true);
                        $dropdown.css('color', color);
                    }
                });
                console.log("✅ UI 修正：所有檔案的買賣方向已完成設定。");

                $tableWrapper.css('opacity', 1);

                alert(`✅ 成功注入 ${fileCount} 個檔案，共 ${totalInjectedCount} 筆訂單！`);

            } catch (error) {
                console.error("❌ 多檔案注入過程中發生致命錯誤:", error);
                alert(`❌ 注入失敗！請檢查 Console 或檔案格式。錯誤: ${error.message}`);
                $tableWrapper.css('opacity', 1);
            }

            // 恢復按鈕狀態
            mainButton.disabled = false;
            mainButton.innerText = "📂 匯入 XML 批次委託檔 (.xml)";
            fileInput.value = '';
        });

        // --- 提交清理監聽器 ---
        const submitButton = document.querySelector('.btn__submit__select');
        if (submitButton) {
            submitButton.addEventListener('click', async () => {
                await sleep(1500);
                const isSynced = clearSyncedData();
                if (dataTable.rows().count() > 0) {
                     if (!isSynced) console.log("🧹 DataTables 正在手動清理...");
                     dataTable.clear().draw();
                }
                if (isSynced) console.log("✅ DataTables 和前端數據模型已同步清空。");
            });
        }
    }


    /**
     * 腳本啟動點：創建 UI 元素並延遲調用 initializeScript
     */
    async function runScript() {
        // --- 創建 UI 元素 (確保立即顯示) ---
        const customContainer = document.createElement("div");
        Object.assign(customContainer.style, {
            position: 'fixed', top: '100px', left: '50%', transform: 'translateX(-50%)',
            zIndex: '2147483647',
            padding: '10px', backgroundColor: '#fff', border: '2px solid #333',
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'row',
            alignItems: 'center', gap: '15px'
        });
        document.body.appendChild(customContainer);

        const fileInput = document.createElement("input");
        fileInput.type = "file"; fileInput.accept = ".xml"; fileInput.multiple = true; // ⭐ 啟用多選
        fileInput.style.display = "none";
        customContainer.appendChild(fileInput);

        const mainButton = document.createElement("button");
        mainButton.innerText = "📂 匯入 XML 批次委託檔 (.xml)";
        Object.assign(mainButton.style, {
            padding: "8px 15px", backgroundColor: "#d9534f",
            color: "white", border: "none", borderRadius: "4px", cursor: "pointer",
            fontWeight: "bold", flexShrink: 0
        });
        customContainer.appendChild(mainButton);

        const infoContainer = document.createElement("div");
        infoContainer.innerHTML = `身份資訊：<b>載入中...</b><br>帳號：<b>載入中...</b>`;
        Object.assign(infoContainer.style, { fontSize: '12px', lineHeight: '1.3', padding: '0 5px' });
        customContainer.appendChild(infoContainer);

        // ⭐ 關鍵修正：延遲執行 initializeScript
        setTimeout(() => {
            initializeScript(mainButton, infoContainer, fileInput);
        }, 500);
    }

    // 執行腳本啟動
    runScript();
})();
