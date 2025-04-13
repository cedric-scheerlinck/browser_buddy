/**
 * Jest configuration file
 */

module.exports = {
  // Set test environment
  testEnvironment: 'node',
  
  // Global setup
  setupFiles: ['<rootDir>/jest.setup.js'],
  
  // Test paths
  testMatch: ['**/*.test.js'],
  
  // Verbose output
  verbose: true,
  
  // Test timeout
  testTimeout: 30000
}; 