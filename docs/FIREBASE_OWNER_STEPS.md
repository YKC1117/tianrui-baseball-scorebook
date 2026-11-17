# 天睿整合版：一次性 Firebase 設定

已知專案 `tianrui-baseball` 已建立、Email/Password 已啟用。不必建立新專案、新 Gmail、其他服務或付款方式。本環境沒有 Firebase CLI 授權；工程不能代替擁有者寫入遠端，也不能以模擬器結果宣稱已上線。

## 擁有者只需完成這一次

在有 Node 24／Git 的私人終端取得本分支後執行：

```sh
git clone --branch work/integration-final-v15 https://github.com/YKC1117/tianrui-baseball-scorebook.git tianrui-final
cd tianrui-final
npm ci --ignore-scripts
npm run setup:firebase -- --apply
```

1. 使用擁有 `tianrui-baseball` 的既有 Google 帳號完成 Firebase CLI 登入。
2. 依提示輸入管理員的 email。腳本沿用既有帳號；缺少的帳號才會要求你私下輸入兩次新密碼（至少 12 字元、不顯示、不存檔）。球隊共用帳號的內部識別固定為 `recorder@tianrui-baseball.invalid`，不需要真的申請該信箱；**隊友登入畫面只有共用密碼，不需要 email**。既有帳號不會被重設密碼或自動解除停權。
3. 只有尚無 Firestore 預設資料庫時，確認一次區域（台灣可輸入 `asia-east1`；建立後不能更改）。完成後提供產生的 **`.private/firebase-public-config.json`**，其中只有網站必須可讀的四個 Firebase Web 公開欄位。不要提供密碼、OAuth token、service account 或其他檔案。

腳本會檢查專案 ID、未連結計費／Spark 前提、Email/Password、Web App、Standard 原生資料庫，並取得兩個 UID、部署 Rules／索引、建立私有 `access/team` 及補上 `ykc1117.github.io` 授權網域。若已有不同角色 UID，會停止並保留原授權；不覆寫授權、不清資料、不重新啟用帳號。**它不建立專案、不綁信用卡、不升級 Blaze，也不使用 Hosting、Functions、Storage、PITR 或付費備份。** 如遇權限／計費狀態不明，會停止，不能假裝完成。

這是擁有者操作的設定腳本；目前只有工程端測試，尚未在你的真實專案取得授權執行。執行後的公開設定會套用到同一個整合入口，工程再進行遠端驗證；不會因此自動合併 main 或替換正式首頁。

## 上線仍須完成的驗收

- 真實專案兩組登入、未授權拒絕、Rules／交易、雙裝置接手與遠端備份還原。
- iPhone／iPad 真機與跨網路驗收；模擬器及 Linux WebKit 不等同真機。
- 舊 `main/schedule.json` 與公開 Git 歷史隱私盤點。刪除最新版不能消除舊 commit、fork 或下載副本；未備份及確認影響前不重寫歷史。

正式建置 `npm run build:release` 會檢查公開配置與私人驗收紀錄；尚未完成時阻擋正式部署。驗收紀錄由工程依實際結果產生，不需要你填寫假的通過結果。

## 使用與免費方案邊界

共用資料只授權兩個 UID；沒有註冊介面。Firebase Auth 公開註冊 API 仍可能產生未授權空帳號，這些 UID 不能讀寫球隊資料；未使用需要付費的 blocking functions。

停權先將私有 `access/team` 對應的 Enabled 欄設為 false，再停用 Auth／換密碼。舊 ID token 不能只靠 Auth 停用就當成立即撤權；已下載的離線資料無法遠端收回。

離線只有本機草稿，復網用租約與版本檢查；衝突保留草稿並要求安全處理。定期下載完整備份，檔案放私人位置，不上傳公開 GitHub。Spark 有用量及文件大小限制，耗盡時保留草稿、提示未同步，不會由本程式自動付費升級。
