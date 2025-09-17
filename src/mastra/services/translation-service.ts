/**
 * Translation Service
 * Handles text translation using OpenAI API for natural Japanese translation
 */

/**
 * Translates recommendation text to Japanese using OpenAI API
 */
export async function translateRecommendation(rec: string): Promise<string> {
  // Skip translation if already in Japanese or very short
  if (rec.length < 10 || /[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf]/.test(rec)) {
    return rec;
  }
  
  try {
    // Use OpenAI for natural translation
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: '技術的な推奨アクションを自然な日本語に翻訳してください。技術用語は適切な日本語に翻訳し、コード名（バッククォートで囲まれた部分）はそのまま保持してください。丁寧語を使用してください。'
          },
          {
            role: 'user',
            content: rec
          }
        ],
        temperature: 0.1,
        max_tokens: 200
      })
    });
    
    if (!response.ok) {
      throw new Error(`Translation API failed: ${response.status}`);
    }
    
    const data = await response.json() as any;
    const translated = data.choices?.[0]?.message?.content?.trim();
    
    return translated || rec; // Fallback to original if translation fails
  } catch (error) {
    // Removed debug logging - use structured logging instead
    console.warn('Translation failed, using original text:', error);
    return rec; // Fallback to original text on error
  }
}

/**
 * Translate an array of recommendations
 */
export async function translateRecommendations(
  recommendations: string[], 
  language: 'en' | 'ja'
): Promise<string[]> {
  if (language === 'en') {
    return recommendations;
  }

  const translatedRecommendations = await Promise.all(
    recommendations.map(rec => translateRecommendation(rec))
  );
  
  return translatedRecommendations;
}