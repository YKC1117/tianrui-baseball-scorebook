# 天睿 v1.5 後端設定與驗收

本文件不含正式連線資訊。`src/config.mjs` 保持 `null`，因此目前不會假登入或假同步。不得套用到其他公司的 Supabase 專案。

## 獨立專案

1. 確認個人／球隊獨立組織、專案名稱與 project ref，以及費用和所有權。此次沒有建立、啟用或修改任何遠端 Supabase 專案。
2. 在全新天睿專案審查並執行 `staging/sql/001_shared_backend.sql`。這是尚未部署的 bootstrap，不能在既有資料庫反覆重跑，也不是已執行的正式 migration。
3. 若先前另有部署過初稿，先備份並製作相容 migration；不要刪表重建。正式 migration 應以 Supabase CLI 建立及核對版本歷史。
4. Data API 僅暴露 `public`；不要暴露 `tr_private`。明確 GRANT 與 RLS 已在 SQL 內，不能依賴專案預設 grants。

## Auth 與兩組授權帳號

1. 在 Dashboard 停用公開 signup 與匿名登入；沒有前端註冊按鈕不能代替這項設定。
2. 手動建立並確認一組管理員、一組共用紀錄帳號。密碼只在管理者與隊員之間安全交付，不提交到 GitHub 或聊天。
3. 以 Dashboard／受保護的管理流程，將兩個 Auth user UUID 分別加入 `public.tr_members`，角色為 `admin`、`recorder`。角色欄位有 UNIQUE 限制，每種角色最多一組核准帳號。其他 Auth 使用者不會自動取得權限。
4. 保持多裝置 session 可同時使用；不要開啟會踢除另一裝置的 single-session 限制。前端登出採 `scope=local`。
5. 管理員變更共用密碼先使用 Supabase Dashboard；撤銷存取時停用對應 membership 並撤銷 sessions。已有稽核資料的 Auth user 不應直接刪除。設定合適 JWT 效期並驗證撤權後端行為。
6. 角色來源是管理端維護的 membership 表，不使用使用者能修改的 `user_metadata`。姓名是操作者自填，不能視為已驗證個人身分。

## 靜態程式設定

確認獨立後端後，`src/config.mjs` 僅填該專案 HTTPS URL 及 `sb_publishable_` 公開 key。不能放 service-role／secret key、帳號、密碼或 token。公開 key 的保護依據是 RLS 與受限 RPC。

SQL 的公開 SECURITY DEFINER RPC 是刻意設計的單一交易寫入邊界：直接寫表被撤權；所有入口重新檢查核准會員、姓名、角色、版本及租約；內部 helper 與重試資料在非暴露 schema，search_path 固定為空，PUBLIC／anon 的 EXECUTE 已撤銷。新比賽與第一份租約在同一交易建立，避免開賽後出現尚無持有人可被另一裝置搶先接手的空窗。

後端租約為 120 秒，前端約每 30 秒續租；同一分頁重新整理保留裝置 token。不同裝置 token 不同。同瀏覽器同帳號另有 Web Locks 及 IndexedDB generation 檢查，避免兩分頁覆蓋待同步工作區。

## 遠端驗收前不得合併

- 用未登入、錯誤密碼、未核准 Auth 使用者測試實際 REST 讀取、直接 INSERT／UPDATE／DELETE 與全部 RPC。
- 驗證停用 signup、只有兩組 membership、recorder 無法更新賽程、admin 可以更新；停用會員後立即禁止 DB 讀寫。
- 兩裝置登入同一 recorder，同時開賽、接手、租約續期／到期、舊版 CAS、回應遺失後重試及復網衝突。
- 以 Supabase advisors 檢查 security／performance；核對 grants、RLS、schema exposure 及 RPC 型別。此次未對遠端執行 advisors。
- 用測試資料完成資料庫備份與還原演練。瀏覽器 JSON 備份是額外保護，不能代替資料庫備份。
- iPhone／iPad Safari 與獨立 PWA 真機飛航模式、重開、復網，以及 PNG／JSON／CSV 儲存。
- 在獨立預覽環境驗收後才考慮合併。GitHub Pages 目前仍指向 main；本 PR 不會自動部署或合併。

## 歷史公開資料處理

本分支移除 `schedule.json` 與 GitHub Token 發布流程，新版 service worker 刪除舊 `tianrui-baseball-*` 快取並阻擋該 JSON 路徑；不清除 localStorage 球員、比賽或設定。

這不代表 main、舊 Git commit、PR diff、fork、CDN 或尚未更新的裝置副本已被清除。主分支目前維持舊版。先盤點及私下備份，再另行決定歷史重寫、舊部署移除、快取失效與通知；此次沒有 force push、改寫歷史或宣稱舊資料已私密化。
