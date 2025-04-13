// Wait for the DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Get references to UI elements
  const scanButton = document.getElementById('scanPage');
  const statusDiv = document.getElementById('status');
  const textResultsDiv = document.getElementById('text-results');
  const toggleResultsButton = document.getElementById('toggleResults');
  const highlightOddButton = document.getElementById('highlightOdd');
  const analyzeWithClaudeButton = document.getElementById('analyzeWithClaude');
  const actionsDiv = document.getElementById('actions');
  const analysisContainer = document.getElementById('analysis-container');
  const analysisResultsDiv = document.getElementById('analysis-results');
  const popoutButton = document.getElementById('popoutButton');
  
  // Variable to store the text blocks from the most recent scan
  let latestTextBlocks = [];
  
  // Add a click event listener to the scan button
  scanButton.addEventListener('click', async function() {
    // Update status
    statusDiv.textContent = "Scanning page...";
    statusDiv.style.backgroundColor = "#f8f9fa";
    
    // Clear previous results
    textResultsDiv.innerHTML = '';
    toggleResultsButton.style.display = 'none';
    actionsDiv.style.display = 'none';
    
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
          
          // Show actions div after successful scan
          actionsDiv.style.display = 'block';
        } else {
          // Content script is not available, inject it manually
          console.log("Content script not available, using executeScript fallback");
          const results = await injectContentScriptAsFallback(tab.id, statusDiv);
          if (results && results[0] && results[0].result) {
            displayTextBlocks(results[0].result, textResultsDiv, toggleResultsButton);
            
            // Show actions div after successful scan
            actionsDiv.style.display = 'block';
          }
        }
      } catch (error) {
        console.error("Error during availability check:", error);
        const results = await injectContentScriptAsFallback(tab.id, statusDiv);
        if (results && results[0] && results[0].result) {
          displayTextBlocks(results[0].result, textResultsDiv, toggleResultsButton);
          
          // Show actions div after successful scan
          actionsDiv.style.display = 'block';
        }
      }
    } catch (error) {
      statusDiv.textContent = "Error: " + error.message;
      statusDiv.style.backgroundColor = "#f8d7da";
      console.error("Error in scan button click handler:", error);
    }
  });
  
  // Add highlight odd blocks functionality
  highlightOddButton.addEventListener('click', async function() {
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        statusDiv.textContent = "Error: Could not access the current tab.";
        statusDiv.style.backgroundColor = "#f8d7da";
        return;
      }
      
      // Check if we're in highlight or reset mode
      const isResetMode = highlightOddButton.dataset.mode === "reset";
      
      // Update button text to indicate processing
      highlightOddButton.textContent = isResetMode ? "Resetting..." : "Highlighting...";
      highlightOddButton.disabled = true;
      
      // Send appropriate message to content script
      const action = isResetMode ? "resetHighlighting" : "highlightOdd";
      
      chrome.tabs.sendMessage(
        tab.id,
        { action: action },
        function(response) {
          if (chrome.runtime.lastError) {
            console.error(`Error sending ${action} message:`, chrome.runtime.lastError);
            statusDiv.textContent = `Error: Failed to ${isResetMode ? 'reset' : 'highlight'} blocks. ${chrome.runtime.lastError.message}`;
            statusDiv.style.backgroundColor = "#f8d7da";
            
            // Reset button to appropriate state
            highlightOddButton.textContent = isResetMode ? "Reset Highlighting" : "Highlight Odd Blocks";
            highlightOddButton.disabled = false;
            return;
          }
          
          if (response && response.success) {
            if (isResetMode) {
              // Change button back to "Highlight Odd Blocks"
              highlightOddButton.textContent = "Highlight Odd Blocks";
              highlightOddButton.dataset.mode = "highlight";
            } else {
              // Change button to "Reset Highlighting"
              highlightOddButton.textContent = "Reset Highlighting";
              highlightOddButton.dataset.mode = "reset";
            }
            
            highlightOddButton.disabled = false;
            
            // Update status
            statusDiv.textContent = response.message;
            statusDiv.style.backgroundColor = "#d4edda";
          } else {
            // Reset button to appropriate state
            highlightOddButton.textContent = isResetMode ? "Reset Highlighting" : "Highlight Odd Blocks";
            highlightOddButton.disabled = false;
            
            // Update status with error
            statusDiv.textContent = `Error: Failed to ${isResetMode ? 'reset' : 'highlight'} blocks.`;
            statusDiv.style.backgroundColor = "#f8d7da";
          }
        }
      );
    } catch (error) {
      console.error("Error in highlight button handler:", error);
      statusDiv.textContent = "Error: " + error.message;
      statusDiv.style.backgroundColor = "#f8d7da";
      
      // Reset button to default state
      highlightOddButton.textContent = "Highlight Odd Blocks";
      highlightOddButton.dataset.mode = "highlight";
      highlightOddButton.disabled = false;
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
  
  // Add analyze with Claude functionality
  analyzeWithClaudeButton.addEventListener('click', async function() {
    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab) {
        statusDiv.textContent = "Error: Could not access the current tab.";
        statusDiv.style.backgroundColor = "#f8d7da";
        return;
      }
      
      // Check if dry run is enabled
      const isDryRun = document.getElementById('dryRunOption').checked;
      
      // Get the number of blocks to analyze
      const blocksToAnalyze = parseInt(document.getElementById('blockCount').value, 10) || 1;
      
      // Update status
      statusDiv.textContent = isDryRun 
        ? `Analyzing ${blocksToAnalyze} text block(s) with Claude (Dry Run)...` 
        : `Analyzing ${blocksToAnalyze} text block(s) with Claude...`;
      statusDiv.style.backgroundColor = "#fff3cd";
      
      // Disable button during analysis
      analyzeWithClaudeButton.disabled = true;
      
      // Send message to content script to analyze text
      chrome.tabs.sendMessage(
        tab.id,
        { 
          action: "analyzeWithClaude", 
          dryRun: isDryRun,
          blockCount: blocksToAnalyze 
        },
        function(response) {
          // Re-enable button
          analyzeWithClaudeButton.disabled = false;
          
          if (chrome.runtime.lastError) {
            console.error("Error sending analyze message:", chrome.runtime.lastError);
            statusDiv.textContent = "Error: Failed to communicate with Claude. " + chrome.runtime.lastError.message;
            statusDiv.style.backgroundColor = "#f8d7da";
            return;
          }
          
          if (response && response.success) {
            // Show the analysis
            statusDiv.textContent = isDryRun
              ? `Dry run complete for ${response.analyzedCount} block(s)! Check console for details.`
              : `Analysis complete for ${response.analyzedCount} block(s)!`;
            statusDiv.style.backgroundColor = "#d4edda";
            
            // Display the analysis results (for both dry run and real results)
            displayAnalysisResults(response.analysis);
            
            // Also log the response to console
            console.log(isDryRun ? "Dry run response:" : "Claude API response:", response.analysis);
          } else {
            // Show error
            statusDiv.textContent = "Error: " + (response ? response.error : "Unknown error");
            statusDiv.style.backgroundColor = "#f8d7da";
          }
        }
      );
    } catch (error) {
      console.error("Error in analyze button handler:", error);
      statusDiv.textContent = "Error: " + error.message;
      statusDiv.style.backgroundColor = "#f8d7da";
      analyzeWithClaudeButton.disabled = false;
    }
  });
  
  // Add popout button functionality
  popoutButton.addEventListener('click', async function() {
    try {
      // Create a new window with popup content
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 600,
        height: 700
      });
    } catch (error) {
      console.error("Error opening popup window:", error);
      statusDiv.textContent = "Error opening popup window: " + error.message;
      statusDiv.style.backgroundColor = "#f8d7da";
    }
  });
  
  // Function to display Claude's analysis results
  function displayAnalysisResults(analysis) {
    try {
      // Show the analysis container
      analysisContainer.style.display = 'block';
      
      // Clear previous results
      analysisResultsDiv.innerHTML = '';
      
      // Check if we have an array of analyses or a single analysis
      const analysisArray = Array.isArray(analysis) ? analysis : [analysis];
      
      // Process each analysis result
      analysisArray.forEach(analysisItem => {
        // Get the content from Claude's response
        const analysisText = analysisItem.content[0].text;
        
        // Extract the confidence score using regex
        let confidenceScore = null;
        const scoreRegex = /(\d+)%/g;
        const matches = [...analysisText.matchAll(scoreRegex)];
        
        // If we found matches, use the last one (which should be the final score)
        if (matches.length > 0) {
          const lastMatch = matches[matches.length - 1];
          confidenceScore = parseInt(lastMatch[1], 10);
          console.log(`Extracted confidence score: ${confidenceScore}%`);
        } else {
          // Alternative: try to get the last word if it ends with %
          const words = analysisText.trim().split(/\s+/);
          const lastWord = words[words.length - 1];
          if (lastWord.endsWith('%')) {
            confidenceScore = parseInt(lastWord.replace('%', ''), 10);
            console.log(`Extracted confidence score from last word: ${confidenceScore}%`);
          }
        }
        
        // Get the block ID if available
        const blockId = analysisItem.blockId !== undefined ? analysisItem.blockId : 'unknown';
        
        // Create a heading showing which block was analyzed
        const blockHeading = document.createElement('h3');
        blockHeading.className = 'block-id-heading';
        blockHeading.textContent = `Analysis of Block #${blockId}`;
        analysisResultsDiv.appendChild(blockHeading);
        
        // Create a div for the analysis
        const analysisDiv = document.createElement('div');
        analysisDiv.className = 'claude-analysis';
        
        // Add confidence score display if found
        if (confidenceScore !== null) {
          // Determine background color based on score
          let scoreColor;
          let textColor = 'white';
          
          if (confidenceScore <= 50) {
            scoreColor = '#27ae60'; // Green (low AI probability)
          } else if (confidenceScore <= 75) {
            scoreColor = '#f39c12'; // Yellow (medium AI probability)
          } else {
            scoreColor = '#e74c3c'; // Red (high AI probability)
          }
          
          // Create confidence score display
          const scoreDisplay = document.createElement('div');
          scoreDisplay.className = 'confidence-score';
          scoreDisplay.style.backgroundColor = scoreColor;
          scoreDisplay.style.color = textColor;
          scoreDisplay.style.padding = '10px';
          scoreDisplay.style.marginBottom = '15px';
          scoreDisplay.style.borderRadius = '5px';
          scoreDisplay.style.textAlign = 'center';
          scoreDisplay.style.fontWeight = 'bold';
          scoreDisplay.innerHTML = `AI Confidence Score: <span style="font-size: 1.2em;">${confidenceScore}%</span>`;
          
          // Add score display to the analysis div
          analysisDiv.appendChild(scoreDisplay);
        }
        
        // Add the full analysis text
        const textDiv = document.createElement('div');
        textDiv.innerHTML = `<p>${analysisText.replace(/\n/g, '<br>')}</p>`;
        analysisDiv.appendChild(textDiv);
        
        // Add to the results div
        analysisResultsDiv.appendChild(analysisDiv);
        
        // Add a separator between analyses if not the last one
        if (analysisItem !== analysisArray[analysisArray.length - 1]) {
          const separator = document.createElement('hr');
          separator.style.margin = '20px 0';
          analysisResultsDiv.appendChild(separator);
        }
        
        // If we have a confidence score, also update the block's style on the page
        if (confidenceScore !== null && analysisItem.blockId !== undefined && !analysisItem.dryRun) {
          // Send message to content script to highlight the block
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, {
                action: "highlightBlockWithScore",
                blockId: analysisItem.blockId,
                score: confidenceScore
              });
            }
          });
        }
      });
      
      // Scroll to the analysis container
      analysisContainer.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      console.error("Error displaying analysis results:", error);
      analysisResultsDiv.innerHTML = `<p class="error">Error displaying analysis: ${error.message}</p>`;
    }
  }
  
  // When displaying text blocks, store them for later use
  const originalDisplayTextBlocks = displayTextBlocks;
  displayTextBlocks = function(textBlocks, container, toggleButton) {
    // Store the text blocks for potential Claude analysis
    latestTextBlocks = textBlocks;
    
    // Call the original function
    originalDisplayTextBlocks(textBlocks, container, toggleButton);
  };
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
    // This is a simplified version of extractTextFromDOM in contentScript.js
    const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, span, div, article, section');
    const textContent = [];
    let blockCounter = 0;
    
    // Helper function to recursively extract text from an element and its descendants
    function extractTextFromElement(element) {
      // First check if this element has enough direct text to be considered a block
      let elementText = "";
      
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
        // Add a unique class to the element for later reference
        const uniqueClass = `ai-content-block-${blockCounter}`;
        
        // Add class to element
        if (!element.className.includes(uniqueClass)) {
          element.className = element.className ? element.className + ' ' + uniqueClass : uniqueClass;
        }
        
        textContent.push({
          text: elementText,
          blockId: blockCounter
        });
        
        blockCounter++;
      }
      
      // Process child elements
      Array.from(element.children).forEach(childElement => {
        // Skip non-content elements
        const tagName = childElement.tagName.toLowerCase();
        if (!['script', 'style', 'noscript', 'svg', 'path', 'iframe'].includes(tagName)) {
          extractTextFromElement(childElement);
        }
      });
    }
    
    // Process each top-level element, skipping those that are children of processed elements
    textElements.forEach(element => {
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
    
    console.log(`Extracted ${textContent.length} text blocks in fallback mode`);
    return textContent;
  } catch (error) {
    console.error("Error in scanPageForAIContent:", error);
    return [];
  }
} 