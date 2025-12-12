// ==UserScript==
// @name         永豐金證券批次委託注入助手
// @namespace    https://github.com/jianjhih/sinotrade_BatchOrder/blob/master/SinotradeBatchHelper.js
// @version      4.1.6 // 最終穩定：通用嘗試同步清空 Vue/框架數據模型
// @description  解決 DataTables 與前端框架的數據不同步問題，實現同步清空。
// @author       jianjhih
// @match        https://www.sinotrade.com.tw/inside/Batch_Order
// @icon         https://www.sinotrade.com.tw/newweb/images/icons/512.png
// @grant        none
// @license      MIT
// @homepage     https://github.com/jianjhih/sinotrade_BatchOrder
// ==/UserScript==

(function () {
    'use strict';

    console.log("🚀 程式夥伴：零股 JSON 注入腳本 V4.1.6 載入成功！ (通用同步)");

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // --- (省略輔助函式) ---

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


    // ====================================================================
    // ⭐ E. 核心：同步清空數據模型函式 - 通用策略
    // ====================================================================

    /**
     * 嘗試同步清空前端框架中儲存訂單的數據陣列。
     */
    function clearSyncedData() {
        try {
            // 策略 1: 查找 #app-container 或 body 上的 Vue/React 實例
            const appElement = document.querySelector('#app-container') || document.body;
            // 嘗試獲取框架實例 (假設它被掛載在 __vue__ 或其他常見屬性上)
            const frameworkInstance = appElement.__vue__ || appElement._reactRootContainer;

            if (frameworkInstance) {
                // 策略 2: 遍歷常見的數據路徑尋找訂單陣列
                const possiblePaths = [
                    'orderList', 'batchOrders', 'rows', 'tableData', 'data.orderList'
                ];

                for (const path of possiblePaths) {
                    // 嘗試從實例的 $data 或頂層屬性獲取陣列
                    let orderDataModel = frameworkInstance[path] || (frameworkInstance.$data && frameworkInstance.$data[path]);

                    if (Array.isArray(orderDataModel)) {
                        orderDataModel.length = 0; // 直接清空陣列，觸發框架更新
                        console.log(`✅ 數據同步成功：前端框架的訂單數據模型 (${path}) 已清空。`);
                        return true;
                    }
                }
            }

        } catch (error) {
             console.warn("⚠️ 數據同步失敗：無法找到或清空前端框架的訂單數據模型。", error);
        }
        return false;
    }


    // ------------------------------------------
    // C. 核心 XML 解析與注入 (略)
    // ------------------------------------------

    async function processInjection(fileContent) {
        if (typeof $ === 'undefined' || typeof $.fn.DataTable === 'undefined') {
             throw new Error("DataTables 或 jQuery 函式庫尚未載入。");
        }
        const dataTable = $('#batch-stock__table').DataTable();
        const $tableWrapper = $('#batch-stock__table_wrapper');

        // 1. 解析 XML 內容 (略)
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(fileContent, "application/xml");
        const ordersXML = xmlDoc.getElementsByTagName('Order');

        if (ordersXML.length === 0) {
            alert("XML 檔案中未找到 <Order> 標籤！請檢查檔案格式是否正確。");
            return;
        }

        const DYNAMIC_PARAMS = getDynamicOrderParams(document.querySelector('.dropdown.account__select option'));
        const totalOrders = ordersXML.length;

        const ORDER_TEMPLATE = {
            ...DYNAMIC_PARAMS, "market_id": "S", "ord_bs": "B",
            "ord_cond": "0", "ord_type": "C", "price_type": " ", "session": "C",
            "time_in_force": "0", "isSelected": true, "stock_id": null,
            "product_name": null, "ord_price": null, "ord_qty": null,
        };

        let injectedCount = 0;
        let invalidCount = 0;
        const newRowNodes = [];

        console.log(`--- 開始批量處理 ${totalOrders} 筆 XML 訂單 ---`);

        // 關鍵步驟 1：隱藏表格容器
        $tableWrapper.css('opacity', 0);

        // 2. 遍歷並批量添加 XML 訂單
        for (let i = 0; i < totalOrders; i++) {
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

                const row = dataTable.row.add(newOrder);
                const rowNode = row.node();
                if (rowNode) newRowNodes.push(rowNode);

                injectedCount++;
            } else {
                 console.warn(`⚠️ 跳過無效 XML 訂單 (ID: ${stockIdFull}, Price: ${price}, Vol: ${vol})`);
                 invalidCount++;
            }
        }

        // 3. 批量繪製表格
        console.log("📦 數據添加完畢，開始單次批量繪製表格...");
        dataTable.draw(false);

        // 4. UI 修正
        await sleep(50);

        try {
            if (injectedCount > 0) {
                const rows = dataTable.rows().nodes().toArray();
                const newRows = rows.slice(-injectedCount);

                const $bsDropdowns = $(newRows).find('.batch-stock__ord-BS__dropDown');

                $bsDropdowns.each(function() {
                    const $dropdown = $(this);
                    const rowData = dataTable.row($dropdown.closest('tr')).data();
                    const actualBS = rowData.ord_bs || 'B';

                    let color = 'black';
                    if (actualBS === 'B') {
                        color = 'red';
                    } else if (actualBS === 'S') {
                        color = 'green';
                    }

                    if (actualBS === 'B' || actualBS === 'S') {
                        if ($dropdown.val() !== actualBS) {
                            $dropdown.val(actualBS);
                        }

                        $dropdown.find(`option[value="${actualBS}"]`).prop('selected', true);
                        $dropdown.css('color', color);
                    }
                });
                console.log("✅ UI 修正：買賣方向和顏色已在隱藏狀態下完成設定。");
            }

        } catch(e) {
            console.error("❌ UI 買賣方向修正失敗：", e);
        }

        // 5. 顯示表格容器
        $tableWrapper.css('opacity', 1);

        console.log("✅ XML 數據注入完成！");
        //alert(`成功注入 ${injectedCount} 筆訂單！`);
    }

    // ------------------------------------------
    // D. UI/初始化 (加入 clearSyncedData 調用)
    // ------------------------------------------

    async function initializeScript() {
        let DYNAMIC_PARAMS;

        try {
            const accountSelectOption = await waitForElement('.dropdown.account__select option');
            DYNAMIC_PARAMS = getDynamicOrderParams(accountSelectOption);

        } catch (error) {
            console.error(`❌ 腳本初始化失敗: ${error.message}`);
            DYNAMIC_PARAMS = getDynamicOrderParams(null);
        }

        try {
            await waitForElement('#batch-stock__table', 10000, 100);
        } catch (error) {
             console.error("❌ 未找到 DataTables 元素，無法啟用清空監聽器。");
             return;
        }
        const dataTable = $('#batch-stock__table').DataTable();

        // --- 1 & 2. 注入 UI 設置及按鈕事件 ---
        const customContainer = document.createElement("div");
        Object.assign(customContainer.style, {
            position: 'fixed', top: '100px', left: '50%', transform: 'translateX(-50%)',
            zIndex: '99999', padding: '10px', backgroundColor: '#fff', border: '2px solid #333',
            boxShadow: '0 4px 8px rgba(0,0,0,0.1)', display: 'flex', flexDirection: 'row',
            alignItems: 'center', gap: '15px'
        });
        document.body.appendChild(customContainer);

        const fileInput = document.createElement("input");
        fileInput.type = "file"; fileInput.accept = ".xml"; fileInput.style.display = "none";
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
        infoContainer.innerHTML = `身份資訊：<b>${DYNAMIC_PARAMS.user_name || '未取得'}</b><br>帳號：<b>${DYNAMIC_PARAMS.account || '未取得'}</b>`;
        Object.assign(infoContainer.style, { fontSize: '12px', lineHeight: '1.3', padding: '0 5px' });
        customContainer.appendChild(infoContainer);

        // --- 點擊事件 ---
        mainButton.addEventListener('click', () => { fileInput.click(); });

        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (!file) return;

            if (!DYNAMIC_PARAMS.token || !DYNAMIC_PARAMS.account) {
                 alert("❌ 錯誤：Token/帳號資訊未獲取，請檢查登入狀態。");
                 return;
            }

            mainButton.disabled = true;
            mainButton.innerText = "⚙️ 讀取檔案中...";

            const reader = new FileReader();

            reader.onload = (e) => {
                processInjection(e.target.result)
                    .catch((error) => {
                        console.error("XML 注入過程中發生錯誤:", error);
                        alert(`❌ XML 注入失敗！請檢查 Console 或檔案格式。錯誤: ${error.message}`);
                    })
                    .finally(() => {
                        mainButton.disabled = false;
                        mainButton.innerText = "📂 匯入 XML 批次委託檔 (.xml)";
                        fileInput.value = '';
                    });
            };
            reader.readAsText(file);
        });

        // --- 3. 提交清理監聽器 (同步清空邏輯) ---
        const submitButton = document.querySelector('.btn__submit__select');
        if (submitButton) {
            submitButton.addEventListener('click', async () => {
                // 1. 等待原網站的送出處理完成
                await sleep(1500);

                // 2. 優先清空前端框架的數據模型
                const isSynced = clearSyncedData();

                // 3. 其次，清空 DataTables (DataTables 是視覺保證)
                if (dataTable.rows().count() > 0) {
                     if (!isSynced) console.log("🧹 DataTables 正在手動清理...");
                     dataTable.clear().draw();
                }

                if (isSynced) {
                     console.log("✅ DataTables 和前端數據模型已同步清空。");
                }
            });
            console.log("✅ '選取送出' 按鈕的 DataTables 清理監聽器已啟用。");
        }
    }

    // 執行腳本初始化
    initializeScript();
})();
