# 天睿 v1.5 Firebase Spark 候選版

日期：2026-11-10。基底 `79d5223fe77701dcbbac58f2b8e5ebc5d30a49e3`。
分支：`work/firebase-spark-v15`。原 Supabase 分支／Draft PR #1 保留；未合併 main、未發布正式站、未建立遠端 Firebase 資源。

## 實作

- GitHub Pages 繼續提供原網址及靜態介面。Firebase JS SDK 固定版本並打包成本站靜態模組，PWA 可離線載入；僅使用 Authentication 密碼登入及 Cloud Firestore。沒有 Hosting、Functions、Cloud Run、Storage、排程、PITR、TTL 或付費匯出／還原服務。
- Firestore 私有 `access/team` 固定兩個 UID 與啟用旗標。只有密碼登入且 UID 核准者可讀隊伍資料；賽程更新限 admin。前端不能新增／修改授權，角色不取自可自行修改的 profile。會員停用立即使資料規則拒絕既有 token。
- 複用既有 IndexedDB 工作區／outbox、版本衝突保留、姓名要求、計分／統計／備份 UI。Firebase 使用獨立的專案＋UID 儲存範圍；不清除或重寫 Supabase、舊版本機名冊、比賽或偏好設定。B 版 Logo 與圖示不變。
- 每次資料交易同時寫入遞增版次、操作 ID、完整內容、不可修改的伺服器稽核（UID、姓名、伺服器時間、前後版次及操作內容）。Rules 用 `getAfter()` 強制資料與新稽核對應；禁止孤立寫入、直接刪除及重用舊操作 ID 推進版次。重試核對相同 ID 的完整請求，防止重複計分。
- 比賽建立與首份租約原子提交。租約約 90 秒、每 30 秒續租，Rules 限最長 120 秒並用 `request.time` 判斷到期。取得／續租／釋放均需建立全新的私有 proof；**兩組客戶端均不能讀 lease 或 proof**，同帳號另一裝置也無法讀取或盲目 patch 憑證。資料交易必須提交有效持有人 token，CAS 另防止過期草稿覆蓋。
- Firestore SDK 僅用記憶體快取；離線寫入由既有持久 outbox 管理，資料交易需連線及通過 Rules，不能讓 SDK 自動將本機舊快照當成功。網路／配額／大小錯誤保留待同步；逾時後重試使用同 ID，遲到的已提交回應不會重複累加。
- 修正手動同步重設紀錄姓名，以及同步途中仍編輯導致表單被後來雲端快照取代的交錯問題。手動讀取期間暫停畫面操作，同場持續紀錄保留姓名；重新開始／續賽／接手仍必填新姓名。
- 管理員雲端稽核備份包含所有遊戲／名冊／賽程、版本與伺服器稽核；備份前後讀取版次比較，變動時拒絕宣稱一致備份。SHA-256 檢查誤改／毀損；不是加密或簽章。租約秘密與登入憑證不進備份。還原經既有驗證及新遊戲 ID，保留原有比賽。

## 測試與重現

以下測試以合成資料執行，不使用正式帳密、球員或賽事。正式結果由本分支 CI 及 PR 記錄補充；模擬器結果不能冒充 Firebase 正式專案或 iOS 真機驗收。

| 項目 | 本機結果 | 證據範圍 |
|---|---|---|
| Node 單元／整合 | 31 通過 | 原有統計、outbox、帳號綁定；新增備份校驗與 Firebase preflight |
| Auth／Firestore Emulator | 10 情境 | 真實 SDK 登入、Rules、交易、同帳號競寫、撤權、雲端備份還原；非正式 Firebase |
| Firebase 瀏覽器流程 | 6 通過 | Chromium／WebKit 各 3；雙 browser context、離線 PWA 重開、衝突、角色／賽程 |
| 原有瀏覽器回歸 | 28 案例 | 26 fixture／PWA，加 2 本機真實 Supabase；保留打擊、跑壘、守備、PNG／CSV／JSON、匯入還原 |
| 原 PostgreSQL 權限／交易 | 63 斷言通過 | 回復分支 SQL 與升級，不能當成 Firebase 驗收 |
| 原本機 GoTrue／PostgREST | 26 檢查通過 | 回復分支 Auth／REST／資料庫備份還原 |
| 生產依賴 audit | 0 已知漏洞 | Firebase 13.2.0；固定安全版本 grpc 1.14.7，瀏覽器只打包 Auth／Firestore |
| 開發依賴 audit | 14 個中等風險傳遞項目 | 最新 Firebase CLI 上游的 glob／OpenTelemetry 等；不進網站產物，未以破壞相容的強制降級掩蓋 |
| CI | 以新 Draft PR 的該提交 checks 為準 | 包含全部上述測試與 SDK 重建一致性；沒有部署工作 |

Linux WebKit 測試使用可攜系統函式庫啟動器；CI 安裝官方所需系統套件。這不等於 iPhone／iPad 真機已驗收。私有 lease／proof 也測試同帳號盲 patch 拒絕；兩角色 UID 誤設相同時拒絕全部授權，避免共用帳號意外升成管理員。

```sh
npm ci --ignore-scripts
npm run build:firebase
npm test
npm run test:firebase
npx playwright install --with-deps chromium webkit
npm run test:firebase:browser
npm run test:browser
# 原 Supabase 回復驗證（需要獨立 Docker 測試容器）
npm run test:db
npm run test:local
node scripts/build-upgrade.mjs --check
npm run privacy:inventory
npm audit --omit=dev
```

Auth／Firestore Emulator 使用 `demo-tianrui`，只監聽 loopback，沒有連線到正式 Firebase。Node 測試以同版本 SDK 的 Node transport 執行；瀏覽器測試實際使用提交的瀏覽器 SDK、Auth／Firestore 模擬器與 Rules，不攔截 Firebase API。原 Supabase fixture／本機整合測試獨立保留，只能證明舊功能／回復分支，不當作 Firebase 安全證據。

新增驗證：未登入／未核准／匿名供應商拒絕、錯誤密碼、同帳號兩個 session、角色提升拒絕、賽程 admin 限制、稽核不可修改、資料／稽核原子性、兩個建立者及兩個競寫者只一個成功、私有租約讀取與盲 patch 拒絕、到期／交接、完整請求冪等、離線重開後恢復、復網衝突保留兩份、授權停用立即拒絕、校驗備份及新 ID 還原。

## 免費方案的實際邊界

1. Spark 不需付款方式；Firestore 免費量目前為 **1 GiB 儲存、每日 50,000 次讀、20,000 次寫、20,000 次刪，月傳出 10 GiB**。Rules 依賴讀取、重試、備份也可能計入用量。遊戲修改約四份文件寫入（遊戲、稽核、lease、proof），續租約兩份。完整快照稽核會增加儲存，不能宣稱可無限保存整季。配額耗盡需等待／先私人備份後另審查封存，不能自動收費或刪資料。
2. Firestore 文件上限 1 MiB；用戶端以 700,000 UTF-8 bytes 提前拒絕大型狀態。長場次／大量歷史接近上限時保留草稿並提示備份，不能假裝已同步。UI 不做無限配額承諾。
3. Firebase ID token 通常最長約一小時。純 Spark 靜態應用不能在 Rules 直接查 Auth 帳號即時停用／撤銷狀態；立即資料撤權必須使用 `access/team` Enabled 欄。單純 Auth 停用不算已完成即時撤權。離線快取已取得資料也不能收回。
4. 無公開註冊 UI，未知 UID 讀寫被 Rules 拒絕；本版不保證禁止外人經 Firebase Auth 公開 API 建立空帳號。需要完整禁止 Auth signup API 時，須另做專案能力驗證；沒有使用付費 blocking functions。
5. 共用帳號的姓名由操作者自填，不能證明個人身分。離線只允許本機草稿，不可能即時確認另一台離線手機；復網必須租約＋CAS。手動「重新同步／讀取」更新另一裝置的共用內容，沒有背景覆蓋正在編輯的表單。
6. 裝置時間明顯不準會讓租約寫入被拒絕；Rules 始終以伺服器時間判斷，不會因此繞過有效租約。先校正裝置自動時間再重試，草稿保留。
7. 官方受管理匯出／備份／PITR／TTL／還原需啟用 billing，未使用。本版是手動下載及應用程式還原，不能宣稱有無人值守的災難復原或原地資料庫完整還原。

## 未驗收與回復

- **天睿專用 Firebase Spark 正式專案尚未設定／授權：未驗收。** 真實登入、兩組 UID、區域、配額、正式 Rules、Auth 停用流程、跨網路雙裝置及遠端備份還原均待完成。
- **iPhone／iPad 真機：未驗收。** Linux Chromium／WebKit 的手機／平板尺寸測試不能代替真機背景休眠、飛航模式及檔案下載。
- 舊 main／Git 歷史公開資料仍依 [PRIVACY_MIGRATION.md](PRIVACY_MIGRATION.md) 處理。新依賴與測試只含合成 fixture。沒有 force push、歷史重寫、刪除正式資料或修改現行正式部署。
- Supabase schema、adapter、測試與文件均保留；完整回復基準是原 `work/secure-sharing-v15` 的 `79d5223`。切換前匯出兩邊完整備份，不能直接把一個後端的待同步 ID 重放至另一個後端。正式 main 尚未變動，無需回退部署。

擁有者最少操作見 [FIREBASE_OWNER_STEPS.md](FIREBASE_OWNER_STEPS.md)。

參考官方文件（2026-11-10 查閱）：[方案](https://firebase.google.com/pricing)、[Firestore 配額及付費備份項目](https://firebase.google.com/docs/firestore/quotas)、[交易／getAfter](https://firebase.google.com/docs/firestore/manage-data/transactions)、[Rules 存取呼叫限制](https://firebase.google.com/docs/rules/rules-behavior)、[Auth session](https://firebase.google.com/docs/auth/admin/manage-sessions)。
