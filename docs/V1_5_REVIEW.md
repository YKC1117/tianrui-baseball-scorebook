> 本文件保留 Supabase `79d5223` 工程供回復。Firebase Spark 候選版請改讀 [FIREBASE_REVIEW.md](FIREBASE_REVIEW.md) 與 [FIREBASE_OWNER_STEPS.md](FIREBASE_OWNER_STEPS.md)。

# 天睿棒球紀錄系統 v1.5｜第二階段施工與測試報告

日期：2026-11-10（台灣時間）
分支：`work/secure-sharing-v15`
審查：[Draft PR #1](https://github.com/YKC1117/tianrui-baseball-scorebook/pull/1)

**狀態：接續 39a01ee 的可部署候選程式（正式後端與真機未驗收），尚未正式上線。沒有合併 main、修改正式站或使用其他公司的 Supabase。**

已閱讀附件施工包、main 與開發分支、原有 SQL／REST adapter／登入頁／測試及 Draft PR #1；PR 原本沒有評論或 review。附件用作參考，施工範圍依本次需求。

## 已完成

- 將原有計分程式抽成模組，登入後才載入私有工作區；保留原有手機介面、賽前排陣、賽中換人、打擊／投球／守備／跑壘與匯出。B 版 Logo 與兩張圖示位元組均與 main 相同。
- 僅支援管理員與共用紀錄角色，無自行註冊入口。後端 membership 每種角色最多一組；賽程更新只允許 admin。登出限本裝置 session。
- 每次開賽、續賽、接手均要求非空姓名。事件保存姓名與用戶端時間；後端追加不可由用戶端修改的稽核列，含 actor UUID、姓名、伺服器時間、內容、操作 ID 與前後版次。
- 遊戲、名冊、賽程經交易 RPC 寫入；新遊戲與首份租約原子建立。共用帳號以不同裝置 token 區分持有人。租約取得／釋放／寫入使用同一交易鎖；CAS 阻止舊版覆蓋。
- 持久化 outbox 與工作區在同一 IndexedDB 交易保存；重試沿用操作 ID。後端核對完整 JSONB 請求與 actor，防止同 ID 改內容或重複計分。跨分頁另有 generation 與 Web Locks 防護。
- 離線顯示待同步數與最後成功時間，快取資料可繼續記錄草稿。復網先驗證 session／membership／租約並逐筆同步；衝突保留原稿，提供另存比賽或備份後採用雲端。離線姓名仍須重新填寫；首次登入必須連網。
- 正式名冊允許空白背號，支援球員只存在當場名單。單場及完整備份、CSV、PNG 保留；undo／redo 不會清除獨立 auditTrail。
- 舊 `TR_BASEBALL_OFFLINE_V1` 與既有賽程 localStorage 鍵不會被寫入或清除。匯入前提供完整備份；還原比賽使用新 ID，保留來源與歷史稽核副本，不覆蓋雲端比賽。已有名冊時不自動用舊名冊取代；空賽程的還原只供 admin。封存取代永久刪除。
- 移除公開賽程 JSON 與 GitHub Token 發布流程；賽程改走相同登入與私有資料來源。service worker 僅快取靜態程式，清理舊版本 CacheStorage，不快取 Auth／REST 回應。
- 加入 PR／開發分支 CI，不包含部署及合併工作。

## 驗證結果

| 驗證 | 結果 | 範圍 |
|---|---|---|
| Node 測試 | 29 通過 | 含原始 gateway 六情境、refresh、登出、操作重試、佇列、衝突、備份、儲存失敗、跨分頁版本及統計 |
| 真實本機 PostgreSQL 17.11 | 63 項斷言通過 | 套用完整 SQL，RLS、匿名／未核准拒絕、直接寫表拒絕、兩角色、租約、相同請求重試與兩個連線競寫 |
| Playwright | 28 通過 | Chromium 手機尺寸與 WebKit 平板尺寸各 14 案例；包含兩個獨立 browser context 共用帳號、離線重載、PWA、衝突 UI、備份還原及賽程權限 |
| 真實本機 Auth／REST | 26 項檢查通過 | GoTrue v2.197.0、PostgREST v14.18、密碼登入、停用 signup、撤權、同帳號不同 session、資料庫 dump 還原 |
| 統計數值 | 通過 | 二次登板 8 outs + 6 outs = 4.2 IP，分次 2.2／2.0；ERA／WHIP、打擊、跑壘、R/H、提前結束 |
| 程式與依賴 | 通過 | 模組語法、git diff --check、npm audit 零已知漏洞；正式環境無新增 npm runtime 依賴 |
| Logo／圖示 | 通過 | 與 main 逐位元組比對相同 |

測試只用人工合成資料。26 個瀏覽器案例使用攔截 fixture；另外 2 個案例把請求轉送至本機真實 GoTrue／PostgREST／PostgreSQL，實際執行 Auth、JWT、RLS 與交易。這仍不代表遠端 Supabase gateway／TLS／專案設定已驗收。PostgreSQL 權限測試另使用本機 auth.uid／sessions fixture；Linux WebKit 不代表 iOS 真機。

## 第二階段實際修正

- 修正租約失效與前景儲存交錯時可能丟掉修改的問題；已授權的前景快照會保留姓名票據並寫入 outbox；工作區綁定 Auth user ID，舊帳號草稿不會由新帳號送出，失去紀錄權後的新操作仍會被阻止。
- 修正封存先清空 activeId 導致修改未入列的問題；遊戲與既有成績保留，另有稽核。
- 首頁繼續比賽強制重新填姓名，新增明確交出紀錄權流程。
- RLS／RPC 依真實 Auth session、停用時間及會員狀態授權；已登出、Auth ban、session 到期或 membership 停用均無法沿用舊 JWT 讀寫。
- 拉取前後確認會員權限；缺頁、異常空資料或惡意／無效 ID 不會取代已有快取。名冊、賽程與遊戲在前端及交易入口驗證。
- 請求含回應 body 的 15 秒 timeout、body 中斷視為離線、暫時性 Auth 5xx 保留登入；登出後遲到的 refresh 不得復活 session。
- 除新版 bootstrap 外，加入保留既有資料的 002 upgrade 與自動 drift 檢查；本機從 39a01ee schema 升級，保留 game／audit／操作 ID 並驗證撤權。
- 真實本機資料庫 dump 還原比較 game／audit／requests 內容 checksum 及 RLS／ACL；原始 dump 只在測試程序記憶體，不提交 repository。
- 新增不需密碼的只讀公開邊界 preflight，以及只讀 Git 歷史盤點工具。盤點與清理方案見 [PRIVACY_MIGRATION.md](PRIVACY_MIGRATION.md)。

## 尚未完成與限制

1. 尚未取得已確認的天睿獨立 Supabase 設定，`src/config.mjs` 保持 `null`。目前無法使用正式帳密或跨實際裝置連線；未套用遠端 SQL、建立帳號、修改遠端 Auth 或執行遠端 advisors。
2. 真實 Supabase 上的 RLS／PostgREST／JWT／停用註冊／雙裝置共用帳號／撤權與資料庫備份還原，須在獨立專案驗收；完整步驟見 [BACKEND_SETUP.md](BACKEND_SETUP.md)。
3. iPhone／iPad 真機飛航模式、長時間場邊紀錄、背景／前景租約、相片與檔案下載尚待驗收。未支援 Web Locks 的舊瀏覽器會拒絕進入編輯介面。
4. 新版不再供應公開賽程，不等於舊 main、Git 歷史、PR diff、CDN 或未更新裝置上的舊資料已被清除。此次沒有改寫歷史；需要另行盤點與處理。
5. 紀錄姓名由共用帳號操作者自填，不是個人身分驗證。離線時無法即時知道其他裝置的寫入；須復網檢查版次。
6. 完整備份保留原始待同步／衝突資料供人工查核；還原以新比賽／新操作重建，不直接重放原 outbox 到另一帳號或專案。已存在的名冊／非空賽程須人工比較後更新。

## 重現測試

```sh
npm ci --ignore-scripts
npm test
docker run --name tr-v15-postgres -e POSTGRES_HOST_AUTH_METHOD=trust -d postgres:17-alpine
# 等候 docker exec tr-v15-postgres pg_isready -U postgres 成功
npm run test:db
npm run test:local
node scripts/build-upgrade.mjs --check
npm run privacy:inventory
npx playwright install --with-deps chromium webkit
npm run test:browser
```

測試資料庫無公開連接埠；`test:db` 僅重建該測試容器內固定名稱的 `tr_v15_test` 資料庫。CI 自動執行相同流程。此次沙箱 WebKit 以臨時工作目錄提供系統函式庫與啟動器，沒有修改應用程式來跳過測試。

## 回復方式

正式站仍在原 main commit，無需回退部署。若試用本分支，先匯出完整工作區，再回到舊站；舊版本機資料鍵未改寫。不要清除網站儲存、重設資料庫或以舊快照直接覆蓋雲端。後端上線前仍需獨立備份與還原演練。

擁有者最少操作步驟：[OWNER_STEPS.md](OWNER_STEPS.md)。沒有執行 force push、歷史重寫或刪除正式資料。
