// This script runs in the detached window context
document.addEventListener('DOMContentLoaded', function() {
  // Get the current active tab info
  chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
    if (tabs && tabs[0]) {
      const currentTab = tabs[0];
      
      // Store the tab ID in the window for future reference
      window.currentTabId = currentTab.id;
      window.currentTabUrl = currentTab.url;
      
      console.log("Detached window opened for tab:", currentTab.url);
      
      // Set the window title to include the page title or URL
      document.title = "AI Content Detector - " + (currentTab.title || currentTab.url);
    }
  });
  
  // Inherit the same functionality as popup.js
  // We'll load popup.js which contains all the existing functionality
  const script = document.createElement('script');
  script.src = 'popup.js';
  document.body.appendChild(script);
  
  // Add some additional info for the detached window
  const detachedInfo = document.createElement('div');
  detachedInfo.className = 'detached-info';
  detachedInfo.innerHTML = 'Detached Window - Will stay open even when clicking elsewhere';
  document.querySelector('.container').prepend(detachedInfo);
}); 