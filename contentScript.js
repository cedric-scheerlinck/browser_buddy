// This script runs in the context of the web page
console.log("AI Content Detector: Content script loaded on " + window.location.href);

// Global variable to store the API key once loaded
// let claudeApiKey = null;

// Function to load the Claude API key from key.txt
// We no longer need this here - it's handled in the background script

// Tell the extension that the content script is ready
try {
  chrome.runtime.sendMessage({ action: "contentScriptReady", url: window.location.href });
} catch (error) {
  console.error("Error sending ready message:", error);
}

// Function to extract all text from the DOM
function extractTextFromDOM() {
  // Get all text elements that might contain substantial content
  const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, span, div, article, section');
  
  // Store the text content of each element
  const textContent = [];
  let blockCounter = 0;
  
  // Helper function to recursively extract text from an element and its descendants
  function extractTextFromElement(element) {
    // First check if this element has enough direct text to be considered a block
    let elementText = "";
    let hasSubstantialText = false;
    
    // Get all text directly in this element (not in children)
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        const trimmedText = node.textContent.trim();
        if (trimmedText) {
          elementText += trimmedText + " ";
        }
      }
    }
    
    elementText = elementText.trim();
    
    // If the element has substantial direct text, add it as a block
    if (elementText.length >= 100) {
      hasSubstantialText = true;
      
      // Add a unique class to the element for later reference
      const uniqueClass = `ai-content-block-${blockCounter}`;
      
      // Preserve existing classes if they exist
      if (element.className) {
        // Check if the element already has the class (avoid duplicates)
        if (!element.className.includes(uniqueClass)) {
          element.className = element.className + ' ' + uniqueClass;
        }
      } else {
        element.className = uniqueClass;
      }
      
      textContent.push({
        text: elementText,
        element: element,  // Store reference to the element for future highlighting
        blockId: blockCounter  // Store the unique ID
      });
      
      blockCounter++;
    }
    
    // If this element doesn't have enough text of its own,
    // or if we want to also process children even if the parent has text,
    // recursively process child elements that aren't already processed
    if (!hasSubstantialText || true) {
      // Get child elements (not text nodes)
      const childElements = Array.from(element.children);
      
      for (const childElement of childElements) {
        // Skip script, style, and other non-content elements
        const tagName = childElement.tagName.toLowerCase();
        if (tagName === 'script' || tagName === 'style' || tagName === 'noscript' || 
            tagName === 'svg' || tagName === 'path' || tagName === 'iframe') {
          continue;
        }
        
        // Recursively extract text from the child element
        extractTextFromElement(childElement);
      }
    }
  }
  
  // Process each top-level element
  textElements.forEach(element => {
    // Skip elements that are children of elements we've already processed
    // (to avoid processing the same content multiple times)
    let isChildOfProcessed = false;
    let parent = element.parentElement;
    
    while (parent) {
      if (parent.className && parent.className.includes('ai-content-block-')) {
        isChildOfProcessed = true;
        break;
      }
      parent = parent.parentElement;
    }
    
    if (!isChildOfProcessed) {
      extractTextFromElement(element);
    }
  });
  
  console.log(`AI Content Detector: Found ${textContent.length} text blocks on the page`);
  return textContent;
}

// Store the extracted text for reuse
let cachedTextContent = null;

// Function to get text content, using cached version if available
function getTextContent() {
  if (!cachedTextContent) {
    cachedTextContent = extractTextFromDOM();
  }
  return cachedTextContent;
}

// Function to highlight odd-numbered blocks with a red background
function highlightOddBlocks() {
  const blocks = getTextContent();
  let styleAdded = false;
  
  // First, check if our style element already exists
  let styleEl = document.getElementById('ai-detector-styles');
  
  // If not, create it
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ai-detector-styles';
    document.head.appendChild(styleEl);
  }
  
  // Set the CSS content to highlight odd blocks
  styleEl.textContent = `
    ${Array.from({ length: Math.ceil(blocks.length / 2) }, (_, i) => 
      `.ai-content-block-${i * 2 + 1}`).join(', ')} {
      background-color: rgba(255, 0, 0, 0.2) !important;
      border: 1px solid red !important;
      padding: 5px !important;
      transition: background-color 0.3s ease !important;
    }
  `;
  
  console.log("Applied red background to odd-numbered blocks");
  return blocks.length;
}

// Function to reset all highlighting
function resetHighlighting() {
  const styleEl = document.getElementById('ai-detector-styles');
  if (styleEl) {
    styleEl.textContent = '';
  }
  console.log("Reset all block highlighting");
}

// Function to analyze text with Claude API via background script
async function analyzeTextWithClaude(textBlocks, isDryRun = false) {
  try {
    // Only analyze the first block for simplicity
    const blockToAnalyze = textBlocks[0];
    
    if (!blockToAnalyze || !blockToAnalyze.text) {
      throw new Error("No text to analyze");
    }
    
    // Extract the block ID to associate with the response
    const blockId = blockToAnalyze.blockId;
    const blockText = blockToAnalyze.text;
    
    console.log(`Requesting analysis for block ${blockId}${isDryRun ? " (dry run)" : ""}...`);
    
    // Prepare the message to send to background script
    const message = {
      action: "analyzeWithClaude",
      blockText: blockText,
      blockId: blockId,
      dryRun: isDryRun
    };
    
    // Log what we're sending to the background script
    console.log("Sending request to background script:", {
      ...message,
      blockTextPreview: blockText.length > 100 ? 
        blockText.substring(0, 100) + '...' : blockText
    });
    
    // Send message to background script to perform the analysis
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, function(response) {
        if (chrome.runtime.lastError) {
          console.error("Error communicating with background script:", chrome.runtime.lastError);
          reject(new Error("Error communicating with background script: " + chrome.runtime.lastError.message));
          return;
        }
        
        if (response && response.success) {
          console.log("Received successful response from background script");
          resolve(response.analysis);
        } else {
          console.error("Received error response from background script:", response?.error || "Unknown error");
          reject(new Error(response ? response.error : "Unknown error from background script"));
        }
      });
    });
  } catch (error) {
    console.error("Error in analyzeTextWithClaude:", error);
    throw error;
  }
}

// Set up message listener to communicate with popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received message:", message);
  
  if (message.action === "extractText") {
    try {
      // Extract text from the page
      const textBlocks = getTextContent();
      
      // Send response back to popup
      sendResponse({
        success: true,
        textBlocks: textBlocks.map(item => ({
          text: item.text,
          blockId: item.blockId,
          // We can't send DOM elements through messages, so we're excluding the element property
          // We'll handle highlighting separately later
        }))
      });
    } catch (error) {
      console.error("Error processing message:", error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true; // Required for asynchronous sendResponse
  }
  
  // Respond to ping messages to check if content script is loaded
  if (message.action === "ping") {
    sendResponse({ success: true, message: "Content script is active" });
    return true;
  }
  
  // Handle highlighting odd blocks
  if (message.action === "highlightOdd") {
    try {
      const blocksCount = highlightOddBlocks();
      sendResponse({ 
        success: true, 
        message: `Highlighted odd-numbered blocks with red background`,
        count: blocksCount 
      });
    } catch (error) {
      console.error("Error highlighting odd blocks:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
  
  // Handle resetting highlighting
  if (message.action === "resetHighlighting") {
    try {
      resetHighlighting();
      sendResponse({ success: true, message: "Reset all highlighting" });
    } catch (error) {
      console.error("Error resetting highlighting:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }
  
  // Handle analyzing text with Claude
  if (message.action === "analyzeWithClaude") {
    try {
      // Get the text blocks
      const textBlocks = getTextContent();
      
      if (!textBlocks || textBlocks.length === 0) {
        sendResponse({ 
          success: false, 
          error: "No text blocks found to analyze" 
        });
        return true;
      }
      
      // Check if this is a dry run
      const isDryRun = message.dryRun === true;
      
      console.log(`${isDryRun ? "Dry run" : "Analysis"} requested for the first text block`);
      
      // Call the Claude API (or dry run) for the first block only via background script
      analyzeTextWithClaude(textBlocks, isDryRun)
        .then(result => {
          sendResponse({
            success: true,
            analysis: result,
            blockId: result.blockId,
            blockCount: textBlocks.length,
            dryRun: isDryRun
          });
        })
        .catch(error => {
          sendResponse({
            success: false,
            error: error.message
          });
        });
      
      return true; // Required for asynchronous sendResponse
    } catch (error) {
      console.error("Error processing analyze request:", error);
      sendResponse({ success: false, error: error.message });
      return true;
    }
  }
});

// Run when the page loads
document.addEventListener('DOMContentLoaded', () => {
  // Pre-cache the text content
  getTextContent();
  
  // For now, just log the first few text blocks to the console
  console.log("Text content samples:");
  const pageText = getTextContent();
  pageText.slice(0, 3).forEach((item, index) => {
    console.log(`Block ${index + 1}: ${item.text.substring(0, 100)}...`);
  });
});

// Also run for dynamically loaded pages or single page applications
window.addEventListener('load', () => {
  // Reset cache and extract text again after a delay
  setTimeout(() => {
    cachedTextContent = null;
    getTextContent();
    // Announce again after the page has fully loaded
    try {
      chrome.runtime.sendMessage({ action: "contentScriptReady", url: window.location.href, status: "loaded" });
    } catch (error) {
      console.error("Error sending ready message on load:", error);
    }
  }, 1000); // Small delay to ensure content is loaded
}); 