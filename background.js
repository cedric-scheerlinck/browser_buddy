// Background script for Browser Buddy

console.log('Browser Buddy background script loaded');

// Load environment variables
let apiKey = '';

// Function to load API key from .env file
async function loadApiKey() {
    try {
        const response = await fetch('/.env');
        const text = await response.text();
        const lines = text.split('\n');

        for (const line of lines) {
            if (line.startsWith('CLAUDE_API_KEY=')) {
                apiKey = line.substring('CLAUDE_API_KEY='.length).trim();
                console.log('API key loaded successfully');
                break;
            }
        }

        if (!apiKey) {
            console.error('Failed to load API key from .env file');
        }
    } catch (error) {
        console.error('Error loading API key:', error);
    }
}

// Load API key when background script starts
loadApiKey();

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background script received message:', message.action);

    if (message.action === 'callClaudeAPI') {
        callClaudeAPI(message.prompt, message.history)
            .then(response => {
                sendResponse({ success: true, data: response });
            })
            .catch(error => {
                console.error('Error calling Claude API:', error);
                sendResponse({ success: false, error: error.toString() });
            });

        // Return true to indicate we'll respond asynchronously
        return true;
    }
});

// Function to call Claude API
async function callClaudeAPI(prompt, history) {
    // Claude API endpoint
    const apiUrl = 'https://api.anthropic.com/v1/messages';

    // Ensure API key is loaded
    if (!apiKey) {
        await loadApiKey();
        if (!apiKey) {
            throw new Error('API key not available. Please check your .env file.');
        }
    }

    // Prepare messages array for Claude API
    // Format conversation history correctly for Claude's API
    let messages = [];

    // Add conversation history
    if (history && history.length > 0) {
        messages = history.map(msg => ({
            role: msg.role,
            content: msg.content
        }));
    }

    // Add the current prompt as the last user message if it's not already in history
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
        messages.push({
            role: 'user',
            content: prompt
        });
    }

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-3-7-sonnet-latest',
                max_tokens: 1000,
                messages: messages
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error (${response.status}): ${errorText}`);
        }

        const data = await response.json();
        return data.content[0].text;
    } catch (error) {
        console.error('Error in Claude API call:', error);
        throw error;
    }
} 