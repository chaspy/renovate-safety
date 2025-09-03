import { mastra, validateConfig } from './config/index.js';

async function testSetup() {
  console.log('🔍 Validating configuration...');
  validateConfig();
  console.log('✅ Configuration valid');
  
  console.log('🔍 Testing OpenAI connection...');
  // Simple test to verify OpenAI is configured
  try {
    const response = await mastra.providers.openai.generateText({
      model: 'gpt-3.5-turbo',
      prompt: 'Say "Hello, Mastra!"',
      maxTokens: 10,
    });
    console.log('✅ OpenAI response:', response);
  } catch (error) {
    console.error('❌ OpenAI connection failed:', error);
    throw error;
  }
  
  console.log('🎉 Setup complete!');
}

testSetup().catch(console.error);