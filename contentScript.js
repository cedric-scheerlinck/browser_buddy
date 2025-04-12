// This script runs in the context of the web page
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
      
      // Ensure the element is visible and can be styled
      element.style.display = 'block';
      element.style.position = 'relative';
      
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

// Function to highlight blocks based on Claude's response
function highlightBlocks(blocks, shouldHighlight, color) {
  console.log('Highlighting blocks:', {
    totalBlocks: blocks.length,
    blocksToHighlight: shouldHighlight.filter(Boolean).length,
    color: color
  });

  // First, check if our style element already exists
  let styleEl = document.getElementById('ai-detector-styles');
  
  // If not, create it
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ai-detector-styles';
    document.head.appendChild(styleEl);
  }
  
  // Create CSS rules for highlighted blocks
  const highlightedBlocks = blocks
    .filter((_, index) => shouldHighlight[index])
    .map(block => `.ai-content-block-${block.blockId}`)
    .join(', ');
  
  if (highlightedBlocks) {
    // Create more specific CSS rules to ensure they override any existing styles
    styleEl.textContent = `
      ${highlightedBlocks} {
        border: 3px solid ${color} !important;
        padding: 5px !important;
        transition: border-color 0.3s ease !important;
        position: relative !important;
        z-index: 1 !important;
        display: block !important;
        margin: 5px 0 !important;
        border-radius: 4px !important;
        box-sizing: border-box !important;
      }
    `;
    
    // Also add inline styles to the elements as a backup
    blocks.forEach((block, index) => {
      if (shouldHighlight[index]) {
        const element = block.element;
        if (element) {
          console.log(`Applying frame to block ${block.blockId}:`, element);
          
          // Ensure the element is properly styled
          element.style.display = 'block';
          element.style.position = 'relative';
          element.style.border = `3px solid ${color}`;
          element.style.padding = '5px';
          element.style.zIndex = '1';
          element.style.margin = '5px 0';
          element.style.borderRadius = '4px';
          element.style.boxSizing = 'border-box';
          
          // Force a reflow to ensure styles are applied
          element.offsetHeight;
        }
      }
    });
  } else {
    styleEl.textContent = '';
  }
}

// Function to analyze text with Claude API via background script
async function analyzeTextWithClaude(textBlocks, customPrompt = null, color) {
  try {
    // Analyze each block
    const results = [];
    for (let i = 0; i < textBlocks.length; i++) {
      const block = textBlocks[i];
      const blockId = block.blockId;
      const blockText = block.text;
      
      // Update status in popup
      chrome.runtime.sendMessage({
        action: "updateStatus",
        message: `Analyzing block ${i + 1}/${textBlocks.length}`
      });
      
      // Prepare the message to send to background script
      const message = {
        action: "analyzeWithClaude",
        blockText: blockText,
        blockId: blockId,
        prompt: customPrompt
      };
      
      // Send message to background script to perform the analysis
      const result = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, function(response) {
          if (chrome.runtime.lastError) {
            reject(new Error("Error communicating with background script: " + chrome.runtime.lastError.message));
            return;
          }
          
          if (response && response.success) {
            resolve(response.analysis);
          } else {
            reject(new Error(response ? response.error : "Unknown error from background script"));
          }
        });
      });
      
      // Parse the response to get a boolean value
      const responseText = result.content[0].text.toLowerCase();
      let shouldHighlight = false;
      
      // Check for various positive indicators in the response
      if (responseText.includes('true') || 
          responseText.includes('yes') || 
          responseText.includes('likely') ||
          responseText.includes('probably') ||
          responseText.includes('appears to be') ||
          responseText.includes('seems to be') ||
          responseText.includes('indicates')) {
        shouldHighlight = true;
      }
      
      // Check for confidence scores or percentages
      const confidenceMatch = responseText.match(/(\d+)%/);
      if (confidenceMatch) {
        const confidence = parseInt(confidenceMatch[1]);
        if (confidence >= 70) { // Only highlight if confidence is high
          shouldHighlight = true;
        } else {
          shouldHighlight = false;
        }
      }
      
      // Log the analysis details after determining shouldHighlight
      console.log(`\n=== Analysis for Block ${blockId} ===`);
      console.log('Text:', blockText.substring(0, 200) + '...'); // First 200 chars for readability
      console.log('Claude Response:', result.content[0].text);
      console.log('Highlight Decision:', shouldHighlight);
      console.log('===========================\n');
      
      // Highlight this block immediately if needed
      if (shouldHighlight) {
        const element = block.element;
        if (element) {
          console.log(`Applying frame to block ${block.blockId}:`, element);
          
          // Ensure the element is properly styled
          element.style.display = 'block';
          element.style.position = 'relative';
          element.style.border = `3px solid ${color}`;
          element.style.padding = '5px';
          element.style.zIndex = '1';
          element.style.margin = '5px 0';
          element.style.borderRadius = '4px';
          element.style.boxSizing = 'border-box';
          
          // Force a reflow to ensure styles are applied
          element.offsetHeight;
        }
      }
      
      results.push(shouldHighlight);
    }
    
    return results;
  } catch (error) {
    console.error("Error in analyzeTextWithClaude:", error);
    throw error;
  }
}

// Set up message listener to communicate with popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "extractText") {
    try {
      // Extract text from the page
      const textBlocks = getTextContent();
      
      // Send response back to popup
      sendResponse({
        success: true,
        textBlocks: textBlocks.map(item => ({
          text: item.text,
          blockId: item.blockId
        }))
      });
    } catch (error) {
      console.error("Error processing message:", error);
      sendResponse({ success: false, error: error.message });
    }
    
    return true;
  }
  
  // Respond to ping messages to check if content script is loaded
  if (message.action === "ping") {
    sendResponse({ success: true, message: "Content script is active" });
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
      
      // Call the Claude API for all blocks via background script
      analyzeTextWithClaude(textBlocks, message.prompt, message.color)
        .then(results => {
          sendResponse({
            success: true,
            analyzedBlocks: textBlocks.length,
            highlightedBlocks: results.filter(Boolean).length
          });
        })
        .catch(error => {
          sendResponse({
            success: false,
            error: error.message
          });
        });
      
      return true;
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