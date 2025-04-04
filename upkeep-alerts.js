// ==UserScript==
// @name         Upkeep Alerts
// @namespace    http://tampermonkey.net/
// @version      2025-04-04.5
// @description  Helps manage shared Private Island upkeep on Torn.com with telemetry, notifications, API integration, and payment detection.
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

    // --- Check Events for Upkeep Payment ---
    async function checkPaymentHistory(apiToken) {
        try {
            const response = await fetch(`https://api.torn.com/user/?selections=events&key=${apiToken}`);
            const data = await response.json();
            if (data.error) throw new Error(`API error: ${data.error.error}`);

            const events = data.events || {};
            const today = new Date().toISOString().split('T')[0];
            let paymentFound = false;

            for (const event of Object.values(events)) {
                const eventDate = new Date(event.timestamp * 1000).toISOString().split('T')[0];
                if (eventDate === today && event.event.includes('upkeep') && event.event.includes('Private Island')) {
                    paymentFound = true;
                    GM_setValue('lastPaymentDate', today);
                    return { paid: true, date: today };
                }
            }

            return { paid: paymentFound, date: lastPaymentDate };
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
            return false; // If you paid today, it’s the other player’s turn
        }
        if (lastPaymentDate) {
            const today = new Date();
            const lastPaid = new Date(lastPaymentDate);
            const diffDays = Math.floor((today - lastPaid) / (1000 * 60 * 60 * 24));
            return diffDays % 2 === 1; // Odd days after payment = your turn
        }
        return isMyTurnFallback(); // Fallback if no payment history
    }

    // --- Schedule Notification with Fallback ---
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
            if (myTurn) {
                if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
                    new Notification(`It’s your turn to pay $${upkeepCost.toLocaleString()} for PI upkeep today!`);
                } else {
                    const resultSpan = document.getElementById('Result');
                    if (resultSpan) {
                        resultSpan.textContent = 'It’s your turn to pay! (Notifications unavailable)';
                        resultSpan.style.color = 'yellow';
                    }
                }
            }
            scheduleNotification();
        }, timeUntil);
    }

    // --- Request Notification Permission with Fallback ---
    if (typeof Notification !== 'undefined') {
        if (Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission().catch(err => {
                console.error('Notification permission request failed:', err);
            });
        }
    } else {
        console.warn('Notification API not supported in this browser.');
    }

    // --- Add Styles ---
    GM_addStyle(`
        .telemetry-panel {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #1e1e1e;
            color: #fff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
            z-index: 1000;
            width: 320px;
            max-height: 80vh;
            overflow-y: auto;
            display: none;
        }
        .telemetry-header {
            font-size: 18px;
            margin-bottom: 15px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .telemetry-content p {
            margin: 10px 0;
        }
        .telemetry-content button {
            color: var(--default-blue-color);
            cursor: pointer;
            background: none;
            border: none;
            padding: 5px;
            margin: 5px 0;
        }
        .turn-indicator {
            padding: 5px 10px;
            border-radius: 4px;
            font-weight: bold;
        }
        .my-turn { background: #4caf50; }
        .other-turn { background: #2196f3; }
        .settings-tab {
            margin-top: 15px;
            display: none;
        }
        .settings-tab input {
            width: 100%;
            padding: 8px;
            margin: 8px 0;
            border-radius: 4px;
            border: none;
            box-sizing: border-box;
        }
        .settings-tab button {
            color: var(--default-red-color);
            cursor: pointer;
            background: none;
            border: none;
            padding: 5px;
            margin: 5px 0;
        }
        .toggle-btn {
            cursor: pointer;
            color: #ff9800;
        }
        .result-span {
            font-size: 12px;
            font-weight: 100;
            display: block;
            margin-top: 10px;
        }
        .upkeep-button {
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
        if (document.querySelector('.upkeep-button')) {
            console.log("Upkeep button already exists, skipping creation.");
            return;
        }

        console.log("Initializing upkeep telemetry for Private Island...");

        // Add Button Under Navbar
        const navbarTarget = document.querySelector('div.content-title > h4') || document.body;
        const upkeepButton = document.createElement('button');
        upkeepButton.className = 'upkeep-button';
        upkeepButton.id = 'UpkeepButton';
        upkeepButton.textContent = 'Loading Upkeep...';
        navbarTarget.appendChild(upkeepButton);

        // Create Telemetry Panel
        const panel = document.createElement('div');
        panel.className = 'telemetry-panel';
        document.body.appendChild(panel);

        // Initial UI setup
        await updateUI();

        // Toggle Panel
        upkeepButton.addEventListener('click', () => {
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
        const upkeepButton = document.getElementById('UpkeepButton');
        const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
        upkeepButton.textContent = `Upkeep: $${upkeepCost.toLocaleString()} - ${statusText}`;

        const panel = document.querySelector('.telemetry-panel');
        panel.innerHTML = `
            <div class="telemetry-header">
                <span>Upkeep Telemetry</span>
                <span class="toggle-btn" id="toggleSettings">[Settings]</span>
            </div>
            <div class="telemetry-content">
                <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                <p><button id="Upkeep">Go to Properties</button></p>
                <p><strong>Whose Turn:</strong> <button id="OtherPlayer" class="turn-indicator ${myTurn ? 'my-turn' : 'other-turn'}">${myTurn ? 'You' : otherPlayer}</button></p>
                <p><strong>Last Payment:</strong> ${lastPaymentDate || 'Not detected'}</p>
                <span class="result-span" id="Result">Loading...</span>
            </div>
            <div class="settings-tab" id="settingsTab">
                <input type="text" id="apiKeyInput" placeholder="Enter API Key" value="${apiToken}">
                <button id="ResetKey">Reset API Key</button>
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

        // Make "Other Player" button editable
        const otherPlayerButton = document.getElementById('OtherPlayer');
        otherPlayerButton.addEventListener('click', () => {
            const newName = prompt("Enter the name of the other player:", otherPlayer);
            if (newName && newName.trim() !== '') {
                otherPlayer = newName.trim();
                GM_setValue('otherPlayer', otherPlayer);
                updateUI(); // Refresh UI to reflect the new name
            }
        });

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

        document.getElementById('ResetKey').addEventListener('click', () => {
            apiToken = DEFAULT_API_KEY;
            GM_setValue('tornApiToken', apiToken);
            localStorage.setItem('tornApiToken', apiToken);
            updateUI();
            promptForApiToken();
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
        const newApiToken = prompt("Please enter your Torn API token key (Full Access with 'Events' permission required):", DEFAULT_API_KEY);
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
        const upkeepButton = document.getElementById('UpkeepButton');
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
                resultSpan.textContent = 'Upkeep loaded from API.';
                resultSpan.style.color = 'green';
            } else {
                resultSpan.textContent = 'No PI found; using manual upkeep.';
                resultSpan.style.color = 'orange';
            }

            // Update button text after API call
            const myTurn = await isMyTurn(apiToken);
            const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
            upkeepButton.textContent = `Upkeep: $${upkeepCost.toLocaleString()} - ${statusText}`;
        } catch (error) {
            console.error('Error updating upkeep:', error);
            const myTurn = await isMyTurn(apiToken);
            const statusText = myTurn ? 'Your Turn' : `${otherPlayer}'s Turn`;
            upkeepButton.textContent = `Upkeep: $${upkeepCost.toLocaleString()} - ${statusText}`;
            resultSpan.textContent = error.message;
            resultSpan.style.color = 'red';
        }
    }

    // --- Initialize ---
    addButtonAndCheck();
})();