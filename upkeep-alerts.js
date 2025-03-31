// ==UserScript==
// @name         Upkeep Alerts
// @namespace    http://tampermonkey.net/
// @version      2025-03-31
// @description  Helps manage upkeep for Private Island on Torn.com
// @author       Hitful
// @match        https://www.torn.com/*
// @icon         data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==
// @grant        none
// @updateURL    https://raw.githubusercontent.com/hitful/torn-upkeep/main/upkeep-alerts.js
// @downloadURL  https://raw.githubusercontent.com/hitful/torn-upkeep/main/upkeep-alerts.js
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    const CHECK_INTERVAL = 60 * 60 * 1000; // Check every hour
    const DEFAULT_API_KEY = 'YOUR_API_KEY_HERE'; // Replace with your API key
    const PROPERTIES_PAGE = 'https://www.torn.com/properties.php';

    function addButtonAndCheck() {
        if (document.getElementById('Upkeep')) {
            console.log("Buttons already exist, skipping creation.");
            return;
        }

        console.log("Initializing upkeep monitor for Private Island...");

        const upkeepButton = document.createElement('button');
        upkeepButton.id = 'Upkeep';
        upkeepButton.style.color = 'var(--default-blue-color)';
        upkeepButton.style.cursor = 'pointer';
        upkeepButton.style.marginRight = '10px';
        upkeepButton.textContent = 'Loading Upkeep...';

        const resetButton = document.createElement('button');
        resetButton.id = 'ResetKey';
        resetButton.style.color = 'var(--default-red-color)';
        resetButton.style.cursor = 'pointer';
        resetButton.textContent = 'Reset API Key';

        const resultSpan = document.createElement('span');
        resultSpan.id = 'Result';
        resultSpan.style.fontSize = '12px';
        resultSpan.style.fontWeight = '100';

        const target = document.querySelector('div.content-title > h4') || document.body;
        target.appendChild(upkeepButton);
        target.appendChild(resetButton);
        target.appendChild(resultSpan);

        let apiToken = localStorage.getItem('tornApiToken');
        if (!apiToken || apiToken === DEFAULT_API_KEY) {
            alert('Please enter your API token with the correct permissions.');
            const newApiToken = prompt("Please enter your Torn API token key:", DEFAULT_API_KEY);
            if (newApiToken && newApiToken !== DEFAULT_API_KEY) {
                apiToken = newApiToken;
                localStorage.setItem('tornApiToken', apiToken);
                resultSpan.textContent = 'API token set.';
                resultSpan.style.color = 'green';
            } else {
                resultSpan.textContent = 'No valid API token provided.';
                resultSpan.style.color = 'red';
                console.error('No valid API token provided.');
                return;
            }
        } else {
            resultSpan.textContent = 'API token found.';
            resultSpan.style.color = 'green';
        }

        if (apiToken) {
            updateUpkeep(apiToken);
            setInterval(() => updateUpkeep(apiToken), CHECK_INTERVAL);
        }

        // Add click event to navigate to properties page
        upkeepButton.addEventListener('click', () => {
            window.location.href = PROPERTIES_PAGE;
        });

        resetButton.addEventListener('click', () => {
            const newApiToken = prompt("Please enter your new Torn API token key:", DEFAULT_API_KEY);
            if (newApiToken && newApiToken !== DEFAULT_API_KEY) {
                localStorage.setItem('tornApiToken', newApiToken);
                resultSpan.textContent = 'API token updated.';
                resultSpan.style.color = 'green';
                apiToken = newApiToken;
                updateUpkeep(apiToken); // Update immediately with new token
            } else {
                resultSpan.textContent = 'No valid API token provided.';
                resultSpan.style.color = 'red';
                console.error('No valid API token provided.');
            }
        });
    }

    async function updateUpkeep(apiToken) {
        const upkeepButton = document.getElementById('Upkeep');
        const resultSpan = document.getElementById('Result');
        upkeepButton.textContent = 'Loading Upkeep...';

        try {
            // Step 1: Get user ID from URL (assuming profile page context)
            const userId = new URLSearchParams(window.location.search).get('XID');
            if (!userId) {
                throw new Error('User ID not found in URL. Please run this on your profile page.');
            }

            // Step 2: Fetch property types to find "Private Island" ID
            const propTypesResponse = await fetch(`https://api.torn.com/properties?key=${apiToken}`);
            const propTypesData = await propTypesResponse.json();
            if (propTypesData.error) {
                throw new Error(`API error: ${propTypesData.error.error}`);
            }

            let privateIslandId = null;
            for (const [id, prop] of Object.entries(propTypesData.properties)) {
                if (prop.property_type_name === 'Private Island') {
                    privateIslandId = id;
                    break;
                }
            }
            if (!privateIslandId) {
                throw new Error('Private Island property type not found in API response.');
            }

            // Step 3: Fetch player properties to get upkeep
            const playerResponse = await fetch(`https://api.torn.com/user/${userId}?selections=properties&key=${apiToken}`);
            const playerData = await playerResponse.json();
            if (playerData.error) {
                throw new Error(`API error: ${playerData.error.error}`);
            }

            const properties = playerData.properties;
            let upkeepValue = null;
            for (const prop of Object.values(properties)) {
                if (String(prop.property_type) === String(privateIslandId)) {
                    upkeepValue = prop.upkeep;
                    break;
                }
            }

            if (upkeepValue !== null) {
                upkeepButton.textContent = `Upkeep: $${upkeepValue.toLocaleString()}`;
                resultSpan.textContent = 'Upkeep loaded.';
                resultSpan.style.color = 'green';
            } else {
                upkeepButton.textContent = 'Upkeep: N/A';
                resultSpan.textContent = 'No Private Island property found.';
                resultSpan.style.color = 'orange';
            }
        } catch (error) {
            console.error('Error updating upkeep:', error);
            upkeepButton.textContent = 'Upkeep: Error';
            resultSpan.textContent = error.message;
            resultSpan.style.color = 'red';
        }
    }

    // Initialize the script
    addButtonAndCheck();
})();