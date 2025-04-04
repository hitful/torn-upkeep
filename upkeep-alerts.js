// ==UserScript==
// @name         Upkeep Alerts
// @namespace    http://tampermonkey.net/
// @version      2025-04-04.1
// @description  Helps manage shared Private Island upkeep on Torn.com with telemetry, notifications, API integration, and payment detection for tornPDA.
// @author       Hitful (enhanced by Grok/xAI)
// @match        https://www.torn.com/*
// @match        https://tornpda.com/*
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
    const NOTIFICATION_TIME = "07:00"; // 07:00 AM PDT

    // --- Load Stored Settings ---
    let apiToken = GM_getValue('tornApiToken', localStorage.getItem('tornApiToken') || DEFAULT_API_KEY);
    let startDate = GM_getValue('startDate', '2025-04-01');
    let otherPlayer = GM_getValue('otherPlayer', 'Other Player');
    let upkeepCost = GM_getValue('upkeepCost', DEFAULT_UPKEEP_COST);
    let lastPaymentDate = GM_getValue('lastPaymentDate', null);

    // --- Calculate Whose Turn (Fallback) ---
    function isMyTurnFallback() {
        const today = new Date();
        const start = new Date(startDate);
        const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        return diffDays % 2 === 0; // Even days = your turn, odd = other player's
    }

    // --- Check Financial History for Payment ---
    async function checkPaymentHistory(apiToken) {
        try {
            const response = await fetch(`https://api.torn.com/user/?selections=personalstats&key=${apiToken}`);
            const data = await response.json();
            if (data.error) throw new Error(`API error: ${data.error.error}`);

            const moneyOut = data.personalstats.moneyout || 0;
            const lastCheck = GM_getValue('lastMoneyOut', 0);

            if (moneyOut > lastCheck) {
                const diff = moneyOut - lastCheck;
                if (diff === upkeepCost) {
                    const now = new Date().toISOString().split('T')[0];
                    GM_setValue('lastPaymentDate', now);
                    GM_setValue('lastMoneyOut', moneyOut);
                    return { paid: true, date: now };
                }
            }
            GM_setValue('lastMoneyOut', moneyOut);
            return { paid: false, date: lastPaymentDate };
        } catch (error) {
            console.error('Error checking payment history:', error);
            return { paid: false, date: lastPaymentDate };
        }
    }

    // --- Determine Whose Turn Based on Payment ---
    async function isMyTurn(apiToken) {
        const payment = await checkPaymentHistory(apiToken);
        if (payment.paid) {
            lastPaymentDate = payment.date;
            return false; // If you just paid, it’s the other player’s turn next
        }
        if (lastPaymentDate) {
            const today = new Date();
            const lastPaid = new Date(lastPaymentDate);
            const diffDays = Math.floor((today - lastPaid) / (1000 * 60 * 60 * 24));
            return diffDays % 2 === 1; // Odd days after payment = your turn
        }
        return isMyTurnFallback(); // Fallback if no payment history
    }

    // --- Schedule Notification ---
    function scheduleNotification() {
        const now = new Date();
        const [hours, minutes] = NOTIFICATION_TIME.split(":");
        let nextNotify = new Date(now);
        nextNotify.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        if (now > nextNotify) {
            nextNotify.setDate(nextNotify.getDate() + 1);
        }

        const timeUntil = nextNotify - now;
        setTimeout(async () => {
            const myTurn = await isMyTurn(apiToken);
            if (Notification.permission === "granted" && myTurn) {
                new Notification(`It’s your turn to pay $${upkeepCost.toLocaleString()} for PI upkeep today!`);
            }
            scheduleNotification();
        }, timeUntil);
    }

    // --- Request Notification Permission ---
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // --- Add Styles ---
    GM_addStyle(`
        .telemetry-panel {
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: #1e1e1e;
            color: #fff;
            padding: 15px;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
            z-index: 1000;
            width: 300px;
            max-height: 80vh;
            overflow-y: auto;
            display: none;
        }
        .telemetry-header {
            font-size: 18px;
            margin-bottom: 10px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .telemetry-content button {
            color: var(--default-blue-color);
            cursor: pointer;
            background: none;
            border: none;
            padding: 5px;
        }
        .telemetry-content button#ResetKey {
            color: var(--default-red-color);
        }
        .turn-indicator {
            padding: 5px 10px;
            border-radius: 4px;
            font-weight: bold;
        }
        .my-turn { background: #4caf50; }
        .other-turn { background: #2196f3; }
        .settings-tab {
            margin-top: 10px;
            display: none;
        }
        .settings-tab input {
            width: 100%;
            padding: 5px;
            margin: 5px 0;
            border-radius: 4px;
            border: none;
        }
        .toggle-btn {
            cursor: pointer;
            color: #ff9800;
        }
        .result-span {
            font-size: 12px;
            font-weight: 100;
            display: block;
            margin-top: 5px;
        }
        .navbar-btn {
            color: var(--default-blue-color);
            cursor: pointer;
            margin-right: 10px;
            background: none;
            border: none;
            font-size: 14px;
        }
    `);

    // --- Main Function ---
    async function addButtonAndCheck() {
        if (document.querySelector('.navbar-btn')) {
            console.log("Navbar button already exists, skipping creation.");
            return;
        }

        console.log("Initializing upkeep telemetry for Private Island...");

        // Add Toggle Button Under Navbar
        const navbarTarget = document.querySelector('div.content-title > h4') || document.body;
        const toggleButton = document.createElement('button');
        toggleButton.className = 'navbar-btn';
        toggleButton.id = 'ToggleTelemetry';
        toggleButton.textContent = 'Upkeep Telemetry';
        navbarTarget.appendChild(toggleButton);

        // Create Telemetry Panel
        const panel = document.createElement('div');
        panel.className = 'telemetry-panel';
        document.body.appendChild(panel);

        // Initial UI setup
        await updateUI();

        // Toggle Panel
        toggleButton.addEventListener('click', () => {
            panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
        });

        // Check API token
        if (!apiToken || apiToken === DEFAULT_API_KEY) {
            promptForApiToken();
        } else {
            updateUpkeep(apiToken);
            setInterval(() => updateUpkeep(apiToken), CHECK_INTERVAL);
        }

        scheduleNotification();
    }

    // --- Update UI ---
    async function updateUI() {
        const myTurn = await isMyTurn(apiToken);
        const upkeepButtonText = upkeepCost ? `Upkeep: $${upkeepCost.toLocaleString()}` : 'Loading Upkeep...';
        const panel = document.querySelector('.telemetry-panel');
        panel.innerHTML = `
            <div class="telemetry-header">
                <span>Upkeep Telemetry</span>
                <span class="toggle-btn" id="toggleSettings">[Settings]</span>
            </div>
            <div class="telemetry-content">
                <p>Date: ${new Date().toLocaleDateString()}</p>
                <button id="Upkeep">${upkeepButtonText}</button>
                <button id="ResetKey">Reset API Key</button>
                <p>Whose Turn: <span class="turn-indicator ${myTurn ? 'my-turn' : 'other-turn'}">${myTurn ? 'You' : otherPlayer}</span></p>
                <p>Last Payment: ${lastPaymentDate || 'Not detected'}</p>
                <span class="result-span" id="Result">Loading...</span>
            </div>
            <div class="settings-tab" id="settingsTab">
                <input type="text" id="apiKeyInput" placeholder="Enter API Key" value="${apiToken}">
                <input type="date" id="startDateInput" value="${startDate}">
                <input type="text" id="otherPlayerInput" placeholder="Other Player Name" value="${otherPlayer}">
                <input type="number" id="upkeepCostInput" placeholder="Upkeep Cost" value="${upkeepCost}">
            </div>
        `;

        const resultSpan = document.getElementById('Result');
        resultSpan.textContent = apiToken && apiToken !== DEFAULT_API_KEY ? 'API token found.' : 'No API token set.';
        resultSpan.style.color = apiToken && apiToken !== DEFAULT_API_KEY ? 'green' : 'red';

        // Event Listeners
        document.getElementById('Upkeep').addEventListener('click', () => {
            window.location.href = PROPERTIES_PAGE;
        });
        document.getElementById('ResetKey').addEventListener('click', promptForApiToken);

        const toggleBtn = document.getElementById('toggleSettings');
        const settingsTab = document.getElementById('settingsTab');
        toggleBtn.addEventListener('click', () => {
            settingsTab.style.display = settingsTab.style.display === 'block' ? 'none' : 'block';
        });

        // Settings Inputs
        document.getElementById('apiKeyInput').addEventListener('change', (e) => {
            apiToken = e.target.value;
            GM_setValue('tornApiToken', apiToken);
            localStorage.setItem('tornApiToken', apiToken);
            updateUI();
            updateUpkeep(apiToken);
        });
        document.getElementById('startDateInput').addEventListener('change', (e) => {
            startDate = e.target.value;
            GM_setValue('startDate', startDate);
            updateUI();
        });
        document.getElementById('otherPlayerInput').addEventListener('change', (e) => {
            otherPlayer = e.target.value;
            GM_setValue('otherPlayer', otherPlayer);
            updateUI();
        });
        document.getElementById('upkeepCostInput').addEventListener('change', (e) => {
            upkeepCost = parseInt(e.target.value) || DEFAULT_UPKEEP_COST;
            GM_setValue('upkeepCost', upkeepCost);
            updateUI();
        });
    }

    // --- Prompt for API Token ---
    function promptForApiToken() {
        const resultSpan = document.getElementById('Result');
        const newApiToken = prompt("Please enter your Torn API token key:", DEFAULT_API_KEY);
        if (newApiToken && newApiToken !== DEFAULT_API_KEY) {
            apiToken = newApiToken;
            GM_setValue('tornApiToken', apiToken);
            localStorage.setItem('tornApiToken', apiToken);
            resultSpan.textContent = 'API token updated.';
            resultSpan.style.color = 'green';
            updateUpkeep(apiToken);
            setInterval(() => updateUpkeep(apiToken), CHECK_INTERVAL);
        } else {
            resultSpan.textContent = 'No valid API token provided.';
            resultSpan.style.color = 'red';
            console.error('No valid API token provided.');
        }
    }

    // --- Fetch and Update Upkeep ---
    async function updateUpkeep(apiToken) {
        const upkeepButton = document.getElementById('Upkeep');
        const resultSpan = document.getElementById('Result');
        upkeepButton.textContent = 'Loading Upkeep...';

        try {
            // Fetch player ID
            let userId = new URLSearchParams(window.location.search).get('XID');
            if (!userId) {
                const userResponse = await fetch(`https://api.torn.com/user/?selections=basic&key=${apiToken}`);
                const userData = await userResponse.json();
                if (userData.error) throw new Error(`API error: ${userData.error.error}`);
                userId = userData.player_id;
            }

            // Fetch property types
            const propTypesResponse = await fetch(`https://api.torn.com/properties?key=${apiToken}`);
            const propTypesData = await propTypesResponse.json();
            if (propTypesData.error) throw new Error(`API error: ${propTypesData.error.error}`);

            let privateIslandId = null;
            for (const [id, prop] of Object.entries(propTypesData.properties)) {
                if (prop.property_type_name === 'Private Island') {
                    privateIslandId = id;
                    break;
                }
            }
            if (!privateIslandId) throw new Error('Private Island property type not found.');

            // Fetch player properties
            const playerResponse = await fetch(`https://api.torn.com/user/${userId}?selections=properties&key=${apiToken}`);
            const playerData = await playerResponse.json();
            if (playerData.error) throw new Error(`API error: ${playerData.error.error}`);

            const properties = playerData.properties;
            let upkeepValue = null;
            for (const prop of Object.values(properties)) {
                if (String(prop.property_type) === String(privateIslandId)) {
                    upkeepValue = prop.upkeep;
                    break;
                }
            }

            if (upkeepValue !== null) {
                upkeepCost = upkeepValue;
                GM_setValue('upkeepCost', upkeepCost);
                upkeepButton.textContent = `Upkeep: $${upkeepCost.toLocaleString()}`;
                resultSpan.textContent = 'Upkeep loaded from API.';
                resultSpan.style.color = 'green';
            } else {
                upkeepButton.textContent = `Upkeep: $${upkeepCost.toLocaleString()}`;
                resultSpan.textContent = 'No PI found; using manual upkeep.';
                resultSpan.style.color = 'orange';
            }
        } catch (error) {
            console.error('Error updating upkeep:', error);
            upkeepButton.textContent = `Upkeep: $${upkeepCost.toLocaleString()}`;
            resultSpan.textContent = error.message;
            resultSpan.style.color = 'red';
        }
    }

    // --- Initialize ---
    addButtonAndCheck();
})();