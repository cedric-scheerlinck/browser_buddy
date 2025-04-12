// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Get references to UI elements
  const scanButton = document.getElementById('scanPage');
  const statusDiv = document.getElementById('status');
  const textResultsDiv = document.getElementById('text-results');
  const toggleResultsButton = document.getElementById('toggleResults');
  
  // Add a click event listener to the button
  scanButton.addEventListener('click', async function() {
    // Update status
    statusDiv.textContent = "Scanning page...";
    statusDiv.style.backgroundColor = "#f8f9fa";
    
    // Clear previous results
    textResultsDiv.innerHTML = '';
    toggleResultsButton.style.display = 'none';
    
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      // Make sure we have a valid tab with a URL
      if (!tab) {
        statusDiv.textContent = "Error: Could not access the current tab.";
        statusDiv.style.backgroundColor = "#f8d7da";
        return;
      }
      
      // Check if we have access to the URL (Chrome doesn't provide URLs for some special pages)
      if (!tab.url) {
        statusDiv.textContent = "Cannot access this page. Try a regular website instead.";
        statusDiv.style.backgroundColor = "#fff3cd";
        return;
      }
      
      // Check if we're on a supported page (not chrome://, extension://, etc.)
      if (!tab.url.startsWith('http')) {
        statusDiv.textContent = "This extension can only scan web pages (http/https URLs).";
        statusDiv.style.backgroundColor = "#fff3cd";
        return;
      }
      
      // First check if content script is available by sending a ping
      try {
        const isAvailable = await checkContentScriptAvailable(tab.id);
        
        if (isAvailable) {
          // Content script is available, try message passing
          console.log("Content script is available, using message passing");
          const textBlocks = await scanUsingContentScript(tab.id, statusDiv);
          displayTextBlocks(textBlocks, textResultsDiv, toggleResultsButton);
        } else {
          // Content script is not available, inject it manually
          console.log("Content script not available, using executeScript fallback");
          const results = await injectContentScriptAsFallback(tab.id, statusDiv);
          if (results && results[0] && results[0].result) {
            displayTextBlocks(results[0].result, textResultsDiv, toggleResultsButton);
          }
        }
      } catch (error) {
        console.error("Error during availability check:", error);
        const results = await injectContentScriptAsFallback(tab.id, statusDiv);
        if (results && results[0] && results[0].result) {
          displayTextBlocks(results[0].result, textResultsDiv, toggleResultsButton);
        }
      }
    } catch (error) {
      statusDiv.textContent = "Error: " + error.message;
      statusDiv.style.backgroundColor = "#f8d7da";
      console.error("Error in scan button click handler:", error);
    }
  });
  
  // Add toggle functionality for showing/hiding text results
  toggleResultsButton.addEventListener('click', function() {
    if (textResultsDiv.style.display === 'none') {
      textResultsDiv.style.display = 'block';
      toggleResultsButton.textContent = 'Hide Text';
    } else {
      textResultsDiv.style.display = 'none';
      toggleResultsButton.textContent = 'Show Text';
    }
  });
});

// Function to display text blocks in the UI
function displayTextBlocks(textBlocks, container, toggleButton) {
  // Clear the container
  container.innerHTML = '';
  
  if (!textBlocks || textBlocks.length === 0) {
    container.innerHTML = '<p class="placeholder">No text blocks found on this page.</p>';
    return;
  }
  
  // Display up to 10 text blocks initially to not overwhelm the popup
  const initialBlocksToShow = Math.min(textBlocks.length, 10);
  
  for (let i = 0; i < initialBlocksToShow; i++) {
    const block = textBlocks[i];
    const blockElement = document.createElement('div');
    blockElement.className = 'text-block';
    
    // Truncate very long text blocks
    const text = block.text || block;
    const displayText = typeof text === 'string' ? 
      (text.length > 200 ? text.substring(0, 200) + '...' : text) : 
      'Invalid text block';
    
    blockElement.textContent = displayText;
    container.appendChild(blockElement);
  }
  
  // Add a message if there are more blocks
  if (textBlocks.length > initialBlocksToShow) {
    const moreMessage = document.createElement('p');
    moreMessage.textContent = `... and ${textBlocks.length - initialBlocksToShow} more text blocks`;
    moreMessage.style.fontStyle = 'italic';
    moreMessage.style.textAlign = 'center';
    container.appendChild(moreMessage);
  }
  
  // Show the toggle button
  toggleButton.style.display = 'inline-block';
  toggleButton.textContent = 'Hide Text';
}

// Check if the content script is available in the tab
function checkContentScriptAvailable(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { action: "ping" },
        function(response) {
          if (chrome.runtime.lastError) {
            console.log("Content script not found:", chrome.runtime.lastError.message);
            resolve(false);
            return;
          }
          
          resolve(response && response.success);
        }
      );
      
      // Set a timeout in case message passing hangs
      setTimeout(() => resolve(false), 300);
    } catch (error) {
      console.error("Error checking content script:", error);
      resolve(false);
    }
  });
}

// Scan using the content script via message passing
function scanUsingContentScript(tabId, statusDiv) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      tabId,
      { action: "extractText" },
      function(response) {
        if (chrome.runtime.lastError) {
          console.error("Error sending message:", chrome.runtime.lastError);
          statusDiv.textContent = "Error: Could not communicate with the page. Trying fallback method...";
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        
        // Handle response from content script
        if (response && response.success && response.textBlocks) {
          statusDiv.textContent = `Scanned ${response.textBlocks.length} text blocks on the page.`;
          console.log("First few text blocks:", response.textBlocks.slice(0, 3));
          resolve(response.textBlocks);
        } else if (response && response.error) {
          statusDiv.textContent = "Error: " + response.error;
          statusDiv.style.backgroundColor = "#f8d7da";
          reject(new Error(response.error));
        } else {
          statusDiv.textContent = "No text content found on the page.";
          resolve([]);
        }
      }
    );
    
    // Set a timeout for the message response
    setTimeout(() => {
      reject(new Error("Message timed out"));
    }, 5000);
  });
}

// Fallback function if content script is not injected or message passing fails
async function injectContentScriptAsFallback(tabId, statusDiv) {
  try {
    statusDiv.textContent = "Using direct script injection...";
    
    // Execute the content extraction directly
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      function: scanPageForAIContent
    });
    
    if (results && results[0]) {
      const textBlockCount = results[0].result.length;
      const blocks = results[0].result;
      statusDiv.textContent = `Scanned ${textBlockCount} text blocks on the page.`;
      console.log("First few text blocks (fallback):", blocks.slice(0, 3));
      return results;
    } else {
      statusDiv.textContent = "Scanning completed, but no results returned.";
      return null;
    }
  } catch (error) {
    console.error("Error in fallback script injection:", error);
    statusDiv.textContent = "Error: " + error.message;
    statusDiv.style.backgroundColor = "#f8d7da";
    throw error;
  }
}

// Fallback function that runs directly in the webpage context if needed
function scanPageForAIContent() {
  try {
    const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, span, div, article, section');
    const textContent = [];
    
    textElements.forEach(element => {
      const directText = Array.from(element.childNodes)
        .filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent.trim())
        .filter(text => text.length > 20)
        .join(' ');
      
      if (directText && directText.length > 0) {
        textContent.push({
          text: directText,
          // We can't return DOM elements, so just return the text
        });
      }
    });
    
    console.log(`Extracted ${textContent.length} text blocks in fallback mode`);
    for (let i = 0; i < textContent.length; i++) {
      console.log(`${JSON.stringify(textContent[i])}`);
    }
    return textContent;
  } catch (error) {
    console.error("Error in scanPageForAIContent:", error);
    return [];
  }
} 