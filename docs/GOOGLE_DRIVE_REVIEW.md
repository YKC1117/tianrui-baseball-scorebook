# Google Drive 候選版交付與限制

依 [PR #4 留言 #6965748919](https://github.com/YKC1117/tianrui-baseball-scorebook/pull/4#issuecomment-6965748919)，從 `1313709` 接續；Firebase 正式取消，舊成果僅供 Git 分支回復。新入口、build、依賴及 CI 不載入 Firebase／Firestore／Supabase，不需要公司電腦指令、資料庫或付費服務。

## 已施工

- 沿用核定新版 UI、Logo 及同一記分引擎；保留快速鍵／排序、DH／獨立投手、S3／不死三振、半局提示、換人、全部統計、出席／守位、賽程及匯出。舊資料與舊工作區不清除。
- GitHub Pages 可立即本機記分；`?demo=1` 使用獨立模擬工作區。模擬範例不能連接／上傳到 Drive，必須先離開範例。個人工作區與範例隔離，範例不會取代隊伍資料。
- Google 官方 GIS token model + Picker，僅要求 `drive.file`；Google 密碼只輸入 Google 視窗。token 只存在記憶體，不進 localStorage／sessionStorage／備份／URL／Git。API 實例綁定取得授權的那次 session，切換帳號後舊 API 不能使用新帳號 token。
- Google 帳號 permission ID、資料夾 ID 分隔 IndexedDB 工作區，分頁有 Web Locks／本機 generation 檢查。重新開啟可用既有快取離線記分，重新上傳需 Google 授權與核對版本；退出會清除自動開啟綁定而不刪本機資料。不同帳號被拒絕存取時，不展示前一帳號工作區。
- 使用者明確選擇資料夾，再確認首次初始化；不把看不到的檔案當成空隊伍。網站拒絕「知道連結的任何人」存取。未取得完整可見資料、權限或 API 結果時不顯示儲存成功。程式沒有開放分享、覆寫、刪除、改名或重寫既有檔案的 API。
- 所有雲端更新以 **POST 新增版本檔**，保留父版 ID、SHA-256、操作者、時間、操作內容及本機 generation。30 秒內合併的儲存仍保留每筆具名操作及前後欄位差異；撤銷不抹掉操作歷史。遺失 HTTP 回應後保留原操作 ID，重試先讀回核對，重複檔案可辨識為同一邏輯操作。
- 同一文件兩個分支不猜誰較新，不依賴用戶時間排序覆蓋。顯示衝突、停止上傳，保留兩份；使用者選擇後以新的合併版本連結兩個父版。處理前下載備份，其他分支與本機檔仍保留。既有版本的 Drive `version`／`modifiedTime` 被改動或不可見時停止採用。
- 同一隊伍資料夾一次一台紀錄裝置，Google ACL 決定可編輯／唯讀。開始、繼續或接手仍要填姓名。裝置協調紀錄 120 秒有效、每 30 秒嘗試續期；逾時、離線及授權失效保留本機草稿，重新接手才恢復儲存。查看者手動重新讀取，不宣稱即時雙向同步。
- 完整備份有校驗、含待儲存資料／衝突／常用鍵；可下載、另存私人 Drive、還原。還原前先下載備份，比賽以新 ID 加入，不覆蓋已存在比賽；只有空白名冊／賽程才匯入。新 bundle 只含合成範例，沒有真實名冊、賽程或舊公開 `schedule.json`。

## 為何不是多人同時計分

Google Drive v3 的公開 `files.update` 契約沒有本實作可依賴的原子 CAS 參數；`version` 是單調版本標記，不是原子寫入條件，`headRevisionId` 只適用二進位內容。不能拿「先讀再覆寫」當成交易鎖。因此本實作從不覆寫資料檔，並且明確降為 **單人記分／其他人查看**。裝置協調只是提示，不是 Firestore 租約、可信伺服器時鐘或不可繞過的安全鎖。兩台競爭仍可能產生分支，但不會以最後寫入取代另一份紀錄。

本版不提供跨檔資料庫交易、可信伺服器稽核、多人同時寫入或惡意 Drive 編輯者防護。具有 Drive 編輯權的人可以繞過網站改檔、刪檔或改分享；網站只能在讀回時偵測，不可宣稱能阻止。撤銷分享不能收回已下載的離線資料。備份、版本與協調小檔會占 Drive 免費配額；滿額／429／5xx 時保留本機草稿，不自動付費。

## 逐檔授權與一次性設定

`drive.file` 只授權此 app 建立或經 Picker 開啟的檔案，選主資料夾不代表遞迴開啟所有子檔案。不使用不能跨帳號分享的 `appDataFolder`，也不擴大到整個 Drive 的受限 scope。若既有入口、子資料夾或版本不可見，提供 Picker 補選子資料夾／JSON 的流程；無法完整讀取時不建立空白覆蓋。

真實跨帳號「app 建立檔案＋共用 ACL＋Picker」可見性仍需用同一 Cloud app 的真實 Google 帳號驗收；模擬器假設不會當成 Google 已核准。設定方法見 [瀏覽器一次性步驟](GOOGLE_DRIVE_SETUP.html)：擁有者只用網頁取得 Web client ID、專案編號、Picker 公開 key，並建立限制分享的隊伍資料夾。這些公開值也可交由工程套入同一固定入口，之後球友不必每人建立專案或各自填三欄；密碼／token／client secret 不得提供給工程。

## 驗證與未驗收

工程測試命令：`npm test`、`npm run test:drive:browser`、`npm run test:ui`、`npm run build:drive`、`npm run privacy:inventory`。這些命令由工程執行，不要求擁有者操作。實際計數、CI、SHA 及唯一最新網址記錄在交付 Draft PR。

瀏覽器整合測試跑實際 bundle，Google GIS、Picker、Drive v3 的回應由測試攔截模擬，涵蓋多帳號／唯讀／未授權、同時版本分支、交出接手、離線重開、復網衝突、token 不落地、錯誤／配額及明確初始化。Chromium／WebKit 的手機、平板、桌面與原 165 UI 流程都回歸；這不等於真實 Google 或 iOS 真機。

**未驗收：** 真實 OAuth 同意／發布狀態、Picker 共用子檔案授權、Drive ACL／實際併發可見性、真實跨網路手機／iPad。尚無使用者提供的 OAuth 用戶端或資料夾，不會聲稱已連接或正式上線。`build:release` 在設定及這些真實驗收未完成時阻擋正式發布。

main 的歷史 `schedule.json` 公開風險仍待處理；本次不讀取其私人內容、不複製到新產物、不刪資料、不 force push、不重寫歷史。正式首頁保持不變；只發布獨立候選目錄，PR 維持 Draft。

## 官方契約（2026-11-18 核對）

- [Drive scope／drive.file](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google 官方 token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Picker 範例與 app ID／origin](https://developers.google.com/workspace/drive/picker/guides/sample)
- [Drive v3 File：isAppAuthorized、version、headRevisionId](https://developers.google.com/workspace/drive/api/reference/rest/v3/files)
- [files.update 公開參數](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
