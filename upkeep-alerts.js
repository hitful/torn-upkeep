// ==UserScript==
// @name         Upkeep Alerts
// @namespace    https://github.com/hitful/torn-upkeep/tree/main
// @version      2025-04-04.16
// @description  Helps manage shared property upkeep on Torn.com using the Torn API v2 with minimal API calls.
// @author       Hitful (enhanced by Grok/xAI)
// @match        https://www.torn.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @updateURL    https://raw.githubusercontent.com/hitful/torn-upkeep/main/upkeep-alerts.js
// @downloadURL  https://raw.githubusercontent.com/hitful/torn-upkeep/main/upkeep-alerts.js
// @license      MIT
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // --- Configuration Defaults ---
    const DEFAULT_API_KEY = 'YOUR_API_KEY_HERE';
    const PROPERTIES_PAGE = 'https://www.torn.com/properties.php';
    const PROPERTY_ID = '4725716'; // Your Private Island ID
    const DEFAULT_UPKEEP_COST = 352500; // $352,500/day for current Private Island
    const NOTIFICATION_HOUR_OFFSET = 7; // Notify 7 hours before midnight UTC
    const API_CALL_TIME_OFFSET = 5 * 60 * 1000; // 5 minutes after midnight UTC

    // --- Load Stored Settings ---
    let apiToken = GM_getValue('tornApiToken', localStorage.getItem('tornApiToken') || DEFAULT_API_KEY);
    let startDate = GM_getValue('startDate', '2025-04-01');
    let otherPlayer = GM_getValue('otherPlayer', 'Occraz');
    let upkeepCost = GM_getValue('upkeepCost', DEFAULT_UPKEEP_COST);
    let lastPaymentDate = GM_getValue('lastPaymentDate', null);
    let panelVisible = GM_getValue('panelVisible', false);
    let playerMoney = GM_getValue('playerMoney', 0);
    let turnOverride = GM_getValue('turnOverride', null); // null, 'me', or 'other'
    let amountOwed = GM_getValue('amountOwed', 0); // Persistent amount owed
    let lastApiCallDate = GM_getValue('lastApiCallDate', null);

    // --- Utility Functions ---
    function waitForElement(selector, callback, timeout = 10000) {
        const start = Date.now();
        const interval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(interval);
                callback(element);
            } else if (Date.now() - start > timeout) {
                clearInterval(interval);
                console.error(`Timeout waiting for ${selector}`);
            }
        }, 100);
    }

    function getTornDay() {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }

    // --- Fetch Upkeep Data from Torn API v2 ---
    async function fetchUpkeepData(apiToken) {
        try {
            const response = await fetch(`https://api.torn.com/property/${PROPERTY_ID}?selections=&key=${apiToken}`);
            const data = await response.json();
            if (data.error) throw new Error(`API error: ${data.error.error}`);

            const property = data.property;
            if (!property) throw new Error('Property data not found');

            // Extract upkeep cost
            const detectedUpkeep = property.upkeep || DEFAULT_UPKEEP_COST;
            if (detectedUpkeep !== upkeepCost) {
                upkeepCost = detectedUpkeep;
                GM_setValue('upkeepCost', upkeepCost);
            }

            // Extract upkeep balance (amount owed)
            const upkeepBalance = property.upkeep_balance || 0;
            amountOwed = upkeepBalance;
            GM_setValue('amountOwed', amountOwed);

            // Extract last payment date from upkeep payments
            const payments = property.upkeep_payments || [];
            let latestPaymentDate = lastPaymentDate;
            let paidToday = false;
            const todayStr = getTornDay().toISOString().split('T')[0];

            if (payments.length > 0) {
                const latestPayment = payments[0]; // Most recent payment
                const paymentTimestamp = latestPayment.timestamp * 1000; // Convert to milliseconds
                const paymentDate = new Date(paymentTimestamp).toISOString().split('T')[0];
                latestPaymentDate = paymentDate;

                if (paymentDate === todayStr) {
                    paidToday = true;
                }
            }

            if (latestPaymentDate && latestPaymentDate !== lastPaymentDate) {
                lastPaymentDate = latestPaymentDate;
                GM_setValue('lastPaymentDate', lastPaymentDate);
            }

            // Fetch player money balance
            const userResponse = await fetch(`https://api.torn.com/user/?selections=basic&key=${apiToken}`);
            const userData = await userResponse.json();
            if (userData.error) throw new Error(`API error: ${userData.error.error}`);
            playerMoney = userData.money || 0;
            GM_setValue('playerMoney', playerMoney);

            // Update last API call date
            lastApiCallDate = todayStr;
            GM_setValue('lastApiCallDate', lastApiCallDate);

            return { paidToday, date: lastPaymentDate };
        } catch (error) {
            console.error('Error fetching upkeep data from API:', error);
            return { paidToday: false, date: lastPaymentDate };
        }
    }

    // --- Schedule API Call Once Per Day ---
    function scheduleApiCall() {
        const now = new Date();
        const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        const nextApiCallTime = new Date(nextMidnightUTC.getTime() + API_CALL_TIME_OFFSET); // 5 minutes after midnight
        const timeUntil = nextApiCallTime - now;

        setTimeout(async () => {
            if (apiToken && apiToken !== DEFAULT_API_KEY) {
                await fetchUpkeepData(apiToken);
                updateUI();
            }
            scheduleApiCall(); // Schedule the next call
        }, Math.max(timeUntil, 0));
    }

    // --- Determine Whose Turn ---
    async function isMyTurn() {
        const todayStr = getTornDay().toISOString().split('T')[0];
        const paidToday = lastPaymentDate === todayStr;

        if (paidToday) {
            return false; // You paid today, other player's turn tomorrow
        }
        if (lastPaymentDate) {
            const today = getTornDay();
            const lastPaid = new Date(lastPaymentDate);
            const diffDays = Math.floor((today - lastPaid) / (1000 * 60 * 60 * 24));
            return turnOverride ? turnOverride === 'me' : diffDays % 2 === 1; // Odd days after payment = your turn
        }
        const today = getTornDay();
        const start = new Date(startDate);
        const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        return turnOverride ? turnOverride === 'me' : diffDays % 2 === 0; // Even days = your turn
    }

    // --- Schedule Notification ---
    function scheduleNotification() {
        const now = new Date();
        const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
        const notifyTimeUTC = new Date(nextMidnightUTC.getTime() - (NOTIFICATION_HOUR_OFFSET * 60 * 60 * 1000));
        const timeUntil = notifyTimeUTC - now;

        setTimeout(async () => {
            const myTurn = await isMyTurn();
            if (myTurn && amountOwed > 0) {
                notifyUser(`It’s your turn to pay $${amountOwed.toLocaleString()} for upkeep! Due in ${NOTIFICATION_HOUR_OFFSET} hours.`);
            }
            scheduleNotification();
        }, Math.max(timeUntil, 0));
    }

    function notifyUser(message) {
        if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
            new Notification(message);
        } else {
            const resultSpan = document.getElementById('Result');
            if (resultSpan) resultSpan.textContent = message + ' (Notifications unavailable)';
        }
    }

    if (typeof Notification !== 'undefined' && Notification.permission === "default") {
        Notification.requestPermission().catch(err => console.error('Notification permission request failed:', err));
    }

    // --- Styles ---
    GM_addStyle(`
        .telemetry-panel { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #1e1e1e; color: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.3); font-family: Arial, sans-serif; z-index: 1000; width: 320px; max-height: 80vh; overflow-y: auto; }
        .telemetry-header { font-size: 18px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; }
        .telemetry-content p { margin: 10px 0; }
        .telemetry-content button, .settings-tab button { color: var(--default-blue-color); cursor: pointer; background: none; border: none; padding: 5px; margin: 5px 0; }
        .turn-indicator { padding: 5px 10px; border-radius: 4px; font-weight: bold; }
        .my-turn { background: #4caf50; }
        .other-turn { background: #2196f3; }
        .settings-tab { margin-top: 15px; display: none; }
        .settings-tab input, .settings-tab select { width: 100%; padding: 8px; margin: 8px 0; border-radius: 4px; border: none; box-sizing: border-box; }
        .toggle-btn { cursor: pointer; color: #ff9800; }
        .close-btn { cursor: pointer; color: #ff4444; }
        .save-btn { color: #4caf50; cursor: pointer; background: none; border: none; padding: 5px; margin: 5px 0; }
        .refresh-btn { color: #2196f3; cursor: pointer; background: none; border: none; padding: 5px; margin: 5px 0; }
        .result-span { font-size: 12px; font-weight: 100; display: block; margin-top: 10px; }
        .upkeep-button { color: var(--default-blue-color); cursor: pointer; margin-right: 10px; background: none; border: none; font-size: 14px; }
    `);

    function initialize() {
        waitForElement('div.content-title > h4', (navbarTarget) => {
            if (document.querySelector('.upkeep-button')) return;

            const upkeepButton = document.createElement('button');
            upkeepButton.className = 'upkeep-button';
            upkeepButton.id = 'UpkeepButton';
            upkeepButton.textContent = 'Loading Upkeep...';
            navbarTarget.appendChild(upkeepButton);

            const panel = document.createElement('div');
            panel.className = 'telemetry-panel';
            panel.style.display = panelVisible ? 'block' : 'none';
            document.body.appendChild(panel);

            upkeepButton.addEventListener('click', () => {
                panelVisible = !panelVisible;
                GM_setValue('panelVisible', panelVisible);
                panel.style.display = panelVisible ? 'block' : 'none';
            });

            updateUI();
            if (!apiToken || apiToken === DEFAULT_API_KEY) {
                promptForApiToken();
            } else {
                // Check if we need to fetch data now
                const todayStr = getTornDay().toISOString().split('T')[0];
                if (lastApiCallDate !== todayStr) {
                    fetchUpkeepData(apiToken).then(() => updateUI());
                }
            }
            scheduleApiCall();
            scheduleNotification();
        });
    }

    async function updateUI() {
        const myTurn = await isMyTurn();
        const upkeepButton = document.getElementById('UpkeepButton');
        if (upkeepButton) {
            const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
            upkeepButton.textContent = `Owed: $${amountOwed.toLocaleString()} - ${statusText}`;
        }

        const panel = document.querySelector('.telemetry-panel');
        if (!panel) return;

        panel.innerHTML = `
            <div class="telemetry-header">
                <span>Upkeep Telemetry</span>
                <div>
                    <span class="toggle-btn" id="toggleSettings">[Settings]</span>
                    <span class="close-btn" id="closePanel">[Close]</span>
                </div>
            </div>
            <div class="telemetry-content">
                <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                <p><button id="Upkeep">Go to Properties</button></p>
                <p><strong>Total Owed:</strong> $${amountOwed.toLocaleString()}</p>
                <p><strong>Daily Upkeep:</strong> $${upkeepCost.toLocaleString()}</p>
                <p><strong>Whose Turn:</strong> <button id="OtherPlayer" class="turn-indicator ${myTurn ? 'my-turn' : 'other-turn'}">${myTurn ? 'You' : otherPlayer}</button></p>
                <p><strong>Last Payment:</strong> ${lastPaymentDate || 'Not detected'}</p>
                <p><strong>Money Balance:</strong> $${playerMoney.toLocaleString()}</p>
                <p><button id="RefreshData" class="refresh-btn">[Refresh Data]</button></p>
                <span class="result-span" id="Result">${apiToken && apiToken !== DEFAULT_API_KEY ? 'API token found.' : 'No API token set.'}</span>
            </div>
            <div class="settings-tab" id="settingsTab">
                <input type="text" id="apiKeyInput" placeholder="Enter API Key" value="${apiToken}">
                <button id="ResetKey">Reset API Key</button>
                <input type="date" id="startDateInput" value="${startDate}">
                <input type="text" id="otherPlayerInput" placeholder="Other Player Name" value="${otherPlayer}">
                <input type="number" id="upkeepCostInput" placeholder="Daily Upkeep Cost" value="${upkeepCost}">
                <select id="turnOverrideInput">
                    <option value="" ${!turnOverride ? 'selected' : ''}>Auto (Day-Based)</option>
                    <option value="me" ${turnOverride === 'me' ? 'selected' : ''}>Force My Turn</option>
                    <option value="other" ${turnOverride === 'other' ? 'selected' : ''}>Force ${otherPlayer}'s Turn</option>
                </select>
                <button class="save-btn" id="saveSettings">Save Settings</button>
            </div>
        `;

        const resultSpan = document.getElementById('Result');
        if (resultSpan) {
            resultSpan.style.color = apiToken && apiToken !== DEFAULT_API_KEY ? 'green' : 'red';
        }

        document.getElementById('Upkeep').addEventListener('click', () => window.location.href = PROPERTIES_PAGE);
        document.getElementById('OtherPlayer').addEventListener('click', () => {
            const newName = prompt("Enter the name of the other player:", otherPlayer);
            if (newName && newName.trim()) {
                otherPlayer = newName.trim();
                updateUI();
            }
        });

        const toggleBtn = document.getElementById('toggleSettings');
        const settingsTab = document.getElementById('settingsTab');
        if (toggleBtn && settingsTab) {
            toggleBtn.addEventListener('click', () => {
                settingsTab.style.display = settingsTab.style.display === 'block' ? 'none' : 'block';
            });
        }

        document.getElementById('closePanel').addEventListener('click', () => {
            panelVisible = false;
            GM_setValue('panelVisible', panelVisible);
            panel.style.display = 'none';
        });

        document.getElementById('RefreshData').addEventListener('click', async () => {
            if (apiToken && apiToken !== DEFAULT_API_KEY) {
                resultSpan.textContent = 'Refreshing data...';
                await fetchUpkeepData(apiToken);
                updateUI();
                resultSpan.textContent = 'Data refreshed.';
            } else {
                resultSpan.textContent = 'No API token set.';
            }
        });

        document.getElementById('apiKeyInput').addEventListener('change', (e) => apiToken = e.target.value);
        document.getElementById('ResetKey').addEventListener('click', () => {
            apiToken = DEFAULT_API_KEY;
            updateUI();
            promptForApiToken();
        });
        document.getElementById('startDateInput').addEventListener('change', (e) => startDate = e.target.value);
        document.getElementById('otherPlayerInput').addEventListener('change', (e) => otherPlayer = e.target.value);
        document.getElementById('upkeepCostInput').addEventListener('change', (e) => {
            upkeepCost = parseInt(e.target.value) || DEFAULT_UPKEEP_COST;
            GM_setValue('upkeepCost', upkeepCost);
        });
        document.getElementById('turnOverrideInput').addEventListener('change', (e) => turnOverride = e.target.value || null);
        document.getElementById('saveSettings').addEventListener('click', () => {
            GM_setValue('tornApiToken', apiToken);
            localStorage.setItem('tornApiToken', apiToken);
            GM_setValue('startDate', startDate);
            GM_setValue('otherPlayer', otherPlayer);
            GM_setValue('upkeepCost', upkeepCost);
            GM_setValue('turnOverride', turnOverride);
            GM_setValue('amountOwed', amountOwed);
            if (resultSpan) resultSpan.textContent = 'Settings saved.';
            updateUI();
        });
    }

    function promptForApiToken() {
        const resultSpan = document.getElementById('Result');
        const newApiToken = prompt("Please enter your Torn API token (Full Access with 'Properties' permission required):", DEFAULT_API_KEY);
        if (newApiToken && newApiToken !== DEFAULT_API_KEY) {
            apiToken = newApiToken;
            GM_setValue('tornApiToken', apiToken);
            localStorage.setItem('tornApiToken', apiToken);
            if (resultSpan) resultSpan.textContent = 'API token updated.';
            fetchUpkeepData(apiToken).then(() => updateUI());
        } else if (resultSpan) {
            resultSpan.textContent = 'Invalid or no API token provided.';
        }
    }

    initialize();
})();
