// This script runs in the context of the web page
console.log("AI Content Detector: Content script loaded on " + window.location.href);

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
  
  textElements.forEach(element => {
    // Only include elements that have direct text (not just child element text)
    // and have a reasonable length (to filter out menu items, etc.)
    const directText = Array.from(element.childNodes)
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent.trim())
      .filter(text => text.length > 20)  // Only include text with more than 20 characters
      .join(' ');
    
    if (directText && directText.length > 0) {
      textContent.push({
        text: directText,
        element: element  // Store reference to the element for future highlighting
      });
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