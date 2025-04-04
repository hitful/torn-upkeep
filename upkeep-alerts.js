// ==UserScript==
// @name         Upkeep Alerts
// @namespace    http://tampermonkey.net/
// @version      2025-04-04.11
// @description  Helps manage shared Private Island upkeep on Torn.com with telemetry, notifications, API integration, payment detection, and live amount owed.
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
    const DEFAULT_UPKEEP_COST = 352500; // $352,500/day
    const NOTIFICATION_HOUR_OFFSET = 7; // Notify 7 hours before midnight UTC

    // --- Load Stored Settings ---
    let apiToken = GM_getValue('tornApiToken', localStorage.getItem('tornApiToken') || DEFAULT_API_KEY);
    let startDate = GM_getValue('startDate', '2025-04-01');
    let otherPlayer = GM_getValue('otherPlayer', 'Other Player');
    let upkeepCost = GM_getValue('upkeepCost', DEFAULT_UPKEEP_COST);
    let lastPaymentDate = GM_getValue('lastPaymentDate', null);
    let panelVisible = GM_getValue('panelVisible', false);
    let playerMoney = 0; // Store player's money balance
    let turnOverride = GM_getValue('turnOverride', null); // null, 'me', or 'other'
    let amountOwed = DEFAULT_UPKEEP_COST; // Live amount owed

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

    // --- Get Torn Day (UTC) ---
    function getTornDay() {
        const now = new Date();
        return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    }

    // --- Calculate Whose Turn Based on Torn Time ---
    function isMyTurnFallback() {
        if (turnOverride) {
            return turnOverride === 'me';
        }
        const today = getTornDay();
        const start = new Date(startDate);
        const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        return diffDays % 2 === 0; // Even days = your turn
    }

    // --- Check Events for Upkeep Payment ---
    async function checkPaymentHistory(apiToken) {
        try {
            const response = await fetch(`https://api.torn.com/user/?selections=events&key=${apiToken}`);
            const data = await response.json();
            if (data.error) throw new Error(`API error: ${data.error.error}`);

            const events = data.events || [];
            console.log('Events from API:', events); // Debug: Log the events

            const today = getTornDay().toISOString().split('T')[0];
            let paymentFound = false;
            let paymentDate = null;

            // Handle both array and object formats for events
            const eventList = Array.isArray(events) ? events : Object.values(events);

            for (const event of eventList) {
                if (!event || !event.timestamp || !event.event) continue;

                const eventDate = new Date(event.timestamp * 1000).toISOString().split('T')[0];
                const eventText = event.event.toLowerCase();
                console.log(`Event: ${eventText}, Date: ${eventDate}`); // Debug: Log each event

                // Check for upkeep payment of $352,500 or the current upkeep cost
                if (eventDate === today && 
                    (eventText.includes('upkeep') || eventText.includes('property')) && 
                    (eventText.includes(upkeepCost.toString()) || eventText.includes('private island'))) {
                    paymentFound = true;
                    paymentDate = today;
                    GM_setValue('lastPaymentDate', today);
                    break;
                }
            }

            // Update amount owed based on payment status
            amountOwed = paymentFound ? 0 : upkeepCost;
            return { paid: paymentFound, date: paymentDate || lastPaymentDate };
        } catch (error) {
            console.error('Error checking payment history:', error);
            return { paid: false, date: lastPaymentDate };
        }
    }

    // --- Determine Whose Turn ---
    async function isMyTurn(apiToken) {
        const payment = await checkPaymentHistory(apiToken);
        if (payment.paid) {
            lastPaymentDate = payment.date;
            return false; // You paid today, other player's turn
        }
        if (lastPaymentDate) {
            const today = getTornDay();
            const lastPaid = new Date(lastPaymentDate);
            const diffDays = Math.floor((today - lastPaid) / (1000 * 60 * 60 * 24));
            return turnOverride ? turnOverride === 'me' : diffDays % 2 === 1; // Odd days after payment = your turn
        }
        return isMyTurnFallback();
    }

    // --- Schedule Notification Tied to Torn Time ---
    function scheduleNotification() {
        const now = new Date();
        const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
        const notifyTimeUTC = new Date(nextMidnightUTC.getTime() - (NOTIFICATION_HOUR_OFFSET * 60 * 60 * 1000));

        const timeUntil = notifyTimeUTC - now;
        if (timeUntil < 0) {
            notifyTimeUTC.setUTCDate(notifyTimeUTC.getUTCDate() + 1);
        }

        setTimeout(async () => {
            const myTurn = await isMyTurn(apiToken);
            if (myTurn && amountOwed > 0) {
                const localNotifyTime = new Date(notifyTimeUTC).toLocaleTimeString();
                notifyUser(`It’s your turn to pay $${amountOwed.toLocaleString()} for PI upkeep today! Notification set for ${localNotifyTime}.`);
            }
            scheduleNotification();
        }, Math.max(notifyTimeUTC - new Date(), 0));
    }

    // --- Notify User with Fallback ---
    function notifyUser(message) {
        if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
            new Notification(message);
        } else {
            const resultSpan = document.getElementById('Result');
            if (resultSpan) {
                resultSpan.textContent = message + ' (Notifications unavailable)';
                resultSpan.style.color = 'yellow';
            }
        }
    }

    // --- Request Notification Permission ---
    if (typeof Notification !== 'undefined' && Notification.permission === "default") {
        Notification.requestPermission().catch(err => console.error('Notification permission request failed:', err));
    }

    // --- Add Styles ---
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

    // --- Main Function ---
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

    // --- Update UI ---
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
                <p><strong>Amount Owed:</strong> $${amountOwed.toLocaleString()}</p>
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
                <input type="number" id="upkeepCostInput" placeholder="Upkeep Cost" value="${upkeepCost}">
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

        const upkeepButtonLink = document.getElementById('Upkeep');
        if (upkeepButtonLink) {
            upkeepButtonLink.addEventListener('click', () => window.location.href = PROPERTIES_PAGE);
        }

        const otherPlayerButton = document.getElementById('OtherPlayer');
        if (otherPlayerButton) {
            otherPlayerButton.addEventListener('click', () => {
                const newName = prompt("Enter the name of the other player:", otherPlayer);
                if (newName && newName.trim()) {
                    otherPlayer = newName.trim();
                    updateUI();
                }
            });
        }

        const toggleBtn = document.getElementById('toggleSettings');
        const settingsTab = document.getElementById('settingsTab');
        if (toggleBtn && settingsTab) {
            toggleBtn.addEventListener('click', () => {
                settingsTab.style.display = settingsTab.style.display === 'block' ? 'none' : 'block';
            });
        }

        const closeBtn = document.getElementById('closePanel');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                panel.style.display = 'none'; // Close without toggling panelVisible
            });
        }

        const apiKeyInput = document.getElementById('apiKeyInput');
        if (apiKeyInput) {
            apiKeyInput.addEventListener('change', (e) => {
                apiToken = e.target.value;
            });
        }

        const resetKeyButton = document.getElementById('ResetKey');
        if (resetKeyButton) {
            resetKeyButton.addEventListener('click', () => {
                apiToken = DEFAULT_API_KEY;
                updateUI();
                promptForApiToken();
            });
        }

        const startDateInput = document.getElementById('startDateInput');
        if (startDateInput) {
            startDateInput.addEventListener('change', (e) => {
                startDate = e.target.value;
            });
        }

        const otherPlayerInput = document.getElementById('otherPlayerInput');
        if (otherPlayerInput) {
            otherPlayerInput.addEventListener('change', (e) => {
                otherPlayer = e.target.value;
            });
        }

        const upkeepCostInput = document.getElementById('upkeepCostInput');
        if (upkeepCostInput) {
            upkeepCostInput.addEventListener('change', (e) => {
                upkeepCost = parseInt(e.target.value) || DEFAULT_UPKEEP_COST;
            });
        }

        const turnOverrideInput = document.getElementById('turnOverrideInput');
        if (turnOverrideInput) {
            turnOverrideInput.addEventListener('change', (e) => {
                turnOverride = e.target.value || null;
            });
        }

        const saveSettingsButton = document.getElementById('saveSettings');
        if (saveSettingsButton) {
            saveSettingsButton.addEventListener('click', () => {
                GM_setValue('tornApiToken', apiToken);
                localStorage.setItem('tornApiToken', apiToken);
                GM_setValue('startDate', startDate);
                GM_setValue('otherPlayer', otherPlayer);
                GM_setValue('upkeepCost', upkeepCost);
                GM_setValue('turnOverride', turnOverride);
                if (resultSpan) {
                    resultSpan.textContent = 'Settings saved.';
                    resultSpan.style.color = 'green';
                }
                updateUI();
                updateUpkeep(apiToken);
            });
        }
    }

    // --- Prompt for API Token ---
    function promptForApiToken() {
        const resultSpan = document.getElementById('Result');
        const newApiToken = prompt("Please enter your Torn API token (Full Access with 'Events' permission required):", DEFAULT_API_KEY);
        if (newApiToken && newApiToken !== DEFAULT_API_KEY) {
            apiToken = newApiToken;
            GM_setValue('tornApiToken', apiToken);
            localStorage.setItem('tornApiToken', apiToken);
            if (resultSpan) {
                resultSpan.textContent = 'API token updated.';
                resultSpan.style.color = 'green';
            }
            updateUpkeep(apiToken);
            setInterval(() => updateUpkeep(apiToken), CHECK_INTERVAL);
        } else if (resultSpan) {
            resultSpan.textContent = 'Invalid or no API token provided.';
            resultSpan.style.color = 'red';
        }
    }

    // --- Fetch and Update Upkeep ---
    async function updateUpkeep(apiToken) {
        const upkeepButton = document.getElementById('UpkeepButton');
        const resultSpan = document.getElementById('Result');
        if (!upkeepButton || !resultSpan) {
            console.error('Upkeep button or result span not found. Skipping update.');
            return;
        }
        upkeepButton.textContent = 'Loading Upkeep...';

        try {
            const userResponse = await fetch(`https://api.torn.com/user/?selections=basic,properties,events&key=${apiToken}`);
            const userData = await userResponse.json();
            if (userData.error) throw new Error(`API error: ${userData.error.error}`);

            // Fetch player money balance
            playerMoney = userData.money || 0;

            const userId = userData.player_id;
            const properties = userData.properties || {};
            let upkeepValue = null;
            for (const prop of Object.values(properties)) {
                if (prop.property_type === 10) { // Private Island type ID
                    upkeepValue = prop.upkeep;
                    break;
                }
            }

            if (upkeepValue !== null) {
                upkeepCost = upkeepValue;
                GM_setValue('upkeepCost', upkeepCost);
                resultSpan.textContent = 'Upkeep loaded from API.';
                resultSpan.style.color = 'green';
            } else {
                resultSpan.textContent = 'No PI found; using manual upkeep.';
                resultSpan.style.color = 'orange';
            }

            const myTurn = await isMyTurn(apiToken);
            const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
            upkeepButton.textContent = `Owed: $${amountOwed.toLocaleString()} - ${statusText}`;
            updateUI(); // Refresh UI to show updated balance
        } catch (error) {
            console.error('Error updating upkeep:', error);
            const myTurn = await isMyTurn(apiToken);
            const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
            upkeepButton.textContent = `Owed: $${amountOwed.toLocaleString()} - ${statusText}`;
            resultSpan.textContent = error.message;
            resultSpan.style.color = 'red';
        }
    }

    // --- Initialize ---
    initialize();
})();