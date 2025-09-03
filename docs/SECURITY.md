# セキュリティガイド：APIキーの安全な管理

## 🔐 APIキーの取り扱い

### ✅ 推奨される方法

#### 1. 環境変数ファイル（.env）の使用
```bash
# .envファイルを作成
cp .env.example .env

# エディタで.envファイルを編集
# OPENAI_API_KEY=your-actual-key-here
```

#### 2. 実行方法
```bash
# .envファイルから自動的に読み込まれます
npx tsx src/mastra/test-setup.ts
```

### ❌ 避けるべき方法

#### コマンドラインで直接指定（非推奨）
```bash
# NG: ログに残る可能性があります
OPENAI_API_KEY="sk-..." npx tsx src/mastra/test-setup.ts
```

## 📋 チェックリスト

- [ ] `.env`ファイルが`.gitignore`に含まれていることを確認
- [ ] APIキーを含むコマンドを実行履歴から削除
- [ ] コミット前に`git status`で`.env`が追跡されていないことを確認
- [ ] ログファイルにAPIキーが含まれていないことを確認

## 🛡️ セキュリティベストプラクティス

1. **APIキーの定期的な更新**
   - 3ヶ月ごとにAPIキーを再生成
   - 不要になったキーは即座に無効化

2. **最小権限の原則**
   - 必要最小限の権限のみを付与
   - テスト用と本番用でキーを分離

3. **環境ごとの管理**
   ```
   .env.development  # 開発環境
   .env.test        # テスト環境
   .env.production  # 本番環境（絶対にコミットしない）
   ```

4. **履歴のクリーンアップ**
   ```bash
   # bashの場合
   history -c
   
   # zshの場合
   history -p
   ```

## 🚨 漏洩時の対応

1. **即座にキーを無効化**
   - [OpenAI Dashboard](https://platform.openai.com/api-keys)でキーを削除
   
2. **新しいキーを生成**
   
3. **影響範囲の確認**
   - 不正な使用がないか確認
   - ログを確認

4. **再発防止策の実施**
   - セキュリティプロセスの見直し
   - チーム内での共有

## 📚 参考リンク

- [OpenAI API Key Best Practices](https://platform.openai.com/docs/guides/production-best-practices)
- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure)