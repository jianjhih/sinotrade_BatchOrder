// ==UserScript==
// @name         自動下單零股 (V4.0.1 - XML 批次委託注入 - 自動勾選)
// @namespace    https://github.com/jianjhih/sinotrade_BatchOrder/workspaces/sinotrade_BatchOrder/SinotradeBatchHelper.js
// @description  讀取 MDJ/XML 批次委託檔案，解析數據後注入到永豐金證券網頁 DataTables。
// @author       jianjhih
// @match        https://www.sinotrade.com.tw/inside/Batch_Order
// @icon         https://www.sinotrade.com.tw/newweb/images/icons/512.png
// @grant        none
// @license      MIT
// @homepage     https://github.com/jianjhih/sinotrade_BatchOrder
// ==/UserScript==

(function () {
    'use strict';

    console.log("🚀 程式夥伴：零股 JSON 注入腳本 V4.0.1 載入成功！ (自動勾選)");

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ====================================================================
    // A. 動態參數獲取函式 (略)
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

    // ====================================================================
    // B. XML 模式映射與轉換邏輯 (略)
    // ====================================================================

    function getModeMappingFromXML(stockId, vol) {
        const isOddLot = (stockId.toLowerCase().includes('.tw') && vol < 1000) || vol < 1000;

        if (isOddLot) {
            return { ord_type: 'C', session: 'C', market_id: 'S', isWholeShare: false, finalQty: vol };
        } else {
             // 整股：直接注入張數，讓前端轉換為股數
             const sharesPerLot = 1000;
             const lots = Math.floor(vol / sharesPerLot);
             return { ord_type: '0', session: '0', market_id: 'S', isWholeShare: true, finalQty: lots };
        }
    }


    // ------------------------------------------
    // C. 核心 XML 解析與注入
    // ------------------------------------------

    async function processInjection(fileContent) {
        // 檢查環境
        if (typeof $ === 'undefined' || typeof $.fn.DataTable === 'undefined') {
             throw new Error("DataTables 或 jQuery 函式庫尚未載入。");
        }
        const dataTable = $('#batch-stock__table').DataTable();

        // 1. 解析 XML 內容
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(fileContent, "application/xml");
        const ordersXML = xmlDoc.getElementsByTagName('Order');

        if (ordersXML.length === 0) {
            alert("XML 檔案中未找到 <Order> 標籤！請檢查檔案格式是否正確。");
            return;
        }

        const DYNAMIC_PARAMS = getDynamicOrderParams(document.querySelector('.dropdown.account__select option'));

        const ORDER_TEMPLATE = {
            ...DYNAMIC_PARAMS,
            "market_id": "S", "ord_bs": "B", "ord_cond": "0", "ord_type": "C",
            "price_type": " ", "session": "C", "time_in_force": "0", "isSelected": true,
            "stock_id": null, "product_name": null, "ord_price": null, "ord_qty": null,
        };

        let injectedCount = 0;
        let invalidCount = 0;
        console.log(`--- 開始注入 ${ordersXML.length} 筆 XML 訂單 ---`);

        // 2. 遍歷並轉換 XML 訂單
        for (let i = 0; i < ordersXML.length; i++) {
            const orderNode = ordersXML[i];

            const stockIdFull = orderNode.getAttribute('ID');
            const stockId = stockIdFull.replace(/\.TW/i, '');
            const price = parseFloat(orderNode.getAttribute('Price'));
            const vol = parseInt(orderNode.getAttribute('Vol'));
            const bs = orderNode.getAttribute('BS');

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

                dataTable.row.add(newOrder).draw(false);
                injectedCount++;
            } else {
                 console.warn(`⚠️ 跳過無效 XML 訂單 (ID: ${stockIdFull}, Price: ${price}, Vol: ${vol})`);
                 invalidCount++;
            }
        }

        // 3. 模擬點擊強制刷新並確保全選
        const checkAllSelector = '#stock__check__all-row';
        const checkAllElement = document.querySelector(checkAllSelector);

        if (checkAllElement) {
            // 步驟 A: 強制 DataTables 刷新並識別新行 (先點擊一次)
            checkAllElement.click();
            await sleep(50);

            // 步驟 B: 確保全選框處於未選中狀態，以便下一步點擊可以選中所有新行
            // 由於 DataTables 刷新後的預設行為不確定，我們保險起見再點擊一次來確保它是最終狀態。
            checkAllElement.click();
            await sleep(50);

            // 🌟 核心修正：檢查並確保最終狀態是勾選 (如果不是勾選，就再點一次)
            // 檢查 input[type="checkbox"] 的屬性
            const isChecked = checkAllElement.checked;

            if (!isChecked) {
                 checkAllElement.click();
                 console.log("✅ 程式夥伴：強制點擊「全選」按鈕，確保所有新注入項目被選中。");
            } else {
                 console.log("✅ 程式夥伴：注入後「全選」按鈕已處於勾選狀態。");
            }

        } else {
            console.warn("⚠️ 找不到「全選」按鈕元素，無法執行自動勾選。");
        }

        console.log("✅ XML 數據注入完成！");
        alert(`成功注入 ${injectedCount} 筆訂單！(XML 格式)`);
    }

    // ------------------------------------------
    // D. UI/初始化 (略)
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
            mainButton.innerText = "⚙️ 正在讀取並解析 XML...";

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
    }

    // 執行腳本初始化
    initializeScript();
})();