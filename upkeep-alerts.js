// ==UserScript==
// @name         Upkeep Alerts
// @namespace    https://github.com/hitful/torn-upkeep/tree/main
// @version      2025-04-04.14
// @description  Helps manage shared property upkeep on Torn.com with accurate balance tracking using the upkeep table.
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
    const CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour
    const DEFAULT_API_KEY = 'YOUR_API_KEY_HERE';
    const PROPERTIES_PAGE = 'https://www.torn.com/properties.php';
    const UPKEEP_TAB_URL = 'https://www.torn.com/properties.php#/p=options&ID=4725716&tab=upkeep';
    const DEFAULT_UPKEEP_COST = 352500; // $352,500/day for current Private Island
    const NOTIFICATION_HOUR_OFFSET = 7; // Notify 7 hours before midnight UTC

    // --- Load Stored Settings ---
    let apiToken = GM_getValue('tornApiToken', localStorage.getItem('tornApiToken') || DEFAULT_API_KEY);
    let startDate = GM_getValue('startDate', '2025-04-01');
    let otherPlayer = GM_getValue('otherPlayer', 'Occraz');
    let upkeepCost = GM_getValue('upkeepCost', DEFAULT_UPKEEP_COST);
    let lastPaymentDate = GM_getValue('lastPaymentDate', null);
    let panelVisible = GM_getValue('panelVisible', false);
    let playerMoney = 0;
    let turnOverride = GM_getValue('turnOverride', null); // null, 'me', or 'other'
    let amountOwed = GM_getValue('amountOwed', 0); // Persistent amount owed

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

    // --- Scrape Upkeep Table ---
    async function scrapeUpkeepTable() {
        try {
            // Check if we're on the upkeep tab
            const isUpkeepTab = window.location.href.includes('tab=upkeep');
            let table;

            if (isUpkeepTab) {
                // Wait for the table to load on the current page
                table = await new Promise((resolve) => {
                    waitForElement('div.upkeep-payments-wrap table', (element) => resolve(element), 5000);
                });
            } else {
                // Fetch the upkeep tab page in the background
                const response = await fetch(UPKEEP_TAB_URL);
                const text = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                table = doc.querySelector('div.upkeep-payments-wrap table');
            }

            if (!table) throw new Error('Upkeep table not found');

            const rows = table.querySelectorAll('tbody > li');
            if (rows.length === 0) throw new Error('No upkeep payment rows found');

            // Get the first row (most recent payment)
            const firstRow = rows[0];
            const columns = firstRow.querySelectorAll('div');

            // Extract data
            const dateStr = columns[0].textContent.trim(); // e.g., "14:04:37"
            const user = columns[1].textContent.trim(); // e.g., "EPFE"
            const amountPaid = parseInt(columns[2].textContent.replace(/[^0-9]/g, '')); // e.g., "$352,500" -> 352500
            const upkeepBalance = parseInt(columns[3].textContent.replace(/[^0-9]/g, '')); // e.g., "$0" -> 0

            // Parse the date (assuming it's in Torn's format: HH:MM:SS on today or a past date)
            const today = getTornDay();
            const [hours, minutes, seconds] = dateStr.split(':').map(Number);
            const paymentDate = new Date(today);
            paymentDate.setUTCHours(hours, minutes, seconds);
            const paymentDateStr = paymentDate.toISOString().split('T')[0];

            // Update stored values
            lastPaymentDate = paymentDateStr;
            amountOwed = upkeepBalance;
            GM_setValue('lastPaymentDate', lastPaymentDate);
            GM_setValue('amountOwed', amountOwed);

            return { paidToday: paymentDateStr === today.toISOString().split('T')[0], date: lastPaymentDate, user };
        } catch (error) {
            console.error('Error scraping upkeep table:', error);
            return null;
        }
    }

    // --- Fallback: Check Events for Upkeep Payments (if table scrape fails) ---
    async function checkPaymentHistory(apiToken) {
        try {
            const response = await fetch(`https://api.torn.com/user/?selections=events&key=${apiToken}`);
            const data = await response.json();
            if (data.error) throw new Error(`API error: ${data.error.error}`);

            const events = data.events || {};
            const eventList = Object.values(events);
            let latestPaymentDate = lastPaymentDate;
            let paidToday = false;

            const todayStr = getTornDay().toISOString().split('T')[0];

            for (const event of eventList) {
                if (!event || !event.timestamp || !event.event) continue;

                const eventText = event.event.toLowerCase();
                const eventDate = new Date(event.timestamp * 1000).toISOString().split('T')[0];

                if (eventText.includes('upkeep') && eventText.includes(upkeepCost.toString())) {
                    if (!latestPaymentDate || eventDate > latestPaymentDate) {
                        latestPaymentDate = eventDate;
                    }
                    if (eventDate === todayStr) {
                        paidToday = true;
                    }
                }
            }

            if (latestPaymentDate && latestPaymentDate !== lastPaymentDate) {
                lastPaymentDate = latestPaymentDate;
                GM_setValue('lastPaymentDate', lastPaymentDate);
            }

            amountOwed = paidToday ? 0 : (amountOwed || upkeepCost);
            GM_setValue('amountOwed', amountOwed);
            return { paidToday, date: lastPaymentDate };
        } catch (error) {
            console.error('Error checking payment history:', error);
            return { paidToday: false, date: lastPaymentDate };
        }
    }

    // --- Determine Whose Turn ---
    async function isMyTurn(apiToken) {
        const tableData = await scrapeUpkeepTable();
        let payment;
        if (tableData) {
            payment = tableData;
        } else {
            payment = await checkPaymentHistory(apiToken); // Fallback to API if table scrape fails
        }

        if (payment.paidToday) {
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
            const myTurn = await isMyTurn(apiToken);
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
                updateUpkeep(apiToken);
                setInterval(() => updateUpkeep(apiToken), CHECK_INTERVAL);
            }
            scheduleNotification();
        });
    }

    async function updateUI() {
        const myTurn = await isMyTurn(apiToken);
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
            updateUpkeep(apiToken);
        });
    }

    function promptForApiToken() {
        const resultSpan = document.getElementById('Result');
        const newApiToken = prompt("Please enter your Torn API token (Full Access with 'Events' permission required):", DEFAULT_API_KEY);
        if (newApiToken && newApiToken !== DEFAULT_API_KEY) {
            apiToken = newApiToken;
            GM_setValue('tornApiToken', apiToken);
            localStorage.setItem('tornApiToken', apiToken);
            if (resultSpan) resultSpan.textContent = 'API token updated.';
            updateUpkeep(apiToken);
            setInterval(() => updateUpkeep(apiToken), CHECK_INTERVAL);
        } else if (resultSpan) {
            resultSpan.textContent = 'Invalid or no API token provided.';
        }
    }

    async function updateUpkeep(apiToken) {
        const upkeepButton = document.getElementById('UpkeepButton');
        const resultSpan = document.getElementById('Result');
        if (!upkeepButton || !resultSpan) return;

        upkeepButton.textContent = 'Loading Upkeep...';
        try {
            // First, try to scrape the table
            const tableData = await scrapeUpkeepTable();
            if (!tableData) {
                // Fallback to API if table scrape fails
                await checkPaymentHistory(apiToken);
            }

            // Fetch player money balance
            const userResponse = await fetch(`https://api.torn.com/user/?selections=basic,properties&key=${apiToken}`);
            const userData = await userResponse.json();
            if (userData.error) throw new Error(`API error: ${userData.error.error}`);

            playerMoney = userData.money || 0;
            const properties = userData.properties || {};
            let detectedUpkeep = null;

            for (const prop of Object.values(properties)) {
                if (prop.upkeep && prop.upkeep > 0) {
                    detectedUpkeep = prop.upkeep;
                    break;
                }
            }

            if (detectedUpkeep && detectedUpkeep !== upkeepCost) {
                upkeepCost = detectedUpkeep;
                GM_setValue('upkeepCost', upkeepCost);
            }

            const myTurn = await isMyTurn(apiToken);
            const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
            upkeepButton.textContent = `Owed: $${amountOwed.toLocaleString()} - ${statusText}`;
            resultSpan.textContent = tableData ? 'Upkeep loaded from table.' : 'Upkeep loaded from API (fallback).';
            resultSpan.style.color = 'green';
            updateUI();
        } catch (error) {
            console.error('Error updating upkeep:', error);
            const myTurn = await isMyTurn(apiToken);
            const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
            upkeepButton.textContent = `Owed: $${amountOwed.toLocaleString()} - ${statusText}`;
            resultSpan.textContent = error.message;
            resultSpan.style.color = 'red';
        }
    }

    initialize();
})();
