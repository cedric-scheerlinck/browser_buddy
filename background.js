// Background script for Browser Buddy

console.log('Browser Buddy background script loaded');

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

    // API key from environment (in production, you would securely store this)
    // Note: This is an example. In practice, you would need more secure API key management
    const apiKey = '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';

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
                model: 'claude-3-haiku-20240307',
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