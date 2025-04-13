console.log("Browser Buddy Chat Script Loaded!");

// --- Connection to background script ---
let isBackgroundConnected = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 5;
let connectionPort;

// Connect to the background script
function connectToBackground() {
  try {
    connectionPort = chrome.runtime.connect({ name: "chat-connection" });

    connectionPort.onDisconnect.addListener(() => {
      console.log("Connection to background lost, attempting to reconnect...");
      isBackgroundConnected = false;
      setTimeout(tryReconnect, 1000); // Try to reconnect after 1 second
    });

    // Ping the background script to verify connection
    pingBackground();
  } catch (error) {
    console.error("Failed to connect to background script:", error);
    setTimeout(tryReconnect, 1000);
  }
}

// Try to reconnect to background
function tryReconnect() {
  if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
    connectionAttempts++;
    console.log(`Reconnection attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`);
    connectToBackground();
  } else {
    console.error("Max reconnection attempts reached. Please reload the extension.");
  }
}

// Ping background script to check connection
function pingBackground() {
  chrome.runtime.sendMessage({ action: "ping" }, response => {
    if (chrome.runtime.lastError) {
      console.error("Background ping failed:", chrome.runtime.lastError);
      isBackgroundConnected = false;
      setTimeout(tryReconnect, 1000);
      return;
    }

    if (response && response.action === "pong") {
      console.log("Background connection confirmed");
      isBackgroundConnected = true;
      connectionAttempts = 0; // Reset counter on successful connection
    } else {
      console.error("Invalid ping response:", response);
      isBackgroundConnected = false;
      setTimeout(tryReconnect, 1000);
    }
  });
}

// Listen for background pings
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "backgroundAlive") {
    isBackgroundConnected = true;
    sendResponse({ received: true });
    return true;
  }
  return false;
});

// Establish initial connection
connectToBackground();

// --- Create Toggle Button ---
const toggleButton = document.createElement('button');
toggleButton.id = 'browser-buddy-toggle';
toggleButton.textContent = '🤖'; // Use an emoji or text for the button

// Basic Styling for the button
toggleButton.style.position = 'fixed';
toggleButton.style.bottom = '20px';
toggleButton.style.right = '20px';
toggleButton.style.zIndex = '10000'; // Ensure it's on top
toggleButton.style.backgroundColor = '#007bff';
toggleButton.style.color = 'white';
toggleButton.style.border = 'none';
toggleButton.style.borderRadius = '50%';
toggleButton.style.width = '50px';
toggleButton.style.height = '50px';
toggleButton.style.fontSize = '24px';
toggleButton.style.cursor = 'pointer';
toggleButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';

// --- Create Sidebar ---
const sidebar = document.createElement('div');
sidebar.id = 'browser-buddy-sidebar';

// Basic Styling for the sidebar
sidebar.style.position = 'fixed';
sidebar.style.right = '-350px'; // Start off-screen
sidebar.style.top = '0';
sidebar.style.width = '350px';
sidebar.style.height = '100vh'; // Full height
sidebar.style.backgroundColor = '#f8f9fa';
sidebar.style.borderLeft = '1px solid #dee2e6';
sidebar.style.zIndex = '9999'; // Just below the button
sidebar.style.boxShadow = '-2px 0 5px rgba(0,0,0,0.1)';
sidebar.style.transition = 'right 0.3s ease-in-out'; // Smooth transition
sidebar.style.display = 'flex'; // Use flexbox for internal layout
sidebar.style.flexDirection = 'column'; // Stack elements vertically

// --- Add Chatbot UI Placeholders inside Sidebar ---
sidebar.innerHTML = `
  <div id="browser-buddy-header" style="padding: 15px; background-color: #e9ecef; border-bottom: 1px solid #dee2e6; text-align: center; font-weight: bold;">
    Browser Buddy Chat
  </div>
  <div id="browser-buddy-messages" style="flex-grow: 1; padding: 10px; overflow-y: auto; background-color: white; border-bottom: 1px solid #dee2e6;">
    <!-- Chat messages will appear here -->
    <p>Welcome! How can I help you understand this page?</p>
  </div>
  <div id="browser-buddy-input-area" style="padding: 10px; background-color: #e9ecef; display: flex;">
    <input type="text" id="browser-buddy-input" placeholder="Ask something..." style="flex-grow: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 4px;">
    <button id="browser-buddy-all-tabs" style="margin-left: 5px; padding: 8px 12px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;">All Tabs</button>
    <button id="browser-buddy-send" style="margin-left: 5px; padding: 8px 12px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Send</button>
  </div>
`;

// --- Add Toggle Logic ---
let isSidebarOpen = false;
toggleButton.addEventListener('click', () => {
  isSidebarOpen = !isSidebarOpen;
  if (isSidebarOpen) {
    sidebar.style.right = '0'; // Slide in
  } else {
    sidebar.style.right = '-350px'; // Slide out
  }
});

// --- Append elements to the page ---
document.body.appendChild(toggleButton);
document.body.appendChild(sidebar);

console.log("Browser Buddy UI added to page.");

// --- Extract Page Content (adapted from contentScript.js) ---
function extractTextFromDOM() {
  console.log("⏳ Extracting page content...");

  // Get main content elements that are likely to contain the article/page content
  const mainContent = document.querySelector('main') ||
    document.querySelector('article') ||
    document.querySelector('#content') ||
    document.querySelector('#main');

  // First try to get the page title
  const pageTitle = document.title || "No title";
  // Get page URL
  const pageUrl = window.location.href;

  console.log(`Page title: ${pageTitle}`);
  console.log(`Page URL: ${pageUrl}`);

  // Store extracted text
  const textContent = [`Page title: ${pageTitle}`, `Page URL: ${pageUrl}`];

  // Get all headings first to capture the structure
  const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
  console.log(`Found ${headings.length} headings`);

  headings.forEach(heading => {
    const headingText = heading.textContent.trim();
    if (headingText) {
      textContent.push(`Heading: ${headingText}`);
    }
  });

  // Get all potential text elements
  const textElements = document.querySelectorAll('p, li, td, th, div, section, article, aside, blockquote, pre, code, label');
  console.log(`Found ${textElements.length} potential text elements`);

  // Helper function to get meaningful text
  function getCleanText(element) {
    // Get direct text (not in children)
    let text = '';
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent + ' ';
      }
    }
    return text.trim();
  }

  // Process important elements first
  const paragraphs = document.querySelectorAll('p');
  paragraphs.forEach(p => {
    const text = p.textContent.trim();
    if (text && text.length > 20) { // Only meaningful paragraphs
      textContent.push(text);
    }
  });

  // Process lists
  const listItems = document.querySelectorAll('li');
  listItems.forEach(li => {
    const text = li.textContent.trim();
    if (text && text.length > 10) {
      textContent.push(`• ${text}`);
    }
  });

  // Process other elements
  textElements.forEach(element => {
    // Skip very common elements that are unlikely to contain main content
    if (element.tagName.toLowerCase() === 'div' || element.tagName.toLowerCase() === 'section') {
      const text = getCleanText(element);
      if (text && text.length > 100) { // Only substantial div/section direct text
        textContent.push(text);
      }
    }
  });

  // If the targeted approach didn't get much, try a more brute force approach
  if (textContent.length < 10) {
    console.log("Not enough content found, trying alternative approach");

    // Try to get main content
    if (mainContent) {
      const mainText = mainContent.innerText.split('\n').filter(line => line.trim().length > 0);
      mainText.forEach(line => {
        if (line.length > 20) {
          textContent.push(line);
        }
      });
    }

    // Last resort: get all visible text
    if (textContent.length < 10) {
      console.log("Still not enough content, getting all body text");
      const bodyText = document.body.innerText;
      const bodyLines = bodyText.split('\n').filter(line => line.trim().length > 20);
      bodyLines.forEach(line => {
        if (!textContent.includes(line)) {
          textContent.push(line);
        }
      });
    }
  }

  console.log(`Browser Buddy: Extracted ${textContent.length} text blocks from the page`);

  // Debug: Log the first few text blocks if any
  if (textContent.length > 0) {
    console.log("Sample of extracted content:");
    for (let i = 0; i < Math.min(10, textContent.length); i++) {
      console.log(`Block ${i + 1} (${textContent[i].length} chars): ${textContent[i].substring(0, 100)}...`);
    }

    // Log full content for debugging
    console.log("---- FULL EXTRACTED CONTENT START ----");
    textContent.forEach((block, i) => {
      console.log(`Block ${i + 1}: ${block}`);
    });
    console.log("---- FULL EXTRACTED CONTENT END ----");
  } else {
    console.warn("⚠️ No text content was extracted from the page!");
  }

  return textContent;
}

// --- Initialize Chat Components ---
let messagesContainer;
let inputField;
let sendButton;
let allTabsButton;

// --- Store conversation history ---
let conversationHistory = [];
// Track if we should use all tabs content
let useAllTabsContent = false;

function initializeChat() {
  // Get references to the chat elements
  messagesContainer = document.getElementById('browser-buddy-messages');
  inputField = document.getElementById('browser-buddy-input');
  sendButton = document.getElementById('browser-buddy-send');
  allTabsButton = document.getElementById('browser-buddy-all-tabs');

  // Add event listeners
  sendButton.addEventListener('click', () => handleSendMessage(false));
  allTabsButton.addEventListener('click', () => handleSendMessage(true));
  inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSendMessage(useAllTabsContent);
    }
  });

  // Add visual indicator for current mode
  updateButtonState();
}

function updateButtonState() {
  if (useAllTabsContent) {
    allTabsButton.style.backgroundColor = '#218838'; // Darker green
    allTabsButton.style.boxShadow = 'inset 0 0 5px rgba(0,0,0,0.3)';
    sendButton.style.backgroundColor = '#007bff'; // Default blue
    sendButton.style.boxShadow = 'none';
  } else {
    allTabsButton.style.backgroundColor = '#28a745'; // Default green
    allTabsButton.style.boxShadow = 'none';
    sendButton.style.backgroundColor = '#0069d9'; // Darker blue
    sendButton.style.boxShadow = 'inset 0 0 5px rgba(0,0,0,0.3)';
  }
}

function handleSendMessage(useAllTabs) {
  useAllTabsContent = useAllTabs;
  updateButtonState();

  const userMessage = inputField.value.trim();

  if (!userMessage) return; // Don't send empty messages

  // Display user message
  addMessageToChat('user', userMessage);

  // Clear input field
  inputField.value = '';

  // Check background connection
  if (!isBackgroundConnected) {
    addMessageToChat('assistant', 'Connection to background service is unavailable. Attempting to reconnect...');
    pingBackground(); // Try to reconnect
    return;
  }

  // Display loading message
  const loadingMsgElement = addMessageToChat('assistant', useAllTabsContent ? 'Analyzing all open tabs...' : 'Thinking...');

  // Extract page content
  const pageContentArray = extractTextFromDOM();
  const pageContent = pageContentArray.join('\n\n').substring(0, 5000); // Limit to 5000 characters
  console.log(`Page content extracted (${pageContent.length} characters)`);

  // Debug: Log a sample of what's being sent
  console.log("Sample of page content being sent:", pageContent.substring(0, 200) + "...");

  // Add to conversation history - don't include the page content in the history
  conversationHistory.push({ role: 'user', content: userMessage });

  // Send message to Claude API
  sendToClaudeAPI(userMessage, pageContent, useAllTabsContent)
    .then(response => {
      // Remove loading message
      if (loadingMsgElement) {
        messagesContainer.removeChild(loadingMsgElement);
      }

      // Display assistant response
      addMessageToChat('assistant', response);

      // Add to conversation history
      conversationHistory.push({ role: 'assistant', content: response });
    })
    .catch(error => {
      console.error('Error with Claude API:', error);

      // Remove loading message
      if (loadingMsgElement) {
        messagesContainer.removeChild(loadingMsgElement);
      }

      // Display error message
      addMessageToChat('assistant', `Sorry, I encountered an error: ${error.message || 'Unknown error'}. Please try again.`);
    });
}

async function sendToClaudeAPI(userMessage, pageContent, useAllTabs = false) {
  console.log(`Sending message to Claude API (useAllTabs: ${useAllTabs})`);

  // Create prompt with user message and page content - formatted for the background script to parse
  const prompt = `
User asked: "${userMessage}"

The following is the content of the webpage the user is currently viewing:
${pageContent}

Please respond to the user's query based on the webpage content. Keep your response concise and focused on answering the question based on the page content.
`;

  console.log(`Full prompt size: ${prompt.length} characters`);

  return new Promise((resolve, reject) => {
    try {
      console.log("Sending message to background script");

      chrome.runtime.sendMessage({
        action: "callClaudeAPI",
        prompt: prompt,
        history: conversationHistory,
        useAllTabs: useAllTabs
      }, response => {
        // Check for runtime errors
        if (chrome.runtime.lastError) {
          console.error("Runtime error:", chrome.runtime.lastError);
          isBackgroundConnected = false;
          pingBackground(); // Try to reconnect
          reject(new Error("Connection to background service lost. Please try again."));
          return;
        }

        console.log("Received response from background script:", response);

        // In a real implementation, we'd handle the response from the background script
        if (response && response.success) {
          resolve(response.data);
        } else {
          console.error("API call failed:", response?.error || "Unknown error");
          reject(new Error(response?.error || "Unknown error occurred"));
        }
      });
    } catch (error) {
      console.error("Error calling Claude API:", error);
      reject(error);
    }
  });
}

function addMessageToChat(role, text) {
  const messageElement = document.createElement('div');
  messageElement.classList.add('chat-message', `${role}-message`);

  // Style based on role
  messageElement.style.padding = '8px 12px';
  messageElement.style.margin = '5px 0';
  messageElement.style.borderRadius = '8px';
  messageElement.style.maxWidth = '85%';
  messageElement.style.wordWrap = 'break-word';

  if (role === 'user') {
    messageElement.style.alignSelf = 'flex-end';
    messageElement.style.backgroundColor = '#007bff';
    messageElement.style.color = 'white';
    messageElement.style.marginLeft = 'auto';
  } else {
    messageElement.style.alignSelf = 'flex-start';
    messageElement.style.backgroundColor = '#e9ecef';
    messageElement.style.color = 'black';
    messageElement.style.marginRight = 'auto';
  }

  messageElement.textContent = text;
  messagesContainer.appendChild(messageElement);

  // Scroll to the bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return messageElement;
}

// Initialize the chat on window load
window.addEventListener('load', initializeChat);

// Periodically ping the background script to ensure connection
setInterval(pingBackground, 30000); // Every 30 seconds 