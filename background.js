// Background script for Browser Buddy

console.log('Browser Buddy background script loaded', new Date().toISOString());

// Initialize connection status tracking
const connections = {};

// Store API key in memory
let apiKey = '';

// Function to load the Claude API key from key.txt
async function loadClaudeApiKey() {
    try {
        console.log("Loading Claude API key from key.txt...");

        // Get the URL to key.txt
        const keyUrl = chrome.runtime.getURL('key.txt');

        // Fetch the key.txt file
        const response = await fetch(keyUrl);

        if (!response.ok) {
            throw new Error(`Failed to load API key: ${response.status} ${response.statusText}`);
        }

        // Read the key as text
        const apiKey = await response.text();

        // Trim any whitespace
        const trimmedKey = apiKey.trim();

        if (!trimmedKey) {
            throw new Error("API key is empty. Please add your Claude API key to key.txt");
        }

        console.log("Claude API key loaded successfully");
        return trimmedKey;
    } catch (error) {
        console.error("Error loading Claude API key:", error);
        throw error;
    }
}

// Function to load API key from storage or use key.txt
async function loadApiKey() {
    console.log('Attempting to load API key');

    try {
        // First try to get from Chrome storage
        if (chrome.storage && chrome.storage.local) {
            const data = await chrome.storage.local.get('claudeApiKey');
            if (data && data.claudeApiKey) {
                apiKey = data.claudeApiKey;
                console.log('API key loaded from storage successfully');
                return true;
            }
        }

        // If not in storage, load from key.txt
        try {
            apiKey = await loadClaudeApiKey();
            console.log('API key loaded from key.txt');

            // Save to storage for future use
            if (chrome.storage && chrome.storage.local) {
                await chrome.storage.local.set({ 'claudeApiKey': apiKey });
                console.log('API key saved to storage');
            }

            return true;
        } catch (error) {
            console.error('Failed to load API key from key.txt:', error);
        }

        console.error('No API key found in storage or key.txt');
        return false;
    } catch (error) {
        console.error('Error loading API key:', error);
        return false;
    }
}

// Function to notify that background is alive
function pingContentScripts() {
    chrome.tabs.query({}, tabs => {
        tabs.forEach(tab => {
            try {
                chrome.tabs.sendMessage(tab.id, { action: "backgroundAlive" })
                    .catch(err => console.log(`Cannot reach tab ${tab.id}:`, err.message));
            } catch (e) {
                // Ignore errors for tabs that can't be messaged
            }
        });
    });
}

// Load API key when background script starts and ping content scripts
(async function init() {
    await loadApiKey();
    console.log('Initial API key loaded, first 4 chars:', apiKey.substring(0, 4) + '...');

    // Ping content scripts every 15 seconds
    setInterval(pingContentScripts, 15000);
    pingContentScripts(); // Ping immediately too
})();

// Handle tab connections
chrome.runtime.onConnect.addListener(port => {
    const tabId = port.sender.tab?.id;
    if (tabId) {
        console.log(`Tab ${tabId} connected via ${port.name}`);
        connections[tabId] = port;

        port.onDisconnect.addListener(() => {
            console.log(`Tab ${tabId} disconnected`);
            delete connections[tabId];
        });
    }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    console.log(`Background received message from tab ${tabId}:`, message.action);

    // Handle ping/pong for connection testing
    if (message.action === 'ping') {
        console.log('Received ping, sending pong');
        sendResponse({ success: true, action: 'pong' });
        return false; // Synchronous response
    }

    if (message.action === 'callClaudeAPI') {
        console.log('Calling Claude API with prompt:', message.prompt?.substring(0, 30) + '...');
        console.log('Using all tabs:', message.useAllTabs ? 'Yes' : 'No');

        // Make sure we respond even if there's an error
        callClaudeAPI(message.prompt, message.history, message.useAllTabs)
            .then(response => {
                console.log('Claude API response received');
                try {
                    sendResponse({ success: true, data: response });
                } catch (error) {
                    console.error('Error sending response:', error);
                }
            })
            .catch(error => {
                console.error('Error calling Claude API:', error);
                try {
                    sendResponse({ success: false, error: error.toString() });
                } catch (sendError) {
                    console.error('Error sending error response:', sendError);
                }
            });

        // Return true to indicate we'll respond asynchronously
        return true;
    }

    // Default handler for unknown actions
    console.log('No handler for message action:', message.action);
    sendResponse({ success: false, error: 'Unknown action' });
    return false;
});

// Function to get content from all open tabs
async function getAllTabContent() {
    try {
        console.log('Getting content from all open tabs...');
        const tabs = await chrome.tabs.query({});
        console.log(`Found ${tabs.length} open tabs`);

        const tabsContent = [];

        for (const tab of tabs) {
            try {
                // Skip tabs that can't be injected with content scripts
                if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
                    console.log(`Skipping tab ${tab.id} (${tab.url}) as it cannot be accessed`);
                    continue;
                }

                console.log(`Reading content from tab ${tab.id} (${tab.url})`);

                // Execute content script to get the page text
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    function: () => {
                        // This function runs in the context of the tab
                        function extractText(element, texts) {
                            if (!element) return;

                            // Skip invisible elements - only check style for Element nodes (not Text nodes)
                            if (element.nodeType === Node.ELEMENT_NODE) {
                                const style = window.getComputedStyle(element);
                                if (style.display === 'none' || style.visibility === 'hidden') return;

                                // Skip script, style, and other non-content elements
                                const tagsToSkip = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'PATH'];
                                if (tagsToSkip.includes(element.tagName)) return;
                            }

                            // Consider only text nodes that have non-whitespace content
                            if (element.nodeType === Node.TEXT_NODE) {
                                const text = element.textContent.trim();
                                if (text) texts.push(text);
                                return;
                            }

                            // Process child nodes - only if this is an element node
                            if (element.nodeType === Node.ELEMENT_NODE && element.childNodes) {
                                for (const child of element.childNodes) {
                                    extractText(child, texts);
                                }
                            }
                        }

                        const texts = [];

                        try {
                            // Start with the document body
                            if (document.body) {
                                extractText(document.body, texts);
                            }

                            // Collect page metadata
                            const title = document.title || '';
                            const url = window.location.href || '';
                            const metaDescription = document.querySelector('meta[name="description"]')?.content || '';

                            return {
                                title: title,
                                url: url,
                                metaDescription: metaDescription,
                                content: texts.join('\n')
                            };
                        } catch (error) {
                            console.error('Error extracting text:', error);
                            return {
                                title: document.title || '',
                                url: window.location.href || '',
                                content: `Error extracting content: ${error.message}`
                            };
                        }
                    }
                });

                if (results && results[0] && results[0].result) {
                    const { title, url, metaDescription, content } = results[0].result;

                    // Only add if we got meaningful content
                    if (content && content.length > 0) {
                        tabsContent.push({
                            title,
                            url,
                            metaDescription,
                            content: content.substring(0, 15000) // Limit content length
                        });
                        console.log(`Added content from tab: ${title} (${url.substring(0, 50)}...)`);
                        console.log(`Content length: ${content.length} characters`);
                    } else {
                        console.log(`No meaningful content extracted from tab: ${title} (${url})`);
                    }
                }
            } catch (error) {
                console.error(`Error reading tab ${tab.id}:`, error);
            }
        }

        return tabsContent;
    } catch (error) {
        console.error('Error getting all tab content:', error);
        return [];
    }
}

// Function to call Claude API
async function callClaudeAPI(prompt, history, useAllTabs = false) {
    console.log('callClaudeAPI function called');
    console.log('Prompt length:', prompt?.length || 0, 'characters');
    console.log('Prompt begins with:', prompt?.substring(0, 100) + '...');
    console.log('Prompt ends with:', prompt?.substring(prompt.length - 100) + '...');
    console.log('Using all tabs content:', useAllTabs ? 'Yes' : 'No');

    // Claude API endpoint
    const apiUrl = 'https://api.anthropic.com/v1/messages';

    // Ensure API key is loaded
    if (!apiKey) {
        console.log('API key not found, attempting to load');
        const loaded = await loadApiKey();
        if (!loaded || !apiKey) {
            const error = 'API key not available. Please check your configuration.';
            console.error(error);
            throw new Error(error);
        }
    }

    console.log('Using API endpoint:', apiUrl);
    console.log('API key available (first 4 chars):', apiKey.substring(0, 4) + '...');

    // Extract the user's actual question and page content from the prompt
    const promptLines = prompt.split('\n');
    let userQuestion = '';
    let pageContent = '';
    let capturePageContent = false;

    // Debug - log all prompt lines to see what we're working with
    console.log('----DEBUG: FULL PROMPT LINES----');
    for (let i = 0; i < promptLines.length; i++) {
        console.log(`Line ${i + 1}: ${promptLines[i].substring(0, 100)}`);
    }
    console.log('----END DEBUG PROMPT LINES----');

    for (const line of promptLines) {
        if (line.startsWith('User asked:')) {
            userQuestion = line.replace('User asked:', '').replace(/"/g, '').trim();
        } else if (line.includes('content of the webpage')) {
            capturePageContent = true;
        } else if (line.includes('Please respond to the user')) {
            capturePageContent = false;
        } else if (capturePageContent && line.trim()) {
            pageContent += line + '\n';
        }
    }

    console.log('Extracted user question:', userQuestion);
    console.log('Extracted page content length:', pageContent.length);

    // Debug - log full page content 
    console.log('---- FULL PAGE CONTENT START ----');
    // Print in chunks to avoid console truncation
    const chunks = [];
    for (let i = 0; i < pageContent.length; i += 1000) {
        chunks.push(pageContent.substring(i, i + 1000));
    }
    chunks.forEach((chunk, i) => {
        console.log(`Content chunk ${i + 1}/${chunks.length}: ${chunk}`);
    });
    console.log('---- FULL PAGE CONTENT END ----');

    // Get content from all tabs
    const tabsContent = await getAllTabContent();
    console.log(`Retrieved content from ${tabsContent.length} tabs`);

    // Create system message content for current page
    const systemContent = `You are Browser Buddy, an AI assistant helping users understand web content. 
You have access to the current webpage content which is provided below. 
When answering questions, refer to this content.
ONLY answer questions based on the information provided in the webpage content.
If the information is not in the page content, say so clearly.

WEBPAGE CONTENT:
${pageContent}`;

    // Create system message content for all tabs
    const systemContentAllTabs = `You are Browser Buddy, an AI assistant helping users understand web content. 
You have access to the content of all open tabs which is provided below. 
When answering questions, refer to this content.
ONLY answer questions based on the information provided in the tabs content.
If the information is not in any tab content, say so clearly.

ALL TABS CONTENT:
${tabsContent.map(tab => `
URL: ${tab.url}
TITLE: ${tab.title}
CONTENT:
${tab.content}
----------------------------------------
`).join('\n')}`;

    console.log('System content length:', systemContent.length);
    console.log('System content all tabs length:', systemContentAllTabs.length);

    // Choose which system content to use
    const finalSystemContent = useAllTabs ? systemContentAllTabs : systemContent;
    console.log(`Using ${useAllTabs ? 'All Tabs' : 'Current Page'} system content`);

    // Prepare messages array for Claude API - user and assistant messages only
    let messages = [];

    // Add conversation history if it exists (but don't include system messages)
    if (history && history.length > 0) {
        console.log('Adding conversation history, length:', history.length);
        messages = history.filter(msg => msg.role !== 'system').map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    // Add the user's question as the last user message
    messages.push({
        role: 'user',
        content: userQuestion
    });

    // Debug the message structure
    console.log('Number of messages being sent:', messages.length);
    messages.forEach((msg, index) => {
        console.log(`Message ${index + 1}:`,
            `role: ${msg.role}, `,
            `content starts with: ${msg.content.substring(0, 50)}...`);
    });

    try {
        console.log('Sending request to Claude API');
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-3-7-sonnet-latest',
                max_tokens: 1000,
                system: finalSystemContent,  // Use the selected system content
                messages: messages
            })
        });

        console.log('Claude API response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('API error response:', errorText);
            throw new Error(`API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        console.log('API response received successfully');
        console.log('Response starts with:', data.content[0].text.substring(0, 100) + '...');
        return data.content[0].text;
    } catch (error) {
        console.error('Error in Claude API call:', error);
        throw error;
    }
}