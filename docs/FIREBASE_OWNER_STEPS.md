# 天睿 Firebase Spark：擁有者最少設定

目前程式與模擬器可以在沒有正式專案時完成測試；`src/config.mjs` 保持 `null`。尚無已授權的天睿 Firebase 專案設定，沒有建立遠端資源、借用公司專案、修改 GitHub Pages 或開啟付費方案。

## 只需在 Firebase Console 完成一次

1. 開啟 <https://console.firebase.google.com/>，用球隊／你個人的帳戶「新增專案」，確認名稱與所有權屬於天睿。略過 Google Analytics，保持 **Spark、未連結 Cloud Billing**。遇到要求信用卡或 Blaze 即停止；本系統不需要該功能。
2. 「建構 → Authentication → 開始使用 → 登入方式」只啟用 **電子郵件／密碼**。在「Users → 新增使用者」手動建立管理員與全隊共用紀錄帳號各一組。密碼由你保管及安全交付隊員；不要貼在聊天、GitHub、程式或文件。在「Settings → Authorized domains」加入 `ykc1117.github.io`。
3. 「建構 → Firestore Database → 建立資料庫」選 **Standard、原生模式、預設資料庫、正式模式**，選適合球隊的區域。保持 Spark。將本分支根目錄 `firestore.rules` 完整貼至「Rules → Publish」。不要使用測試模式或 `allow read, write: if true`。
4. 在 Firestore「Data」新增 collection `access`、document `team`，建立以下四欄。UID 從 Authentication Users 複製，只放在私有資料庫；**不是電子郵件、密碼，也不寫進 GitHub**。

   | 欄位 | 類型 | 內容 |
   |---|---|---|
   | `adminUid` | string | 管理員的 Auth UID |
   | `recorderUid` | string | 共用紀錄帳號的 Auth UID，須與管理員不同 |
   | `adminEnabled` | boolean | `true` |
   | `recorderEnabled` | boolean | `true` |

5. 「專案設定 → 一般 → 你的應用程式 → Web（`</>`）」登記網站，**不要勾選 Hosting**。將 SDK 設定中的公開 `projectId`、`apiKey`、`authDomain`、`appId` 填入 `src/config.mjs` 的 `cloudConfig` 物件。這些是網站必須可讀的公開設定，不是 Admin SDK 私鑰；仍須確認專案屬於天睿。不要下載或提供 service account JSON。套用本分支的 `firestore.indexes.json` 排除大型 payload 索引，避免文件變大後撞索引限制。

規則及索引可由擁有者在本機登入 CLI 一次後套用，**務必使用實際天睿 Project ID，不能照抄模擬器 ID**：

```sh
npm ci --ignore-scripts
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes --project <實際天睿專案ID>
npm run preflight -- <實際天睿專案ID>
```

`<實際天睿專案ID>` 是待你填入的參數，不是正式設定。不要執行 `firebase init`、Hosting／Functions 部署、升級 Blaze 或綁付款方式。preflight 只檢查公開匿名邊界；不會登入、寫入、確認付費狀態或代替完整驗收。

## 上線前的工程驗收

完成上述設定後，才可在獨立預覽環境測試真實登入、兩個 UID、Firestore Rules、雙裝置及備份還原。正式帳密無須交給工程人員；可在授權的安全登入環境操作。iPhone／iPad 真機與正式 Firebase 尚未驗收，Draft PR 不能直接合併或發布。原 GitHub Pages 網址與 main 均保留。

## 最少日常操作與安全限制

- 每場開始、繼續或交接填紀錄人員姓名；離線狀態只代表本機草稿。按「重新同步／讀取」確認待同步為 0，另一手機同樣讀取即可看到共用資料。
- 交接前先同步並按「交出紀錄權」。裝置失聯約 90 秒後租約到期，接手仍檢查版本；先備份再處理衝突。
- **停權先到 `access/team` 將對應 Enabled 欄設為 `false`，再停用 Auth 帳號、改密碼或撤銷登入。** 這會立即阻止之後的雲端讀寫；只停用 Auth 可能仍有最長約一小時的舊 ID token。已下載的裝置資料不能遠端收回。
- 定期按「完整備份」下載本機待同步資料；管理員可另按「雲端稽核備份」，保存共用資料與伺服器稽核及 SHA-256 校驗。檔案含球員資料，放私人磁碟／私人備份位置，不上傳公開 GitHub。還原新增比賽，不覆蓋現有紀錄。
- Spark 配額有限，耗盡會停止服務並保留待同步資料；不會因本程式自動升級或產生月費。Console Usage 可查看用量。沒有免費自動雲端備份、PITR、TTL 清理或付費資料庫還原；此版使用手動 JSON 備份及受保護的應用程式還原。
- 沒有註冊入口，其他 Auth UID 一律不能讀寫球隊資料。**這不宣稱已封鎖 Firebase Auth 的公開註冊 API**；即使有人自行建立空帳號，亦不會取得球隊授權。若要求連空 Auth 帳號都完全禁止建立，須另驗證專案能力，不能以本版或付費 blocking functions 冒充完成。

Supabase 回復依據：`work/secure-sharing-v15`、`79d5223`、Draft PR #1，均保留。
