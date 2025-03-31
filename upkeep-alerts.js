// ==UserScript==
// @name         Upkeep Alerts
// @namespace    http://tampermonkey.net/
// @version      2025-03-31
// @description  Helps manage upkeep
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
    const DAILY_UPKEEP_TOTAL = 352500; // Default total upkeep

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

        let apiToken = localStorage.getItem('tornApiToken') || DEFAULT_API_KEY;
        if (apiToken === DEFAULT_API_KEY) {
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

        resetButton.addEventListener('click', () => {
            const newApiToken = prompt("Please enter your new Torn API token key:", DEFAULT_API_KEY);
            if (newApiToken && newApiToken !== DEFAULT_API_KEY) {
                localStorage.setItem('tornApiToken', newApiToken);
                resultSpan.textContent = 'API token updated.';
                resultSpan.style.color = 'green';
                apiToken = newApiToken;
                // Update the upkeep immediately with the new token
                updateUpkeep(apiToken);
            } else {
                resultSpan.textContent = 'No valid API token provided.';
                resultSpan.style.color = 'red';
                console.error('No valid API token provided.');
            }
        });
    }

    function updateUpkeep(apiToken) {
        // Add the code to update upkeep using the provided API token
    }

    // Initialize the script
    addButtonAndCheck();
})();