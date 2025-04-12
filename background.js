// Background script (service worker) for AI Content Detector
console.log("AI Content Detector background script loaded");

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

// Function to analyze text with Claude API
async function analyzeTextWithClaude(blockText, blockId, customPrompt = null) {
  try {
    // Get the API key
    const apiKey = await loadClaudeApiKey();
    
    if (!apiKey) {
      throw new Error("No API key found. Please add your Claude API key to key.txt");
    }
    
    console.log(`Analyzing block ${blockId} with Claude...`);
    
    // Prepare the request to Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': true
      },
      body: JSON.stringify({
        model: 'claude-3-7-sonnet-20250219',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: customPrompt ? 
              `${customPrompt}\n\nTEXT TO ANALYZE:\n${blockText}` :
              `Analyze the following text and determine if it appears to be AI-generated or human-written. 
              Consider factors like:
              - Repetitive patterns or phrasing
              - Overly formal or stilted language
              - Lack of personal voice or perspective
              - Unnatural transitions or flow
              
              Give a confidence score as a percentage for your determination, and explain your reasoning.
              
              TEXT TO ANALYZE:
              ${blockText}`
          }
        ]
      })
    });
    
    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log("Received response from Claude API");
    
    return {
      content: data.content,
      blockId: blockId
    };
  } catch (error) {
    console.error("Error in analyzeTextWithClaude:", error);
    throw error;
  }
}

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background script received message:", message);
  
  if (message.action === "analyzeWithClaude") {
    const { blockText, blockId, prompt } = message;
    
    console.log(`Analysis requested for block ${blockId}`);
    
    // Make sure we have all required parameters
    if (!blockText || blockId === undefined) {
      sendResponse({
        success: false,
        error: "Missing required parameters for analysis"
      });
      return true;
    }
    
    analyzeTextWithClaude(blockText, blockId, prompt)
      .then(result => {
        sendResponse({
          success: true,
          analysis: result,
          blockId: result.blockId
        });
      })
      .catch(error => {
        console.error("Error in analyzeTextWithClaude:", error);
        sendResponse({
          success: false,
          error: error.message
        });
      });
    
    return true; // Keep the message channel open for async response
  }
}); 