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
async function analyzeTextWithClaude(textBlocks, isDryRun = false, blockCount = 1) {
  try {
    // Ensure blockCount is at least 1 and not more than available blocks
    blockCount = Math.max(1, Math.min(blockCount, textBlocks.length));
    
    // Select the blocks to analyze (take the first N blocks based on blockCount)
    const blocksToAnalyze = textBlocks.slice(0, blockCount);
    
    console.log(`Analyzing ${blockCount} blocks${isDryRun ? " (dry run)" : ""} in parallel...`);
    
    // Create an array of promises for each block analysis
    const analysisPromises = blocksToAnalyze.map(async (blockToAnalyze, index) => {
      if (!blockToAnalyze || !blockToAnalyze.text) {
        console.warn(`Block at index ${index} has no text, skipping`);
        return null;
      }
      
      // Extract the block ID to associate with the response
      const blockId = blockToAnalyze.blockId;
      const blockText = blockToAnalyze.text;
      
      console.log(`Requesting analysis for block ${blockId} (${index+1}/${blockCount})${isDryRun ? " (dry run)" : ""}...`);
      
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
      try {
        return await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(message, function(response) {
            if (chrome.runtime.lastError) {
              console.error("Error communicating with background script:", chrome.runtime.lastError);
              reject(new Error("Error communicating with background script: " + chrome.runtime.lastError.message));
              return;
            }
            
            if (response && response.success) {
              console.log(`Received successful response from background script for block ${blockId}`);
              resolve(response.analysis);
            } else {
              console.error("Received error response from background script:", response?.error || "Unknown error");
              reject(new Error(response ? response.error : "Unknown error from background script"));
            }
          });
        });
      } catch (error) {
        console.error(`Error analyzing block ${blockId}:`, error);
        return null; // Return null for failed blocks so we can filter them out later
      }
    });
    
    // Wait for all analysis promises to resolve
    const results = await Promise.all(analysisPromises);
    
    // Filter out null results (from blocks that failed or were skipped)
    const validResults = results.filter(result => result !== null);
    
    console.log(`Completed parallel analysis of ${validResults.length} blocks`);
    return validResults;
  } catch (error) {
    console.error("Error in analyzeTextWithClaude:", error);
    throw error;
  }
}

// Function to highlight a block based on its AI confidence score
function highlightBlockWithScore(blockId, score) {
  // First, find our style element or create it if it doesn't exist
  let styleEl = document.getElementById('ai-detector-styles');
  
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ai-detector-styles';
    document.head.appendChild(styleEl);
  }
  
  // Determine the color based on the score
  let backgroundColor, borderColor;
  
  if (score <= 50) {
    backgroundColor = 'rgba(39, 174, 96, 0.2)'; // Green with transparency
    borderColor = '#27ae60';
  } else if (score <= 75) {
    backgroundColor = 'rgba(243, 156, 18, 0.2)'; // Yellow with transparency
    borderColor = '#f39c12';
  } else {
    backgroundColor = 'rgba(231, 76, 60, 0.2)'; // Red with transparency
    borderColor = '#e74c3c';
  }
  
  // Create a specific style for this block
  const blockClass = `.ai-content-block-${blockId}`;
  const scoreStyle = `
    ${blockClass} {
      background-color: ${backgroundColor} !important;
      border: 2px solid ${borderColor} !important;
      border-radius: 4px !important;
      padding: 5px !important;
      transition: background-color 0.3s ease !important;
      position: relative !important;
    }
    
    ${blockClass}::after {
      content: "AI: ${score}%";
      position: absolute;
      top: 0;
      right: 0;
      background-color: ${borderColor};
      color: white;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: bold;
      border-bottom-left-radius: 4px;
    }
  `;
  
  // Add the style to our style element
  // Keep any existing styles for other blocks
  const existingStyles = styleEl.textContent;
  if (!existingStyles.includes(blockClass)) {
    styleEl.textContent = existingStyles + scoreStyle;
  } else {
    // Replace existing style for this block
    const regex = new RegExp(`${blockClass} \\{[^}]+\\}\\s*${blockClass}::after \\{[^}]+\\}`, 'g');
    styleEl.textContent = existingStyles.replace(regex, scoreStyle);
  }
  
  console.log(`Highlighted block ${blockId} with score ${score}%`);
  
  // Scroll to the block to make it visible
  const blockElement = document.querySelector(blockClass);
  if (blockElement) {
    blockElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  
  return true;
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
      
      // Get the number of blocks to analyze
      const blockCount = message.blockCount || 1;
      
      console.log(`${isDryRun ? "Dry run" : "Analysis"} requested for ${blockCount} text block(s) in parallel`);
      
      // Call the Claude API (or dry run) for the specified number of blocks via background script
      analyzeTextWithClaude(textBlocks, isDryRun, blockCount)
        .then(results => {
          sendResponse({
            success: true,
            analysis: results,
            blockCount: textBlocks.length,
            analyzedCount: results.length,
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
  
  // Add a handler for the highlightBlockWithScore message
  if (message.action === "highlightBlockWithScore") {
    try {
      const result = highlightBlockWithScore(message.blockId, message.score);
      sendResponse({ success: true, message: `Highlighted block ${message.blockId} with score ${message.score}%` });
    } catch (error) {
      console.error("Error highlighting block with score:", error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
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