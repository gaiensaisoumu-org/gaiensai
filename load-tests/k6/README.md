# k6 負荷テスト

このスクリプトはチケット画面が利用する、状態を変更しない公開APIを測定します。
`BASE_URL` を必須にしているため、意図せず既定値で本番環境をテストすることはありません。

## 実行例

```sh
# スモークテスト（5 リクエスト/秒、30 秒）
BASE_URL=https://staging.example.com RATE=5 DURATION=30s k6 run load-tests/k6/ticket-api.js

# 代表的なチケット状態照会も含める（テスト用コードを使用）
BASE_URL=https://staging.example.com TICKET_CODE='TEST-CODE' k6 run load-tests/k6/ticket-api.js
```

設定できる環境変数は以下です。

| 変数 | 既定値 | 内容 |
| --- | --- | --- |
| `BASE_URL` | なし（必須） | API のオリジン。末尾の `/` は不要です。 |
| `RATE` | `20` | 1 秒あたりの反復回数。各反復で2 API、`TICKET_CODE` 指定時は3 APIを呼びます。 |
| `DURATION` | `1m` | テスト時間。例: `30s`, `5m`。 |
| `PRE_ALLOCATED_VUS` | `10` | 初期仮想ユーザー数。 |
| `MAX_VUS` | `50` | 最大仮想ユーザー数。 |
| `TICKET_CODE` | なし | 任意。状態照会を測定するためのテスト用チケットコード。 |

しきい値は HTTP エラー率 1% 未満、全体の p95 1 秒未満、各APIの p95 800ms 未満です。実環境のSLOに合わせて `ticket-api.js` の `thresholds` を調整してください。

`issue-tickets` は発券・再発券によってデータを変更するため、この負荷テストには含めていません。実施する場合は、隔離した検証環境・使い捨てのテストユーザー・テスト後のデータクリーンアップ手順を用意したうえで、専用シナリオとして追加してください。
