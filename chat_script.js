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
    console.log(
      `Reconnection attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}`
    );
    connectToBackground();
  } else {
    console.error(
      "Max reconnection attempts reached. Please reload the extension."
    );
  }
}

// Ping background script to check connection
function pingBackground() {
  chrome.runtime.sendMessage({ action: "ping" }, (response) => {
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

// --- Create Sidebar ---
const sidebar = document.createElement("div");
sidebar.id = "browser-buddy-sidebar";

// Basic Styling for the sidebar
sidebar.style.position = "fixed";
sidebar.style.right = "0"; // Start visible on screen
sidebar.style.top = "0";
sidebar.style.width = "350px";
sidebar.style.height = "100vh"; // Full height
sidebar.style.backgroundColor = "#f8f9fa";
sidebar.style.borderLeft = "1px solid #dee2e6";
sidebar.style.zIndex = "9999";
sidebar.style.boxShadow = "-2px 0 5px rgba(0,0,0,0.1)";
sidebar.style.display = "flex"; // Use flexbox for internal layout
sidebar.style.flexDirection = "column"; // Stack elements vertically

// --- Add Chatbot UI Placeholders inside Sidebar ---
sidebar.innerHTML = `
  <div id="browser-buddy-header" style="padding: 15px; background-color: #e9ecef; border-bottom: 1px solid #dee2e6; text-align: center; font-weight: bold; display: flex; justify-content: space-between; align-items: center;">
    <span>Browser Buddy Chat</span>
    <button id="browser-buddy-analyze" style="padding: 5px 10px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Analyze Page</button>
  </div>
  <div id="browser-buddy-messages" style="flex-grow: 1; padding: 10px; overflow-y: auto; background-color: white; border-bottom: 1px solid #dee2e6;">
    <!-- Chat messages will appear here -->
  </div>
  <div id="browser-buddy-input-area" style="padding: 10px; background-color: #e9ecef; display: flex;">
    <input type="text" id="browser-buddy-input" placeholder="Ask something..." style="flex-grow: 1; padding: 8px; border: 1px solid #ced4da; border-radius: 4px;">
    <button id="browser-buddy-send" style="margin-left: 5px; padding: 8px 12px; background-color: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">Send</button>
  </div>
`;

// --- Append elements to the page ---
document.body.appendChild(sidebar);

console.log("Browser Buddy UI added to page.");

// --- Extract Page Content (adapted from contentScript.js) ---
function extractTextFromDOM() {
  console.log("⏳ Extracting page content...");

  // Get main content elements that are likely to contain the article/page content
  const mainContent =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector("#content") ||
    document.querySelector("#main");

  // First try to get the page title
  const pageTitle = document.title || "No title";
  // Get page URL
  const pageUrl = window.location.href;

  console.log(`Page title: ${pageTitle}`);
  console.log(`Page URL: ${pageUrl}`);

  // Store extracted text
  const textContent = [`Page title: ${pageTitle}`, `Page URL: ${pageUrl}`];

  // Get all headings first to capture the structure
  const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
  console.log(`Found ${headings.length} headings`);

  headings.forEach((heading) => {
    const headingText = heading.textContent.trim();
    if (headingText) {
      textContent.push(`Heading: ${headingText}`);
    }
  });

  // Get all potential text elements
  const textElements = document.querySelectorAll(
    "p, li, td, th, div, section, article, aside, blockquote, pre, code, label"
  );
  console.log(`Found ${textElements.length} potential text elements`);

  // Helper function to get meaningful text
  function getCleanText(element) {
    // Get direct text (not in children)
    let text = "";
    for (const node of element.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent + " ";
      }
    }
    return text.trim();
  }

  // Process important elements first
  const paragraphs = document.querySelectorAll("p");
  paragraphs.forEach((p) => {
    const text = p.textContent.trim();
    if (text && text.length > 20) {
      // Only meaningful paragraphs
      textContent.push(text);
    }
  });

  // Process lists
  const listItems = document.querySelectorAll("li");
  listItems.forEach((li) => {
    const text = li.textContent.trim();
    if (text && text.length > 10) {
      textContent.push(`• ${text}`);
    }
  });

  // Process other elements
  textElements.forEach((element) => {
    // Skip very common elements that are unlikely to contain main content
    if (
      element.tagName.toLowerCase() === "div" ||
      element.tagName.toLowerCase() === "section"
    ) {
      const text = getCleanText(element);
      if (text && text.length > 100) {
        // Only substantial div/section direct text
        textContent.push(text);
      }
    }
  });

  // If the targeted approach didn't get much, try a more brute force approach
  if (textContent.length < 10) {
    console.log("Not enough content found, trying alternative approach");

    // Try to get main content
    if (mainContent) {
      const mainText = mainContent.innerText
        .split("\n")
        .filter((line) => line.trim().length > 0);
      mainText.forEach((line) => {
        if (line.length > 20) {
          textContent.push(line);
        }
      });
    }

    // Last resort: get all visible text
    if (textContent.length < 10) {
      console.log("Still not enough content, getting all body text");
      const bodyText = document.body.innerText;
      const bodyLines = bodyText
        .split("\n")
        .filter((line) => line.trim().length > 20);
      bodyLines.forEach((line) => {
        if (!textContent.includes(line)) {
          textContent.push(line);
        }
      });
    }
  }

  console.log(
    `Browser Buddy: Extracted ${textContent.length} text blocks from the page`
  );

  // Debug: Log the first few text blocks if any
  if (textContent.length > 0) {
    console.log("Sample of extracted content:");
    for (let i = 0; i < Math.min(10, textContent.length); i++) {
      console.log(
        `Block ${i + 1} (${textContent[i].length} chars): ${textContent[
          i
        ].substring(0, 100)}...`
      );
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
let analyzeButton;

// --- Store conversation history ---
let conversationHistory = [];

function initializeChat() {
  // Get references to the chat elements
  messagesContainer = document.getElementById("browser-buddy-messages");
  inputField = document.getElementById("browser-buddy-input");
  sendButton = document.getElementById("browser-buddy-send");
  analyzeButton = document.getElementById("browser-buddy-analyze");

  // Add event listeners
  sendButton.addEventListener("click", () => handleSendMessage());
  inputField.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleSendMessage();
    }
  });

  // Add event listener for the analyze button
  analyzeButton.addEventListener("click", () => analyzePageContent());

  // Add visual indicator for current mode
  updateButtonState();
}

function updateButtonState() {
  sendButton.style.backgroundColor = "#0069d9"; // Darker blue
  sendButton.style.boxShadow = "inset 0 0 5px rgba(0,0,0,0.3)";
}

function handleSendMessage() {
  updateButtonState();

  const userMessage = inputField.value.trim();

  if (!userMessage) return; // Don't send empty messages

  // Display user message
  addMessageToChat("user", userMessage);

  // Clear input field
  inputField.value = "";

  // Check background connection
  if (!isBackgroundConnected) {
    addMessageToChat(
      "assistant",
      "Connection to background service is unavailable. Attempting to reconnect..."
    );
    pingBackground(); // Try to reconnect
    return;
  }

  // Display loading message
  const loadingMsgElement = addMessageToChat("assistant", "Thinking...");

  // Extract page content
  const pageContentArray = extractTextFromDOM();
  const pageContent = pageContentArray.join("\n\n").substring(0, 5000); // Limit to 5000 characters
  console.log(`Page content extracted (${pageContent.length} characters)`);

  // Debug: Log a sample of what's being sent
  console.log(
    "Sample of page content being sent:",
    pageContent.substring(0, 200) + "..."
  );

  // Add to conversation history - don't include the page content in the history
  conversationHistory.push({ role: "user", content: userMessage });

  // Send message to Claude API
  sendToClaudeAPI(userMessage, pageContent)
    .then((response) => {
      // Remove loading message
      if (loadingMsgElement) {
        messagesContainer.removeChild(loadingMsgElement);
      }

      // Display assistant response
      addMessageToChat("assistant", response);

      // Add to conversation history
      conversationHistory.push({ role: "assistant", content: response });
    })
    .catch((error) => {
      console.error("Error with Claude API:", error);

      // Remove loading message
      if (loadingMsgElement) {
        messagesContainer.removeChild(loadingMsgElement);
      }

      // Display error message
      addMessageToChat(
        "assistant",
        `Sorry, I encountered an error: ${
          error.message || "Unknown error"
        }. Please try again.`
      );
    });
}

async function sendToClaudeAPI(userMessage, pageContent) {
  console.log(`Sending message to Claude API`);

  // Create prompt with user message and page content - formatted for the background script to parse
  const prompt = `
User asked: "${userMessage}"
Please respond to the user's query based on the webpage content. Keep your response concise and focused on answering the question based on the page content.
`;

  console.log(`Full prompt size: ${prompt.length} characters`);

  return new Promise((resolve, reject) => {
    try {
      console.log("Sending message to background script");

      chrome.runtime.sendMessage(
        {
          action: "callClaudeAPI",
          prompt: prompt,
          webpageContent: conversationHistory,
        },
        (response) => {
          // Check for runtime errors
          if (chrome.runtime.lastError) {
            console.error("Runtime error:", chrome.runtime.lastError);
            isBackgroundConnected = false;
            pingBackground(); // Try to reconnect
            reject(
              new Error(
                "Connection to background service lost. Please try again."
              )
            );
            return;
          }

          console.log("Received response from background script:", response);

          // In a real implementation, we'd handle the response from the background script
          if (response && response.success) {
            resolve(response.data);
          } else {
            console.error(
              "API call failed:",
              response?.error || "Unknown error"
            );
            reject(new Error(response?.error || "Unknown error occurred"));
          }
        }
      );
    } catch (error) {
      console.error("Error calling Claude API:", error);
      reject(error);
    }
  });
}

function addMessageToChat(role, text) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("chat-message", `${role}-message`);

  // Style based on role
  messageElement.style.padding = "8px 12px";
  messageElement.style.margin = "5px 0";
  messageElement.style.borderRadius = "8px";
  messageElement.style.maxWidth = "85%";
  messageElement.style.wordWrap = "break-word";

  if (role === "user") {
    messageElement.style.alignSelf = "flex-end";
    messageElement.style.backgroundColor = "#007bff";
    messageElement.style.color = "white";
    messageElement.style.marginLeft = "auto";
  } else {
    messageElement.style.alignSelf = "flex-start";
    messageElement.style.backgroundColor = "#e9ecef";
    messageElement.style.color = "black";
    messageElement.style.marginRight = "auto";
  }

  messageElement.textContent = text;
  messagesContainer.appendChild(messageElement);

  // Scroll to the bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  return messageElement;
}

// Function to analyze page content when button is clicked
function analyzePageContent() {
  const pageContentArray = extractTextFromDOM();
  const pageContent = pageContentArray.join("\n\n").substring(0, 5000); // Limit to 5000 characters

  // Display loading message
  const loadingMsgElement = addMessageToChat("assistant", "Analyzing page...");

  // Call Claude API with page information
  chrome.runtime.sendMessage(
    {
      action: "callClaudeAPI",
      prompt:
        "Here are the users tabs. The source of the current page is: " +
        document.title,
      webpageContent: [],
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "Runtime error on initial API call:",
          chrome.runtime.lastError
        );

        // Remove loading message and show error
        if (loadingMsgElement) {
          messagesContainer.removeChild(loadingMsgElement);
        }

        addMessageToChat(
          "assistant",
          "Sorry, I had trouble connecting. Please try again."
        );
        return;
      }

      console.log("Initial Claude API call completed:", response);

      // Remove loading message
      if (loadingMsgElement) {
        messagesContainer.removeChild(loadingMsgElement);
      }

      if (response.success) {
        // Check if response data is an array
        if (Array.isArray(response.data)) {
          displayConnectionCards(response.data);
        } else {
          // Fallback to regular message if not the expected format
          addMessageToChat("assistant", response.data);
        }
      } else {
        addMessageToChat(
          "assistant",
          "Sorry, I encountered an error. Please try again."
        );
      }
    }
  );
}

// Function to display connection cards based on API response
function displayConnectionCards(connections) {
  // Create container for all cards
  const cardsContainer = document.createElement("div");
  cardsContainer.className = "connection-cards-container";
  cardsContainer.style.width = "100%";
  cardsContainer.style.padding = "10px";
  cardsContainer.style.overflow = "auto";

  // Add heading
  const heading = document.createElement("div");
  heading.textContent = "Page Connections";
  heading.style.fontWeight = "bold";
  heading.style.fontSize = "16px";
  heading.style.margin = "5px 0 15px 5px";
  heading.style.color = "#333";
  cardsContainer.appendChild(heading);

  // No connections found
  if (!connections || connections.length === 0) {
    const noConnectionsMsg = document.createElement("div");
    noConnectionsMsg.textContent = "No relevant connections found.";
    noConnectionsMsg.style.padding = "10px";
    noConnectionsMsg.style.color = "#666";
    cardsContainer.appendChild(noConnectionsMsg);
    messagesContainer.appendChild(cardsContainer);
    return;
  }

  // Create a card for each connection
  connections.forEach((connection) => {
    const card = createConnectionCard(connection);
    cardsContainer.appendChild(card);
  });

  // Add to messages container
  messagesContainer.appendChild(cardsContainer);

  // Scroll to the bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Function to create a material design card for a connection
function createConnectionCard(connection) {
  // Create card container
  const card = document.createElement("div");
  card.className = "connection-card";
  card.style.backgroundColor = "white";
  card.style.borderRadius = "8px";
  card.style.boxShadow = "0 2px 5px rgba(0,0,0,0.1)";
  card.style.overflow = "hidden";
  card.style.marginBottom = "15px";
  card.style.transition = "box-shadow 0.3s ease";

  // Hover effect
  card.addEventListener("mouseover", () => {
    card.style.boxShadow = "0 4px 8px rgba(0,0,0,0.2)";
  });
  card.addEventListener("mouseout", () => {
    card.style.boxShadow = "0 2px 5px rgba(0,0,0,0.1)";
  });

  // Card header with relevance badge
  const cardHeader = document.createElement("div");
  cardHeader.style.padding = "15px 15px 5px 15px";
  cardHeader.style.display = "flex";
  cardHeader.style.justifyContent = "space-between";
  cardHeader.style.alignItems = "flex-start";

  // Heading
  const headingElement = document.createElement("h3");
  headingElement.textContent = connection.heading || "Unknown";
  headingElement.style.margin = "0";
  headingElement.style.fontSize = "16px";
  headingElement.style.fontWeight = "600";
  headingElement.style.color = "#333";
  cardHeader.appendChild(headingElement);

  // Relevance badge
  const relevanceBadge = document.createElement("span");
  const relevanceScore = connection.relevance_score || 0;
  relevanceBadge.textContent = `${relevanceScore}/10`;
  relevanceBadge.style.backgroundColor = getRelevanceColor(relevanceScore);
  relevanceBadge.style.color = "white";
  relevanceBadge.style.padding = "3px 8px";
  relevanceBadge.style.borderRadius = "12px";
  relevanceBadge.style.fontSize = "12px";
  relevanceBadge.style.fontWeight = "bold";
  cardHeader.appendChild(relevanceBadge);

  card.appendChild(cardHeader);

  // Subheading if available
  if (connection.subheading) {
    const subheading = document.createElement("div");
    subheading.textContent = connection.subheading;
    subheading.style.padding = "0 15px 10px 15px";
    subheading.style.fontSize = "14px";
    subheading.style.fontWeight = "500";
    subheading.style.color = "#666";
    card.appendChild(subheading);
  }

  // Category and visited time
  const metaInfo = document.createElement("div");
  metaInfo.style.display = "flex";
  metaInfo.style.justifyContent = "space-between";
  metaInfo.style.padding = "0 15px 10px 15px";
  metaInfo.style.fontSize = "12px";
  metaInfo.style.color = "#888";

  // Category
  const category = document.createElement("span");
  category.textContent = connection.category || "Uncategorized";
  category.style.backgroundColor = "#f0f0f0";
  category.style.padding = "2px 8px";
  category.style.borderRadius = "4px";
  metaInfo.appendChild(category);

  // Visited time
  if (connection.visited_at) {
    const visited = document.createElement("span");
    const date = new Date(connection.visited_at);
    visited.textContent = `Visited: ${date.toLocaleDateString()}`;
    metaInfo.appendChild(visited);
  }

  card.appendChild(metaInfo);

  // Content
  if (connection.content) {
    const content = document.createElement("div");
    content.textContent = connection.content;
    content.style.padding = "10px 15px";
    content.style.fontSize = "14px";
    content.style.lineHeight = "1.4";
    content.style.color = "#333";
    content.style.borderTop = "1px solid #eee";
    content.style.borderBottom = "1px solid #eee";
    card.appendChild(content);
  }

  // Key connection
  if (connection.key_connection) {
    const keyConnection = document.createElement("div");
    keyConnection.style.padding = "10px 15px";
    keyConnection.style.fontSize = "13px";
    keyConnection.style.color = "#444";

    const keyTitle = document.createElement("span");
    keyTitle.textContent = "Key Connection: ";
    keyTitle.style.fontWeight = "bold";
    keyConnection.appendChild(keyTitle);

    const keyText = document.createTextNode(connection.key_connection);
    keyConnection.appendChild(keyText);

    card.appendChild(keyConnection);
  }

  // Source link
  if (connection.source) {
    const footer = document.createElement("div");
    footer.style.padding = "10px 15px";
    footer.style.textAlign = "right";

    const sourceLink = document.createElement("a");
    sourceLink.href = connection.source;
    sourceLink.textContent = "View Source";
    sourceLink.style.color = "#007bff";
    sourceLink.style.textDecoration = "none";
    sourceLink.target = "_blank";

    // Add click event to open the link
    sourceLink.addEventListener("click", (e) => {
      e.stopPropagation();
      window.open(connection.source, "_blank");
    });

    footer.appendChild(sourceLink);
    card.appendChild(footer);
  }

  return card;
}

// Helper function to get color based on relevance score
function getRelevanceColor(score) {
  if (score >= 8) return "#4CAF50"; // High relevance - green
  if (score >= 5) return "#FFC107"; // Medium relevance - amber
  return "#F44336"; // Low relevance - red
}

// Initialize the chat on window load
window.addEventListener("load", initializeChat);

// Periodically ping the background script to ensure connection
setInterval(pingBackground, 30000); // Every 30 seconds
