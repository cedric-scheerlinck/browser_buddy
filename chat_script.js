console.log("Browser Buddy Chat Script Loaded!");

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
  // Get all text elements that might contain substantial content
  const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, div, article, section');

  // Store the text content of each element
  const textContent = [];

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
    if (elementText.length >= 50) {
      textContent.push(elementText);
    }

    // Recursively process child elements
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

  // Process each top-level element
  textElements.forEach(element => {
    let isChildOfProcessed = false;
    let parent = element.parentElement;

    // Skip processing children of elements we've already processed
    while (parent) {
      if (textContent.some(text => parent.textContent.includes(text))) {
        isChildOfProcessed = true;
        break;
      }
      parent = parent.parentElement;
    }

    if (!isChildOfProcessed) {
      extractTextFromElement(element);
    }
  });

  console.log(`Browser Buddy: Extracted ${textContent.length} text blocks from the page`);
  return textContent;
}

// --- Initialize Chat Components ---
let messagesContainer;
let inputField;
let sendButton;

// --- Store conversation history ---
let conversationHistory = [];

function initializeChat() {
  // Get references to the chat elements
  messagesContainer = document.getElementById('browser-buddy-messages');
  inputField = document.getElementById('browser-buddy-input');
  sendButton = document.getElementById('browser-buddy-send');

  // Add event listeners
  sendButton.addEventListener('click', handleSendMessage);
  inputField.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  });
}

function handleSendMessage() {
  const userMessage = inputField.value.trim();

  if (!userMessage) return; // Don't send empty messages

  // Display user message
  addMessageToChat('user', userMessage);

  // Clear input field
  inputField.value = '';

  // Display loading message
  const loadingMsgElement = addMessageToChat('assistant', 'Thinking...');

  // Extract page content
  const pageContent = extractTextFromDOM().join('\n\n').substring(0, 5000); // Limit to 5000 characters

  // Add to conversation history
  conversationHistory.push({ role: 'user', content: userMessage });

  // Send message to Claude API
  sendToClaudeAPI(userMessage, pageContent)
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
      addMessageToChat('assistant', 'Sorry, I encountered an error. Please try again.');
    });
}

async function sendToClaudeAPI(userMessage, pageContent) {
  // Claude API endpoint (this assumes a backend proxy; direct browser calls to API won't work due to CORS)
  const apiUrl = 'https://api.anthropic.com/v1/messages';

  // Create prompt with user message and page content
  const prompt = `
User asked: "${userMessage}"

The following is the content of the webpage the user is currently viewing:
${pageContent}

Please respond to the user's query based on the webpage content. Keep your response concise and focused on answering the question based on the page content.
`;

  try {
    // Note: This won't work directly in a browser extension due to CORS restrictions
    // You would need a background script or a backend server to make this call
    // This is just an example of how the API call would be structured
    const response = await chrome.runtime.sendMessage({
      action: "callClaudeAPI",
      prompt: prompt,
      history: conversationHistory
    });

    // In a real implementation, we'd handle the response from the background script
    if (response && response.success) {
      return response.data;
    } else {
      console.error("API call failed:", response?.error || "Unknown error");
      return "I'm sorry, I couldn't process your request at this time. Please try again later.";
    }
  } catch (error) {
    console.error("Error calling Claude API:", error);
    return "I'm sorry, there was an error connecting to my backend services. Please try again later.";
  }
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

// Initialize the chat components once the sidebar is added to the page
setTimeout(initializeChat, 500); // Small delay to ensure everything is loaded 