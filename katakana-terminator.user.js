// ==UserScript==
// @name        Katakana Terminator (AI)
// @description Convert gairaigo (Japanese loan words) back to English
// @author      Arnie97
// @license     MIT
// @copyright   2017-2025, Katakana Terminator Contributors (https://github.com/Arnie97/katakana-terminator/graphs/contributors)
// @namespace   https://github.com/Izumiko
// @homepageURL https://github.com/Izumiko/katakana-terminator
// @supportURL  https://greasyfork.org/scripts/33268/feedback
// @icon        https://upload.wikimedia.org/wikipedia/commons/2/28/Ja-Ruby.png
// @match       *://*/*
// @exclude     *://*.bilibili.com/video/*
// @grant       GM.xmlHttpRequest
// @grant       GM_xmlhttpRequest
// @grant       GM_addStyle
// @connect     translate.google.com
// @connect     translate.googleapis.com
// @connect     generativelanguage.googleapis.com
// @version     2025.07.31
// @name:ja-JP  カタカナターミネーター(AI)
// @name:zh-CN  片假名终结者(AI)
// @description:zh-CN 在网页中的日语外来语上方标注英文原词
// ==/UserScript==

'use strict';

// User settings
const userSettings = {
    apiService: 'google', // google, ai. Default to Google Translate
    aiApiKey: '',     // AI API key
    aiApiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', // AI API endpoint
    aiModel: 'gemini-2.5-flash-lite',
    aiModelTemperature: 0.2,     // AI temperature parameter
};

// Use document instead of shorthand for better readability
const doc = document;

// Use Maps instead of objects for key-value storage
const queue = new Map(); // Map<string, HTMLElement[]> - {"カタカナ": [rtNodeA, rtNodeB]}
const cachedTranslations = new Map(); // Map<string, string> - {"ターミネーター": "Terminator"}
const newNodes = [doc.body];

// State variables
let hasPendingNodes = true;
let initialScanComplete = false;

// Katakana regular expression
const katakanaRegex = /[\u30A1-\u30FA\u30FD-\u30FF][\u3099\u309A\u30A1-\u30FF]*[\u3099\u309A\u30A1-\u30FA\u30FC-\u30FF]|[\uFF66-\uFF6F\uFF71-\uFF9D][\uFF65-\uFF9F]*[\uFF66-\uFF9F]/;

// Tags to exclude
const excludeTags = new Set(['ruby', 'script', 'select', 'textarea']);

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
    if (userSettings.apiService === 'ai' &&
        userSettings.aiApiEndpoint &&
        userSettings.aiApiKey) {
        return translateWithAI(phrases);
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
 * Translate phrases with AI API
 * @param {string[]} phrases - Array of phrases to translate
 * @returns {Promise} - Promise for translation
 */
const translateWithAI = async (phrases) => {
    // Split phrases into smaller chunks to avoid API limits
    const maxPhrasesPerRequest = 100;
    const chunks = [];

    for (let i = 0; i < phrases.length; i += maxPhrasesPerRequest) {
        chunks.push(phrases.slice(i, i + maxPhrasesPerRequest));
    }

    // Process each chunk with Promise.all for concurrent execution
    try {
        await Promise.all(chunks.map(chunk => processAiChunk(chunk)));
        return true;
    } catch (error) {
        console.error('Katakana Terminator: AI API error', error);

        // Fall back to Google Translate
        for (const phrase of phrases) {
            cachedTranslations.delete(phrase);
        }

        return translateWithGoogle(phrases);
    }
};

/**
 * Process AI API chunk
 * @param {string[]} phrases - Chunk of phrases
 * @returns {Promise} - Promise for processing
 */
const processAiChunk = async (phrases) => {
    // Build prompt
    const prompt = `
Your task is to restore the following Japanese katakana terms to their original source language words or their Romaji representation.

## Rules
- For each katakana term, provide its original word or phrase from its source language.
- If the term is a native Japanese word (e.g., onomatopoeia, emphasis), identify the language as Japanese ('ja') and output its Romaji transliteration.
- If the term is an abbreviation, return the full original name.
- Prepend each result with its ISO 639-1 language code followed by a colon and a space (e.g., 'en: ').
- Return one result per line.
- Do not include the original katakana, explanations, or any other text in your response.

## Katakana Terms to Restore
${phrases.join('\n')}

## Example Request and Response

### Request:
ストレス
アルバイト
ブルアカ
パソコン
キラキラ
ワクチン

### Response:
en: stress
de: Arbeit
en: Blue Archive
en: personal computer
ja: kirakira
nl: vaccin
`;
    const systemPrompt = `
You are a specialized linguistic AI assistant. Your sole purpose is to analyze Japanese katakana terms, identify their etymological origins, and return the original word or phrase in its source language.

Core Directives:
- **Identify Source Language**: You must accurately determine the source language (e.g., English, German, French, etc.).
- **Handle Native Japanese Words**: If a katakana term represents a native Japanese word (e.g., onomatopoeia, for emphasis), you must identify the language as Japanese ('ja') and provide its standard Romaji transliteration.
- **Handle Abbreviations**: You are an expert at recognizing katakana abbreviations (e.g.,「パソコン」,「ブルアカ」) and must return the full, original term (e.g., "personal computer", "Blue Archive"), not the expanded katakana.
- **Strict Output Format**: Your response must strictly adhere to the format '[ISO 639-1 code]: [Original Word/Phrase/Romaji]'.
- **No Extra Information**: You must NOT provide any explanations, Japanese translations, katakana terms, or any other text outside of the requested output. Your response should be clean data.
- **Precision**: Maintain original capitalization for proper nouns, acronyms, or language-specific rules (e.g., German nouns).
    `;

    try {
        // Make API request
        const response = await makeRequest({
            method: "POST",
            url: userSettings.aiApiEndpoint,
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${userSettings.aiApiKey}`
            },
            data: JSON.stringify({
                model: userSettings.aiModel,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: prompt }
                ],
                temperature: userSettings.aiModelTemperature
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
                console.debug(prompt);
                console.debug(content);
                throw new Error('AI response does not match input count');
            }
        } else {
            console.debug(prompt);
            console.debug(data);
            throw new Error('Invalid AI response format');
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
        hosts: ['translate.google.com'],
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
