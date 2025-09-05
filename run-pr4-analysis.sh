#!/bin/bash

echo "=== PR #4 分析実行スクリプト ==="
echo ""
echo "環境変数チェック中..."

# 環境変数確認
if [ -z "$OPENAI_API_KEY" ]; then
  echo "❌ OPENAI_API_KEY が設定されていません"
  echo ""
  echo "実行方法:"
  echo "  export OPENAI_API_KEY='sk-xxx'"
  echo "  export GITHUB_TOKEN='ghp-xxx'"
  echo "  ./run-pr4-analysis.sh"
  exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ GITHUB_TOKEN が設定されていません"
  exit 1
fi

echo "✅ 環境変数設定済み"
echo ""
echo "PR #4 の分析を開始します..."
echo "================================"

# Mastra Agent経由で実行
./dist/mastra/cli/index.js agent analyze \
  --pr 4 \
  --post never \
  --format markdown \
  --language ja

echo ""
echo "================================"
echo "分析完了"