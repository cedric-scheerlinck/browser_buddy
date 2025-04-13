// Simple script to verify that the environment variables are loaded correctly
const dotenv = require('dotenv');
dotenv.config();

console.log('Environment variables loaded:');
console.log('CLAUDE_API_KEY exists:', process.env.CLAUDE_API_KEY ? 'Yes' : 'No');
console.log('CLAUDE_API_KEY starts with:', process.env.CLAUDE_API_KEY ? process.env.CLAUDE_API_KEY.substring(0, 10) + '...' : 'N/A'); 