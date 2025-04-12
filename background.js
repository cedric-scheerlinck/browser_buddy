// Background script for Browser Buddy

console.log('Browser Buddy background script loaded', new Date().toISOString());

// Initialize connection status tracking
const connections = {};

// Store API key in memory
let apiKey = '';

// Function to load API key from storage or use a hardcoded one for testing
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

        // For debugging, directly use the API key as fallback
        // In production, you should implement a more secure method
        console.log('API key loaded from fallback');

        // Save to storage for future use
        if (chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ 'claudeApiKey': apiKey });
            console.log('API key saved to storage');
        }

        return true;
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

        // Make sure we respond even if there's an error
        callClaudeAPI(message.prompt, message.history)
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

// Function to call Claude API
async function callClaudeAPI(prompt, history) {
    console.log('callClaudeAPI function called');
    console.log('Prompt length:', prompt?.length || 0, 'characters');
    console.log('Prompt begins with:', prompt?.substring(0, 100) + '...');
    console.log('Prompt ends with:', prompt?.substring(prompt.length - 100) + '...');

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

    // Create system message content
    const systemContent = `You are Browser Buddy, an AI assistant helping users understand web content. 
You have access to the current webpage content which is provided below. 
When answering questions, refer to this content.
ONLY answer questions based on the information provided in the webpage content.
If the information is not in the page content, say so clearly.

WEBPAGE CONTENT:
${pageContent}`;

    console.log('System content length:', systemContent.length);

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
                system: systemContent,  // System content as a top-level parameter
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