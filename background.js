/**
 * Browser Buddy - Background Script
 *
 * This script handles communication between content scripts and the Claude API.
 */

// Environment detection
const ENV = {
  isBrowser: typeof chrome !== "undefined",
  isNode: typeof process !== "undefined",
  isTest: typeof process !== "undefined" && process.env.NODE_ENV === "test",
};

const TAB_CONTENT_LENGTH_LIMIT = 1000;

// Load dotenv in Node.js environment for testing
if (ENV.isNode && !ENV.isBrowser) {
  require("dotenv").config();
}

// ==================== STATE ====================

// Settings
let apiKey = "";
let systemPrompt;

// Connection tracking (browser only)
const connections = {};

// ==================== API KEY MANAGEMENT ====================

/**
 * Load API key from .env file
 */
async function loadApiKey() {
  try {
    if (ENV.isNode) {
      // Node environment - use fs module to read .env file
      const fs = require("fs");
      const path = require("path");
      const envPath = path.resolve(process.cwd(), ".env");

      const envText = fs.readFileSync(envPath, "utf8");
      const matches = envText.match(/CLAUDE_API_KEY=(.+)/);

      if (matches && matches[1]) {
        apiKey = matches[1].trim();
        console.log("API key loaded from .env file (Node.js)");
        return true;
      }
    } else {
      // Browser environment - use chrome.runtime.getURL
      const envUrl = chrome.runtime.getURL(".env");
      const response = await fetch(envUrl);

      if (!response.ok) {
        throw new Error(`Failed to load .env file: ${response.status}`);
      }

      const envText = await response.text();
      const matches = envText.match(/CLAUDE_API_KEY=(.+)/);

      if (matches && matches[1]) {
        apiKey = matches[1].trim();
        console.log("API key loaded from .env file (Browser)");
        return true;
      }
    }

    console.warn("No API key found in .env file");
    return false;
  } catch (error) {
    console.error("Error loading API key:", error);
    return false;
  }
}

/**
 * Load system prompt from file or use default
 */
async function loadSystemPrompt() {
  try {
    // Load system_prompt.md differently based on environment
    if (ENV.isNode) {
      // For Node environment, use fs module
      const fs = require("fs");
      const path = require("path");
      const promptPath = path.resolve(process.cwd(), "system_prompt.md");

      // Read synchronously to match our loadApiKey approach
      try {
        const data = fs.readFileSync(promptPath, "utf8");
        systemPrompt = data;
        console.log(
          "System prompt loaded from filesystem, length:",
          systemPrompt.length
        );
        return true;
      } catch (fsError) {
        console.error(`Error reading system_prompt.md: ${fsError.message}`);
        throw new Error(`Failed to load system prompt: ${fsError.message}`);
      }
    } else {
      // For browser environment, use fetch API
      const promptUrl = chrome.runtime.getURL("system_prompt.md");
      const response = await fetch(promptUrl);

      if (response.ok) {
        systemPrompt = await response.text();
        console.log("System prompt loaded, length:", systemPrompt.length);
        return true;
      } else {
        throw new Error(
          `Failed to load system prompt: ${response.status} ${response.statusText}`
        );
      }
    }
  } catch (error) {
    console.error("Error loading system prompt:", error);
    throw error;
  }
}

async function getAllTabContent() {
  try {
    console.log("Getting content from all open tabs...");
    const tabs = await chrome.tabs.query({});
    console.log(`Found ${tabs.length} open tabs`);

    const tabsContent = [];

    for (const tab of tabs) {
      try {
        // Skip tabs that can't be injected with content scripts
        if (
          !tab.url ||
          tab.url.startsWith("chrome://") ||
          tab.url.startsWith("chrome-extension://")
        ) {
          console.log(
            `Skipping tab ${tab.id} (${tab.url}) as it cannot be accessed`
          );
          continue;
        }

        console.log(`Reading content from tab ${tab.id} (${tab.url})`);

        // Execute content script to get the page text
        const results = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          function: () => {
            // This function runs in the context of the tab
            function extractText(element, texts) {
              if (!element) return;

              // Skip invisible elements - only check style for Element nodes (not Text nodes)
              if (element.nodeType === Node.ELEMENT_NODE) {
                const style = window.getComputedStyle(element);
                if (style.display === "none" || style.visibility === "hidden")
                  return;

                // Skip script, style, and other non-content elements
                const tagsToSkip = [
                  "SCRIPT",
                  "STYLE",
                  "NOSCRIPT",
                  "SVG",
                  "PATH",
                ];
                if (tagsToSkip.includes(element.tagName)) return;
              }

              // Consider only text nodes that have non-whitespace content
              if (element.nodeType === Node.TEXT_NODE) {
                const text = element.textContent.trim();
                if (text) texts.push(text);
                return;
              }

              // Process child nodes - only if this is an element node
              if (
                element.nodeType === Node.ELEMENT_NODE &&
                element.childNodes
              ) {
                for (const child of element.childNodes) {
                  extractText(child, texts);
                }
              }
            }

            const texts = [];

            try {
              // Start with the document body
              if (document.body) {
                extractText(document.body, texts);
              }

              // Collect page metadata
              const title = document.title || "";
              const url = window.location.href || "";
              const metaDescription =
                document.querySelector('meta[name="description"]')?.content ||
                "";

              return {
                title: title,
                url: url,
                metaDescription: metaDescription,
                content: texts.join("\n"),
              };
            } catch (error) {
              console.error("Error extracting text:", error);
              return {
                title: document.title || "",
                url: window.location.href || "",
                content: `Error extracting content: ${error.message}`,
              };
            }
          },
        });

        if (results && results[0] && results[0].result) {
          const { title, url, metaDescription, content } = results[0].result;

          // Only add if we got meaningful content
          if (content && content.length > 0) {
            tabsContent.push({
              title,
              url,
              metaDescription,
              content: content.substring(0, TAB_CONTENT_LENGTH_LIMIT), // Limit content length
            });
            console.log(
              `Added content from tab: ${title} (${url.substring(0, 50)}...)`
            );
            console.log(`Content length: ${content.length} characters`);
          } else {
            console.log(
              `No meaningful content extracted from tab: ${title} (${url})`
            );
          }
        }
      } catch (error) {
        console.error(`Error reading tab ${tab.id}:`, error);
      }
    }

    return tabsContent;
  } catch (error) {
    console.error("Error getting all tab content:", error);
    return [];
  }
}

// ==================== CLAUDE API ====================

/**
 * Call Claude API with prompt and webpage content
 */
async function callClaudeAPI(prompt, webpageContent) {
  const apiUrl = "https://api.anthropic.com/v1/messages";

  // Ensure API key is available
  if (!apiKey) {
    await loadApiKey();
    if (!apiKey) {
      throw new Error("API key not available");
    }
  }

  // Ensure system prompt is loaded
  if (!systemPrompt) {
    await loadSystemPrompt();
  }

  webpageContent = await getAllTabContent();

  // Format webpage content
  const formattedContent = formatWebpageContent(webpageContent);

  let system_prompt = [
    {
      type: "text",
      text: formattedContent,
      cache_control: { type: "ephemeral" },
    },
  ];

  if (
    prompt == null ||
    prompt.startsWith(
      "Here are the users tabs. The source of the current page is"
    ) ||
    prompt == undefined
  ) {
    system_prompt.push({
      type: "text",
      text: systemPrompt,
      cache_control: { type: "ephemeral" },
    });
  }

  // Prepare request payload
  const requestBody = {
    model: "claude-3-7-sonnet-latest",
    max_tokens: 3072,
    thinking: {
      type: "enabled",
      budget_tokens: 1024,
    },
    system: system_prompt,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  };

  console.log("Request body: " + JSON.stringify(requestBody));

  // Get appropriate fetch function
  const fetchFn =
    typeof fetch !== "undefined"
      ? fetch
      : ENV.isNode
      ? require("node-fetch")
      : null;

  if (!fetchFn) {
    throw new Error("No fetch implementation available");
  }

  try {
    // Make API request
    const response = await fetchFn(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error (${response.status}): ${errorText}`);
    }

    let data;
    try {
      // Standard JSON parsing
      data = await response.json();
    } catch (error) {
      // If standard parsing fails, try to extract JSON from the response text
      // const responseText = await response.text();
      // data = extractJSON(responseText);

      throw new Error("Failed to parse response as JSON");
    }

    // data.content[0].text is the thinking portion.
    return JSON.parse(data.content[1].text);
  } catch (error) {
    console.error("Claude API error:", error);
    throw error;
  }
}

/**
 * Format webpage content in XML structure
 */
function formatWebpageContent(webpageContent) {
  const contentArray = Array.isArray(webpageContent)
    ? webpageContent
    : [webpageContent || ""];

  let formattedContent = "<documents>\n";

  contentArray.forEach((content, index) => {
    formattedContent += `  <document index="${index + 1}">
    <source>${content.title}</source>
    <document_content>
      ${content.content}
    </document_content>
  </document>\n`;
  });

  formattedContent += "</documents>";
  return formattedContent;
}

// ==================== BROWSER-SPECIFIC FUNCTIONALITY ====================

// Only set up browser-specific features if in browser environment
if (ENV.isBrowser && !ENV.isTest) {
  // Initialize extension
  (async function () {
    await loadApiKey();
    await loadSystemPrompt();

    // Set up content script connection pings
    pingContentScripts();
    setInterval(pingContentScripts, 15000);
  })();

  // Content script connection management
  chrome.runtime.onConnect.addListener((port) => {
    const tabId = port.sender.tab?.id;
    if (tabId) {
      connections[tabId] = port;
      port.onDisconnect.addListener(() => {
        delete connections[tabId];
      });
    }
  });

  // Message handling
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const action = message.action || "unknown";

    switch (action) {
      case "ping":
        sendResponse({ success: true, action: "pong" });
        return false;

      case "callClaudeAPI":
        handleApiRequest(message, sendResponse);
        return true;

      default:
        sendResponse({ success: false, error: "Unknown action" });
        return false;
    }
  });
}

/**
 * Handle Claude API requests from content scripts
 */
function handleApiRequest(message, sendResponse) {
  if (!message.prompt) {
    sendResponse({ success: false, error: "Missing prompt" });
    return;
  }

  callClaudeAPI(message.prompt, message.webpageContent)
    .then((response) => {
      sendResponse({ success: true, data: response });
    })
    .catch((error) => {
      // Check for specific system prompt errors
      const errorMessage = error.toString();
      const isSystemPromptError = errorMessage.includes("system prompt");

      sendResponse({
        success: false,
        error: errorMessage,
        message: isSystemPromptError
          ? "Failed to load system prompt"
          : "API request failed",
      });
    });
}

/**
 * Ping content scripts to maintain connections
 */
function pingContentScripts() {
  if (!ENV.isBrowser || !chrome.tabs) return;

  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      try {
        chrome.tabs
          .sendMessage(tab.id, { action: "backgroundAlive" })
          .catch(() => {});
      } catch (e) {}
    });
  });
}

// Export for testing
if (typeof module !== "undefined") {
  module.exports = {
    callClaudeAPI,
    loadApiKey,
    loadSystemPrompt,
  };
}
