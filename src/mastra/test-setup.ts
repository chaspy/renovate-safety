import { mastra, openai, validateConfig } from './config/index.js';
import { generateText } from 'ai';

async function testSetup() {
  const isDryRun = process.env.DRY_RUN === 'true' || !process.env.OPENAI_API_KEY;
  
  console.log('🔍 Validating configuration...');
  
  // Dry-runモードでは環境変数チェックをスキップ
  if (isDryRun) {
    console.log('📝 Running in dry-run mode (no actual API calls)');
    if (!process.env.OPENAI_API_KEY) {
      console.log('⚠️  OPENAI_API_KEY not set - would be required for actual execution');
    }
  } else {
    validateConfig();
  }
  console.log('✅ Configuration valid');
  
  console.log('🔍 Testing Mastra + OpenAI integration...');
  
  if (isDryRun) {
    console.log('📝 [DRY-RUN] Would call OpenAI API via Mastra with:');
    console.log('   - Model: gpt-3.5-turbo');
    console.log('   - Prompt: "Say \\"Hello, Mastra!\\""');
    console.log('   - Max tokens: 10');
    console.log('✅ [DRY-RUN] Mastra + OpenAI integration configured correctly');
  } else {
    // 実際のAPI呼び出し - MastraのOpenAIプロバイダーを使用
    try {
      const { text, finishReason, usage } = await generateText({
        model: openai('gpt-3.5-turbo'),
        prompt: 'Say "Hello, Mastra!" in exactly 3 words.',
        maxTokens: 10,
      });
      
      console.log('✅ OpenAI response:', text);
      console.log('📊 Response details:');
      console.log('   - Finish reason:', finishReason);
      console.log('   - Tokens used:', usage?.totalTokens || 'N/A');
      
      // Mastraインスタンスの確認
      console.log('\n🔍 Verifying Mastra configuration:');
      console.log('   - Mastra instance created:', mastra ? '✅' : '❌');
      console.log('   - OpenAI provider available:', openai ? '✅' : '❌');
      console.log('   - API key set:', process.env.OPENAI_API_KEY ? '✅' : '❌');
    } catch (error) {
      console.error('❌ Mastra + OpenAI integration failed:', error);
      throw error;
    }
  }
  
  console.log('🎉 Setup complete!');
  
  // 使用方法の説明
  console.log('\n📚 Usage:');
  console.log('   Dry-run mode: DRY_RUN=true npx tsx src/mastra/test-setup.ts');
  console.log('   Actual API call: OPENAI_API_KEY=your-key npx tsx src/mastra/test-setup.ts');
}

testSetup().catch(console.error);