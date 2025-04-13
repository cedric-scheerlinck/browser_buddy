/**
 * Test for calling the Claude API function from background.js
 */

// Import required modules
const fs = require('fs').promises;
const path = require('path');
const backgroundScript = require('../background.js');

// Setup test
describe('Claude API Function Test', () => {
  // Set longer timeout since we're making real API calls
  jest.setTimeout(30000);
  
  test('Call Claude API with Manchester United data', async () => {
    // Load the test data
    const testDataPath = path.join(__dirname, 'test_data', 'man_utd_google.txt');
    const manUtdContent = await fs.readFile(testDataPath, 'utf8');
    
    // Call the API with empty prompt and the test content
    const result = await backgroundScript.callClaudeAPI('here are the docs', [manUtdContent]);
    
    console.log('Result', result);  
    
    // Log the result for debugging
    console.log('Claude API response length:', result.length);
    console.log('Result', result);
    
    // Basic validation of the response
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('Call Claude API with both Manchester United and Champions League data', async () => {
    // Load both test data files
    const manUtdPath = path.join(__dirname, 'test_data', 'man_utd_google.txt');
    const championsPath = path.join(__dirname, 'test_data', 'champions_league_google.txt');
    
    const manUtdContent = await fs.readFile(manUtdPath, 'utf8');
    const championsContent = await fs.readFile(championsPath, 'utf8');
    
    // Call the API with both content files
    const result = await backgroundScript.callClaudeAPI('here are the docs', [manUtdContent, championsContent]);
    
    // Log the result for debugging
    console.log('Claude API response length:', result.length);
    console.log('Result', result);
    
    // Basic validation of the response
    expect(result).toBeDefined();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
