#!/usr/bin/env node

import { PRInfoAgent } from './dist/mastra/agents/tool-agent.js';

async function testPRAgent() {
  console.log('Testing PRInfoAgent...');
  
  try {
    const result = await PRInfoAgent.generateVNext([
      {
        role: 'user',
        content: 'Fetch PR information for PR #4. Use the getPRInfoTool with prNumber: 4.'
      }
    ]);
    
    console.log('Raw result:', JSON.stringify(result, null, 2));
    console.log('\nType of result:', typeof result);
    console.log('Result properties:', Object.keys(result || {}));
    
    // Try different extraction methods
    console.log('\nTrying different extraction methods:');
    console.log('result.object:', result?.object);
    console.log('result.success:', result?.success);
    console.log('result.data:', result?.data);
    console.log('result.text:', result?.text);
    console.log('result itself:', result);
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Set environment variables from gh auth
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.argv[2];
console.log('GitHub Token:', process.env.GITHUB_TOKEN ? 'Set' : 'Not set');

testPRAgent();