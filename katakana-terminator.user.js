// ==UserScript==
// @name        Katakana Terminator
// @description Convert gairaigo (Japanese loan words) back to English
// @author      Arnie97
// @license     MIT
// @copyright   2017-2024, Katakana Terminator Contributors (https://github.com/Arnie97/katakana-terminator/graphs/contributors)
// @namespace   https://github.com/Izumiko
// @homepageURL https://github.com/Izumiko/katakana-terminator
// @supportURL  https://greasyfork.org/scripts/33268/feedback
// @icon        https://upload.wikimedia.org/wikipedia/commons/2/28/Ja-Ruby.png
// @match       *://*/*
// @exclude     *://*.bilibili.com/video/*
// @grant       GM.xmlHttpRequest
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @grant       GM.getValue
// @grant       GM.setValue
// @grant       GM_getValue
// @grant       GM_setValue
// @connect     translate.google.cn
// @connect     translate.google.com
// @connect     translate.googleapis.com
// @connect     generativelanguage.googleapis.com
// @version     2025.04.22
// @name:ja-JP  カタカナターミネーター
// @name:zh-CN  片假名终结者
// @description:zh-CN 在网页中的日语外来语上方标注英文原词
// ==/UserScript==

'use strict';

// Use document instead of shorthand for better readability
const doc = document;

// Use Maps instead of objects for key-value storage
const queue = new Map();  // Map<string, HTMLElement[]> - {"カタカナ": [rtNodeA, rtNodeB]}
const cachedTranslations = new Map();  // Map<string, string> - {"ターミネーター": "Terminator"}
const newNodes = [doc.body];

// State variables
let hasPendingNodes = true;
let initialScanComplete = false;

// Katakana regular expression
const katakanaRegex = /[\u30A1-\u30FA\u30FD-\u30FF][\u3099\u309A\u30A1-\u30FF]*[\u3099\u309A\u30A1-\u30FA\u30FC-\u30FF]|[\uFF66-\uFF6F\uFF71-\uFF9D][\uFF65-\uFF9F]*[\uFF66-\uFF9F]/;

// Tags to exclude
const excludeTags = new Set(['ruby', 'script', 'select', 'textarea']);

// User settings
let userSettings = {
    apiService: 'google', // Default to Google Translate
    geminiApiKey: '',     // Gemini API key
    geminiApiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', // Gemini API endpoint
    geminiModel: 'gemini-2.0-flash-lite',
    temperature: 0.2,     // Gemini temperature parameter
};

/**
 * Initialize user settings using async/await
 */
const initSettings = async () => {
    try {
        // Use appropriate API depending on what's available
        let value;
        if (typeof GM.getValue === 'function') {
            value = await GM.getValue('katakanaTerminatorSettings', null);
        } else if (typeof GM_getValue === 'function') {
            value = GM_getValue('katakanaTerminatorSettings', null);
        }

        if (value) {
            userSettings = JSON.parse(value);
        }

        // Add settings UI
        addSettingsUI();
    } catch (error) {
        console.error('Katakana Terminator: Error loading settings', error);
    }
};

/**
 * Save user settings using async/await
 */
const saveSettings = async () => {
    try {
        const settingsString = JSON.stringify(userSettings);

        // Use appropriate API depending on what's available
        if (typeof GM.setValue === 'function') {
            await GM.setValue('katakanaTerminatorSettings', settingsString);
        } else if (typeof GM_setValue === 'function') {
            GM_setValue('katakanaTerminatorSettings', settingsString);
        }
    } catch (error) {
        console.error('Katakana Terminator: Error saving settings', error);
    }
};

/**
 * Add settings UI
 */
const addSettingsUI = () => {
    // Create settings button
    const settingsBtn = doc.createElement('div');
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.title = 'Katakana Terminator Settings';
    settingsBtn.style.cssText = `
        position: fixed;
        bottom: 16px;
        right: 16px;
        width: 32px;
        height: 32px;
        background: #ffffff;
        border: 1px solid #cccccc;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 9999;
        font-size: 16px;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        opacity: 0.4;
    `;

    // Click button to show settings panel
    settingsBtn.addEventListener('click', showSettingsPanel);

    // Add to document
    doc.body.appendChild(settingsBtn);
};

/**
 * Show settings panel
 */
const showSettingsPanel = () => {
    // Create modal dialog
    const modal = doc.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    // Create settings panel
    const panel = doc.createElement('div');
    panel.style.cssText = `
        background: #ffffff;
        border-radius: 8px;
        padding: 20px;
        width: 400px;
        max-width: 90%;
        max-height: 90%;
        overflow-y: auto;
    `;

    // Settings panel title
    panel.innerHTML = `<h2 style="margin-top:0">Katakana Terminator Settings</h2>`;

    // Create form
    const form = doc.createElement('form');
    form.innerHTML = `
        <div style="margin-bottom:15px">
            <label style="display:block;margin-bottom:5px">Translation Service:</label>
            <select id="kt-api-service" style="width:100%;padding:5px">
                <option value="google" ${userSettings.apiService === 'google' ? 'selected' : ''}>Google Translate</option>
                <option value="gemini" ${userSettings.apiService === 'gemini' ? 'selected' : ''}>Gemini Flash 2.0 Lite</option>
            </select>
        </div>

        <div id="gemini-settings" style="display:${userSettings.apiService === 'gemini' ? 'block' : 'none'}">
            <div style="margin-bottom:15px">
                <label style="display:block;margin-bottom:5px">API Endpoint (OpenAI-compatible):</label>
                <input type="text" id="kt-gemini-endpoint" placeholder="https://your-api-endpoint.com/v1/chat/completions" 
                       value="${userSettings.geminiApiEndpoint}" style="width:100%;padding:5px;box-sizing:border-box">
            </div>

            <div style="margin-bottom:15px">
                <label style="display:block;margin-bottom:5px">Model:</label>
                <input type="text" id="kt-gemini-model" placeholder="model name" 
                       value="${userSettings.geminiModel}" style="width:100%;padding:5px;box-sizing:border-box">
            </div>

            <div style="margin-bottom:15px">
                <label style="display:block;margin-bottom:5px">API Key:</label>
                <input type="password" id="kt-gemini-key" placeholder="Enter your API key" 
                       value="${userSettings.geminiApiKey}" style="width:100%;padding:5px;box-sizing:border-box">
            </div>

            <div style="margin-bottom:15px">
                <label style="display:block;margin-bottom:5px">Temperature (0-1):</label>
                <input type="range" id="kt-temperature" min="0" max="1" step="0.1" 
                       value="${userSettings.temperature}" style="width:100%">
                <span id="temperature-value">${userSettings.temperature}</span>
            </div>
        </div>

        <div style="display:flex;justify-content:space-between;margin-top:20px">
            <button type="button" id="kt-cancel" style="padding:8px 15px">Cancel</button>
            <button type="submit" id="kt-save" style="padding:8px 15px;background:#4CAF50;color:white;border:none;border-radius:4px">Save</button>
        </div>
    `;

    panel.appendChild(form);
    modal.appendChild(panel);
    doc.body.appendChild(modal);

    // Set event listeners
    const apiServiceSelect = doc.getElementById('kt-api-service');
    const geminiSettings = doc.getElementById('gemini-settings');
    const temperatureInput = doc.getElementById('kt-temperature');
    const temperatureValue = doc.getElementById('temperature-value');

    // Toggle Gemini settings when API service changes
    apiServiceSelect.addEventListener('change', () => {
        geminiSettings.style.display = apiServiceSelect.value === 'gemini' ? 'block' : 'none';
    });

    // Update temperature display
    temperatureInput.addEventListener('input', () => {
        temperatureValue.textContent = temperatureInput.value;
    });

    // Cancel button
    doc.getElementById('kt-cancel').addEventListener('click', () => {
        doc.body.removeChild(modal);
    });

    // Save button
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get setting values
        userSettings.apiService = apiServiceSelect.value;
        userSettings.geminiApiEndpoint = doc.getElementById('kt-gemini-endpoint').value;
        userSettings.geminiModel = doc.getElementById('kt-gemini-model').value;
        userSettings.geminiApiKey = doc.getElementById('kt-gemini-key').value;
        userSettings.temperature = parseFloat(temperatureInput.value);

        // Save settings
        await saveSettings();

        // Clear cached translations to use new translation service
        cachedTranslations.clear();

        // Close settings panel
        doc.body.removeChild(modal);
    });
};

/**
 * Recursively scan node and its descendants (depth-first search)
 * @param {Node} node - Node to scan
 */
const scanTextNodes = (node) => {
    // Check if node is detached from DOM tree
    if (!node.parentNode || !doc.body.contains(node)) {
        return;
    }

    switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            const tagName = node.tagName.toLowerCase();
            if (excludeTags.has(tagName) || node.isContentEditable) {
                return;
            }
            Array.from(node.childNodes).forEach(scanTextNodes);
            break;

        case Node.TEXT_NODE:
            // Use more modern way to handle text nodes
            let currentNode = node;
            let nextNode;
            while ((nextNode = addRuby(currentNode))) {
                currentNode = nextNode;
            }
            break;
    }
};

/**
 * Add ruby tag to text node
 * @param {Node} node - Text node
 * @returns {Node|false} - Next node after processing or false
 */
const addRuby = (node) => {
    const text = node.nodeValue;
    if (!text) return false;

    const match = katakanaRegex.exec(text);
    if (!match) return false;

    const katakanaText = match[0];
    const ruby = doc.createElement('ruby');
    ruby.appendChild(doc.createTextNode(katakanaText));

    const rt = doc.createElement('rt');
    rt.classList.add('katakana-terminator-rt');
    ruby.appendChild(rt);

    // Add ruby title node to translation queue
    if (!queue.has(katakanaText)) {
        queue.set(katakanaText, []);
    }
    queue.get(katakanaText).push(rt);

    // Split text node and insert ruby element
    const after = node.splitText(match.index);
    node.parentNode.insertBefore(ruby, after);
    after.nodeValue = after.nodeValue.substring(katakanaText.length);

    return after;
};

/**
 * Translate text nodes
 */
const translateTextNodes = async () => {
    let apiRequestCount = 0;
    let phraseCount = 0;
    const chunkSize = 200;
    let chunk = [];

    // Use for...of to iterate over Map
    for (const [phrase, nodes] of queue.entries()) {
        phraseCount++;

        if (cachedTranslations.has(phrase)) {
            updateRubyByCachedTranslations(phrase);
            continue;
        }

        chunk.push(phrase);
        if (chunk.length >= chunkSize) {
            apiRequestCount++;
            try {
                await translate(chunk);
            } catch (error) {
                console.error('Katakana Terminator: Translation error', error);
            }
            chunk = [];
        }
    }

    if (chunk.length) {
        apiRequestCount++;
        try {
            await translate(chunk);
        } catch (error) {
            console.error('Katakana Terminator: Translation error', error);
        }
    }

    if (phraseCount && apiRequestCount) {
        console.debug('Katakana Terminator:', phraseCount, 'phrases translated in', apiRequestCount, 'requests, frame', window.location.href);
    }
};

/**
 * Build query string
 * @param {Object} params - Parameter object
 * @returns {string} - Query string
 */
const buildQueryString = (params) => {
    return '?' + Object.entries(params)
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
};

/**
 * Translate phrases
 * @param {string[]} phrases - Array of phrases to translate
 * @returns {Promise} - Promise for translation
 */
const translate = async (phrases) => {
    // Prevent duplicate HTTP requests before they complete
    phrases.forEach(phrase => {
        cachedTranslations.set(phrase, null);
    });

    // Choose translation service based on user settings
    if (userSettings.apiService === 'gemini' &&
        userSettings.geminiApiEndpoint &&
        userSettings.geminiApiKey) {
        return translateWithGemini(phrases);
    } else {
        return translateWithGoogle(phrases);
    }
};

/**
 * Make HTTP request using Promise
 * @param {Object} options - Request options
 * @returns {Promise} - Promise for response
 */
const makeRequest = (options) => {
    return new Promise((resolve, reject) => {
        // Create a compatible requester function
        const requester = typeof GM.xmlHttpRequest === 'function'
            ? GM.xmlHttpRequest
            : typeof GM_xmlhttpRequest === 'function'
                ? GM_xmlhttpRequest
                : null;

        if (!requester) {
            reject(new Error('No compatible HTTP request function available'));
            return;
        }

        requester({
            ...options,
            onload: resolve,
            onerror: reject
        });
    });
};

/**
 * Translate phrases with Google Translate API
 * @param {string[]} phrases - Array of phrases to translate
 * @returns {Promise} - Promise for translation
 */
const translateWithGoogle = async (phrases) => {
    let currentApiIndex = 0;
    let success = false;
    let lastError = null;

    while (currentApiIndex < googleApiList.length && !success) {
        const api = googleApiList[currentApiIndex];
        try {
            const response = await makeRequest({
                method: "GET",
                url: `https://${api.hosts[0]}${api.path}${buildQueryString(api.params(phrases))}`
            });

            // Replace quotes to prevent JSON parse errors
            const responseText = response.responseText.replace(/'/g, '\u2019');
            const data = JSON.parse(responseText);

            // Process data
            await api.process(phrases, data);
            success = true;
        } catch (error) {
            console.error('Katakana Terminator: Google API error', api.name, error);
            lastError = error;
            currentApiIndex++;
        }
    }

    if (!success) {
        // Clear cached nulls for these phrases
        phrases.forEach(phrase => {
            cachedTranslations.delete(phrase);
        });
        throw lastError || new Error('All Google API fallbacks exhausted');
    }

    return success;
};

/**
 * Translate phrases with Gemini API
 * @param {string[]} phrases - Array of phrases to translate
 * @returns {Promise} - Promise for translation
 */
const translateWithGemini = async (phrases) => {
    // Split phrases into smaller chunks to avoid API limits
    const maxPhrasesPerRequest = 100;
    const chunks = [];

    for (let i = 0; i < phrases.length; i += maxPhrasesPerRequest) {
        chunks.push(phrases.slice(i, i + maxPhrasesPerRequest));
    }

    // Process each chunk with Promise.all for concurrent execution
    try {
        await Promise.all(chunks.map(chunk => processGeminiChunk(chunk)));
        return true;
    } catch (error) {
        console.error('Katakana Terminator: Gemini API error', error);

        // Fall back to Google Translate
        for (const phrase of phrases) {
            cachedTranslations.delete(phrase);
        }

        return translateWithGoogle(phrases);
    }
};

/**
 * Process Gemini API chunk
 * @param {string[]} phrases - Chunk of phrases
 * @returns {Promise} - Promise for processing
 */
const processGeminiChunk = async (phrases) => {
    // Build prompt
    const prompt = `
Please restore the following Japanese katakana terms into their original language words (no explanations). Return only the corresponding original word and language code for each katakana, one per line (response should not contain katakana terms):

${phrases.join('\n')}

Example request and response format:
Request:
ストレス
アルバイト
Response:
en: stress
de: arbeit
`;

    try {
        // Make API request
        const response = await makeRequest({
            method: "POST",
            url: userSettings.geminiApiEndpoint,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${userSettings.geminiApiKey}`
            },
            data: JSON.stringify({
                model: userSettings.geminiModel,
                messages: [
                    { role: "system", content: "You are a multilingual scholar." },
                    { role: "user", content: prompt }
                ],
                temperature: userSettings.temperature
            })
        });

        const data = JSON.parse(response.responseText);

        if (data.choices && data.choices[0] && data.choices[0].message) {
            const content = data.choices[0].message.content;

            // Split response into lines
            const lines = content.trim().split('\n');

            // Ensure line count matches phrase count
            if (lines.length === phrases.length) {
                phrases.forEach((phrase, index) => {
                    // Save translation result
                    cachedTranslations.set(phrase, lines[index].trim());
                    updateRubyByCachedTranslations(phrase);
                });
            } else {
                throw new Error('Gemini response does not match input count');
            }
        } else {
            throw new Error('Invalid Gemini response format');
        }
    } catch (error) {
        throw error;
    }
};

/**
 * Google API list with async processors
 */
const googleApiList = [
    {
        name: 'Google Translate',
        hosts: ['translate.googleapis.com'],
        path: '/translate_a/single',
        params: (phrases) => {
            const joinedText = phrases.join('\n').replace(/\s+$/, '');
            return {
                sl: 'ja',
                tl: 'en',
                dt: 't',
                client: 'gtx',
                q: joinedText,
            };
        },
        process: async (phrases, resp) => {
            resp[0].forEach(item => {
                const translated = item[0].replace(/\s+$/, '');
                const original = item[1].replace(/\s+$/, '');
                cachedTranslations.set(original, translated);
                updateRubyByCachedTranslations(original);
            });
        },
    },
    {
        name: 'Google Dictionary',
        hosts: ['translate.google.cn'],
        path: '/translate_a/t',
        params: (phrases) => {
            const joinedText = phrases.join('\n').replace(/\s+$/, '');
            return {
                sl: 'ja',
                tl: 'en',
                dt: 't',
                client: 'dict-chrome-ex',
                q: joinedText,
            };
        },
        process: async (phrases, resp) => {
            // ["katakana\nterminator"]
            if (!resp.sentences) {
                const translated = resp[0].split('\n');
                if (translated.length !== phrases.length) {
                    throw new Error('Response does not match input phrases');
                }
                translated.forEach((trans, i) => {
                    const orig = phrases[i];
                    cachedTranslations.set(orig, trans);
                    updateRubyByCachedTranslations(orig);
                });
                return;
            }

            resp.sentences.forEach(s => {
                if (!s.orig) return;

                const original = s.orig.trim();
                const translated = s.trans.trim();
                cachedTranslations.set(original, translated);
                updateRubyByCachedTranslations(original);
            });
        },
    },
];

/**
 * Update ruby tags in translation queue
 * @param {string} phrase - Phrase
 */
const updateRubyByCachedTranslations = (phrase) => {
    const translation = cachedTranslations.get(phrase);
    if (!translation) return;

    const nodes = queue.get(phrase) || [];
    nodes.forEach(node => {
        node.dataset.rt = translation;
    });
    queue.delete(phrase);
};

/**
 * Handle DOM mutations
 * @param {MutationRecord[]} mutationList - List of mutation records
 */
const mutationHandler = (mutationList) => {
    for (const mutation of mutationList) {
        if (mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach(node => {
                newNodes.push(node);
            });
            // Set flag indicating new nodes need processing
            hasPendingNodes = true;
        }
    }
};

/**
 * Rescan text nodes, only execute when changes exist
 */
const rescanTextNodes = async () => {
    // Process buffered changes
    mutationHandler(observer.takeRecords());

    // Only execute on initial scan or when pending nodes exist
    if (!initialScanComplete || hasPendingNodes) {
        if (newNodes.length) {
            // console.debug('Katakana Terminator:', newNodes.length, 'new nodes were added, frame', window.location.href);
            newNodes.forEach(scanTextNodes);
            newNodes.length = 0;
            await translateTextNodes();
        }

        // Reset flags
        hasPendingNodes = false;
        initialScanComplete = true;
    }
};

/**
 * GM4 polyfill for styles
 */
if (typeof GM_addStyle === 'undefined') {
    GM_addStyle = (css) => {
        const head = doc.getElementsByTagName('head')[0];
        if (!head) return null;

        const style = doc.createElement('style');
        style.setAttribute('type', 'text/css');
        style.textContent = css;
        head.appendChild(style);
        return style;
    };
}

// Observer to watch for DOM changes
let observer;

/**
 * Main function with async/await
 */
const main = async () => {
    try {
        // Initialize settings
        await initSettings();

        // Add styles
        GM_addStyle("rt.katakana-terminator-rt::before { content: attr(data-rt); }");

        // Create and start observer
        observer = new MutationObserver(mutationHandler);
        observer.observe(doc.body, { childList: true, subtree: true });

        // Perform initial scan
        console.debug('Katakana Terminator: performing initial scan');
        scanTextNodes(doc.body);
        await translateTextNodes();
        initialScanComplete = true;

        // Periodically check for new nodes that need processing
        setInterval(rescanTextNodes, 500);
    } catch (error) {
        console.error('Katakana Terminator: Initialization error', error);
    }
};

// Start script
main();
