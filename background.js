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
async function analyzeTextWithClaude(blockText, blockId, isDryRun = false) {
  try {
    // If this is a dry run, just log what would be sent and return
    if (isDryRun) {
      // Create the request object that would be sent
      const mockRequest = {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'sk-ant-api0x-would-be-real-key-in-actual-request',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': true
        },
        body: {
          model: "claude-3-7-sonnet-20250219",
          max_tokens: 1000,
          messages: [
            {
              role: "user",
              content: `Analyze the following text and determine if it appears to be AI-generated or human-written. 
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
        }
      };
      
      console.log("DRY RUN - Would analyze text block with Claude:");
      console.log(`Block ID: ${blockId}`);
      console.log("Complete API request that would be sent:", mockRequest);
      console.log(`Full text to analyze (${blockText.length} chars):`, blockText);
      
      // Return a mock response for dry run that includes the block ID
      return {
        dryRun: true,
        blockId: blockId,
        model: "claude-3-7-sonnet-20250219",
        content: [{ 
          text: `This is a dry run for block ID ${blockId}. No actual analysis was performed.\n\nIf this were a real analysis, Claude would determine whether the text appears to be AI-generated or human-written and provide a confidence score.`
        }]
      };
    }
    
    // Load API key for real requests
    const apiKey = await loadClaudeApiKey();
    
    if (!apiKey) {
      throw new Error("Failed to load Claude API key. Please check key.txt file.");
    }
    
    console.log(`Analyzing block ${blockId} with Claude...`);
    
    // Create the request configuration
    const requestConfig = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': true
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `Analyze the following text and determine if it appears to be AI-generated or human-written. 
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
    };
    
    // Log the complete request (with apiKey partially redacted for security)
    const logSafeConfig = JSON.parse(JSON.stringify(requestConfig));
    logSafeConfig.headers['x-api-key'] = apiKey.substring(0, 10) + '...[REDACTED]';
    console.log('Complete API request being sent:', {
      url: 'https://api.anthropic.com/v1/messages',
      ...logSafeConfig,
      // Also log parsed body for better readability
      parsedBody: JSON.parse(requestConfig.body)
    });
    
    // Prepare the request to Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', requestConfig);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const result = await response.json();
    
    // Add the block ID to the response
    result.blockId = blockId;
    
    // Log the full response for debugging
    console.log(`Claude analysis received for block ${blockId}:`);
    console.log("API Response:", result);
    
    return result;
  } catch (error) {
    console.error("Error analyzing text with Claude:", error);
    throw error;
  }
}

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background script received message:", message);
  console.log("Message sender:", sender.tab ? 
    `From content script at ${sender.tab.url}` : 
    "From extension popup or other context");
  
  if (message.action === "analyzeWithClaude") {
    // Extract data from message
    const { blockText, blockId, dryRun } = message;
    
    // Check if we have the necessary data
    if (!blockText) {
      console.error("No text provided to analyze");
      sendResponse({ 
        success: false, 
        error: "No text provided to analyze" 
      });
      return true;
    }
    
    console.log(`${dryRun ? "Dry run" : "Analysis"} requested for block ${blockId}`);
    console.log(`Text length: ${blockText.length} characters`);
    
    // Call the Claude API (or dry run)
    analyzeTextWithClaude(blockText, blockId, dryRun)
      .then(result => {
        console.log("Analysis complete, sending response back");
        const response = {
          success: true,
          analysis: result,
          blockId: result.blockId,
          dryRun: dryRun
        };
        console.log("Response summary:", {
          success: response.success,
          blockId: response.blockId,
          dryRun: response.dryRun,
          analysisTextPreview: result.content[0].text.substring(0, 100) + '...'
        });
        sendResponse(response);
      })
      .catch(error => {
        console.error("Analysis failed with error:", error);
        sendResponse({
          success: false,
          error: error.message
        });
      });
    
    return true; // Required for asynchronous sendResponse
  }
}); 