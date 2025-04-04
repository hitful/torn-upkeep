// ==UserScript==
// @name         Upkeep Alerts
// @namespace    http://tampermonkey.net/
// @version      2025-04-04
// @description  Helps manage shared Private Island upkeep on Torn.com with telemetry, notifications, and API integration for tornPDA.
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
    const DEFAULT_API_KEY = 'YOUR_API_KEY_HERE'; // Replace with your API key or leave for prompt
    const PROPERTIES_PAGE = 'https://www.torn.com/properties.php';
    const DEFAULT_UPKEEP_COST = 352500; // $352,500/day for shared PI
    const NOTIFICATION_TIME = "07:00"; // 07:00 AM PDT

    // --- Load Stored Settings ---
    let apiToken = GM_getValue('tornApiToken', localStorage.getItem('tornApiToken') || DEFAULT_API_KEY);
    let startDate = GM_getValue('startDate', '2025-04-01'); // Default start date
    let otherPlayer = GM_getValue('otherPlayer', 'Other Player');
    let upkeepCost = GM_getValue('upkeepCost', DEFAULT_UPKEEP_COST);

    // --- Calculate Whose Turn ---
    function isMyTurn() {
        const today = new Date();
        const start = new Date(startDate);
        const diffDays = Math.floor((today - start) / (1000 * 60 * 60 * 24));
        return diffDays % 2 === 0; // Even days = your turn, odd = other player's
    }

    // --- Schedule Notification ---
    function scheduleNotification() {
        const now = new Date();
        const [hours, minutes] = NOTIFICATION_TIME.split(":");
        let nextNotify = new Date(now);
        nextNotify.setHours(parseInt(hours), parseInt(minutes), 0, 0);

        if (now > nextNotify) {
            nextNotify.setDate(nextNotify.getDate() + 1); // Next day if past time
        }

        const timeUntil = nextNotify - now;
        setTimeout(() => {
            if (Notification.permission === "granted" && isMyTurn()) {
                new Notification(`It’s your turn to pay $${upkeepCost.toLocaleString()} for PI upkeep today!`);
            }
            scheduleNotification(); // Reschedule for next day
        }, timeUntil);
    }

    // --- Request Notification Permission ---
    if (Notification.permission !== "granted" && Notification.permission !== "denied") {
        Notification.requestPermission();
    }

    // --- Add Styles for Modern Telemetry UI ---
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
    `);

    // --- Main Function to Add UI and Check Upkeep ---
    function addButtonAndCheck() {
        if (document.querySelector('.telemetry-panel')) {
            console.log("Telemetry panel already exists, skipping creation.");
            return;
        }

        console.log("Initializing upkeep telemetry for Private Island...");

        const panel = document.createElement('div');
        panel.className = 'telemetry-panel';
        document.body.appendChild(panel);

        // Initial UI setup
        updateUI();

        // Check API token and prompt if needed
        if (!apiToken || apiToken === DEFAULT_API_KEY) {
            promptForApiToken();
        } else {
            updateUpkeep(apiToken);
            setInterval(() => updateUpkeep(apiToken), CHECK_INTERVAL);
        }

        scheduleNotification();
    }

    // --- Update UI with Telemetry Data ---
    function updateUI() {
        const myTurn = isMyTurn();
        const upkeepButtonText = upkeepCost ? `Upkeep: $${upkeepCost.toLocaleString()}` : 'Loading Upkeep...';
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

    // --- Fetch and Update Upkeep from API ---
    async function updateUpkeep(apiToken) {
        const upkeepButton = document.getElementById('Upkeep');
        const resultSpan = document.getElementById('Result');
        upkeepButton.textContent = 'Loading Upkeep...';

        try {
            // Step 1: Fetch player ID from current page or API
            let userId = new URLSearchParams(window.location.search).get('XID');
            if (!userId) {
                const userResponse = await fetch(`https://api.torn.com/user/?selections=basic&key=${apiToken}`);
                const userData = await userResponse.json();
                if (userData.error) throw new Error(`API error: ${userData.error.error}`);
                userId = userData.player_id;
            }

            // Step 2: Fetch property types to find "Private Island" ID
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

            // Step 3: Fetch player properties to get upkeep
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
                upkeepCost = upkeepValue; // Update stored value if API provides it
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

    // --- Initialize the Script ---
    addButtonAndCheck();
})();