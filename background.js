/**
 * Browser Buddy - Background Script
 * 
 * This script handles communication between content scripts and the Claude API.
 * It manages connections, API keys, and system prompts.
 */

// ==================== GLOBAL STATE ====================

// API and prompt settings
let apiKey = '';
let systemPrompt = '';

// Tab connection tracking
const connections = {};

// ==================== INITIALIZATION ====================

/**
 * Initialize the background script
 * Loads API key, system prompt, and sets up ping
 */
async function initialize() {
  console.log('Browser Buddy background script loaded', new Date().toISOString());
  
  try {
    await loadApiKey();
    await loadSystemPrompt();
    console.log('Initialization complete');
    
    // Set up regular pings to maintain content script connections
    pingContentScripts(); // Initial ping
    setInterval(pingContentScripts, 15000);
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Run initialization on script load
initialize();

// ==================== STORAGE AND CONFIGURATION ====================

/**
 * Load API key from Chrome storage
 * @returns {Promise<boolean>} Success status
 */
async function loadApiKey() {
  console.log('Loading API key');

  try {
    // Try to get from Chrome storage
    if (chrome.storage && chrome.storage.local) {
      const data = await chrome.storage.local.get('claudeApiKey');
      if (data && data.claudeApiKey) {
        apiKey = data.claudeApiKey;
        console.log('API key loaded from storage');
        return true;
      }
    }

    // If we reach here, no API key was found
    console.warn('No API key found in storage');
    return false;
  } catch (error) {
    console.error('Error loading API key:', error);
    return false;
  }
}

/**
 * Load system prompt from system_prompt.md
 * @returns {Promise<boolean>} Success status
 */
async function loadSystemPrompt() {
  console.log('Loading system prompt');
  
  try {
    const response = await fetch('/system_prompt.md');
    if (!response.ok) {
      throw new Error(`Failed to load system prompt: ${response.status}`);
    }
    
    systemPrompt = await response.text();
    console.log('System prompt loaded successfully, length:', systemPrompt.length);
    return true;
  } catch (error) {
    console.error('Error loading system prompt:', error);
    systemPrompt = ''; // Set to empty string in case of error
    return false;
  }
}

// ==================== CONNECTION MANAGEMENT ====================

/**
 * Ping all content scripts to maintain connections
 */
function pingContentScripts() {
  chrome.tabs.query({}, tabs => {
    tabs.forEach(tab => {
      try {
        chrome.tabs.sendMessage(tab.id, { action: "backgroundAlive" })
          .catch(err => {
            // This is expected for tabs without content scripts
            // console.log(`Cannot reach tab ${tab.id}:`, err.message);
          });
      } catch (e) {
        // Ignore errors for tabs that can't be messaged
      }
    });
  });
}

// ==================== MESSAGE HANDLING ====================

/**
 * Handle connections from tabs
 */
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

/**
 * Handle messages from content scripts
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  const action = message.action || 'unknown';
  
  console.log(`Message received from tab ${tabId}: ${action}`);

  // Handle different message types
  switch (action) {
    case 'ping':
      handlePing(sendResponse);
      return false; // Synchronous response
      
    case 'callClaudeAPI':
      handleClaudeAPICall(message, sendResponse);
      return true; // Asynchronous response
      
    default:
      console.log('No handler for message action:', action);
      sendResponse({ success: false, error: 'Unknown action' });
      return false;
  }
});

/**
 * Handle ping message for connection testing
 * @param {Function} sendResponse - Response callback
 */
function handlePing(sendResponse) {
  console.log('Received ping, sending pong');
  sendResponse({ success: true, action: 'pong' });
}

/**
 * Handle Claude API call request
 * @param {Object} message - Message with prompt and webpage content
 * @param {Function} sendResponse - Response callback
 */
function handleClaudeAPICall(message, sendResponse) {
  console.log('Handling Claude API call');
  
  // Validate required fields
  if (!message.prompt) {
    sendResponse({ success: false, error: 'Missing required field: prompt' });
    return;
  }
  
  // Log request details (abbreviated)
  console.log('Prompt (first 30 chars):', message.prompt?.substring(0, 30) + '...');
  console.log('Webpage content sections:', message.webpageContent?.length || 0);

  // Call Claude API
  callClaudeAPI(message.prompt, message.webpageContent)
    .then(response => {
      console.log('Claude API response received');
      sendResponse({ success: true, data: response });
    })
    .catch(error => {
      console.error('Error calling Claude API:', error);
      sendResponse({ 
        success: false, 
        error: error.toString(),
        message: 'Failed to get response from Claude API'
      });
    });
}

// ==================== CLAUDE API INTEGRATION ====================

/**
 * Call Claude API with the given prompt and webpage content
 * @param {string} prompt - The user's question/prompt
 * @param {string[]} webpageContent - Array of webpage content sections
 * @returns {Promise<string>} - Claude's response
 */
async function callClaudeAPI(prompt, webpageContent) {
  console.log('Calling Claude API');
  
  // Claude API endpoint
  const apiUrl = 'https://api.anthropic.com/v1/messages';

  // Ensure API key is loaded
  if (!apiKey) {
    console.log('API key not found, attempting to load');
    const loaded = await loadApiKey();
    if (!loaded || !apiKey) {
      throw new Error('API key not available. Please check your configuration.');
    }
  }

  // Ensure system prompt is loaded
  if (!systemPrompt) {
    console.log('System prompt not found, attempting to load');
    await loadSystemPrompt();
    if (!systemPrompt) {
      console.warn('System prompt could not be loaded, using default');
      systemPrompt = 'You are Browser Buddy, an AI assistant helping users understand web content.';
    }
  }

  // Process webpage content
  const pageContentText = Array.isArray(webpageContent) 
    ? webpageContent.join('\n') 
    : webpageContent || '';
  
  // Format webpage content with XML structure
  let formattedWebpageContent = '<documents>\n';
  
  if (Array.isArray(webpageContent) && webpageContent.length > 0) {
    webpageContent.forEach((content, index) => {
      formattedWebpageContent += `  <document index="${index + 1}">
    <source>webpage_content</source>
    <document_content>
      ${content}
    </document_content>
  </document>\n`;
    });
  } else {
    // Fallback if webpageContent is not an array or is empty
    formattedWebpageContent += `  <document index="1">
    <source>webpage_content</source>
    <document_content>
      ${pageContentText}
    </document_content>
  </document>\n`;
  }
  
  formattedWebpageContent += '</documents>';
  
  // Log configuration details
  console.log('API endpoint:', apiUrl);
  console.log('API key available (first 4 chars):', apiKey.substring(0, 4) + '...');
  console.log('System prompt length:', systemPrompt.length);
  console.log('Documents content length:', formattedWebpageContent.length);

  // Prepare request payload
  const requestBody = {
    model: 'claude-3-7-sonnet-latest',
    max_tokens: 1000,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: {type: "ephemeral"}
      },
      {
        type: "text",
        text: formattedWebpageContent,
        cache_control: {type: "ephemeral"}
      }
    ],
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ],
    cache_control: {
      save_history: true
    }
  };

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
      body: JSON.stringify(requestBody)
    });

    console.log('Claude API response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('API error response:', errorText);
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    console.log('API response received successfully');
    
    if (!data.content || !data.content[0] || !data.content[0].text) {
      throw new Error('Invalid response format from Claude API');
    }
    
    console.log('Response length:', data.content[0].text.length);
    return data.content[0].text;
  } catch (error) {
    console.error('Error in Claude API call:', error);
    throw error;
  }
} 