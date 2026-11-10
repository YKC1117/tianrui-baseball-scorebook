# 擁有者需要親自完成的最少步驟

目前未找到已授權且明確屬於天睿的獨立後端。程式與本機服務驗證均可繼續執行，正式連線設定保持 `null`。

1. **建立或授權天睿獨立的個人／球隊組織及專案。** 不選公司組織；由你確認方案與可能費用，再授權 Supabase 連接器讀寫該專案。提供專案名稱／project ref 與 publishable 公開 key 即可供後續設定；不用提供資料庫密碼或 secret key。
2. **在該專案 Dashboard 控制帳號。** 停用公開 signup 及匿名登入，保持多 session 可同時登入，手動建立並確認一組 admin、一組 recorder。密碼由你私下管理，不傳聊天或 GitHub。
3. **SQL 由工程端在明確授權的專案套用後，在 Dashboard 核對兩筆 membership。** `tr_members` 的兩個 user UUID 各指定 `admin`、`recorder`；不把帳密或正式資料提交 repository。最後由你在預覽環境輸入帳密，參與實際兩手機及 iPhone／iPad 驗收。

專案授權完成後，工程端可負責核對 schema、選擇全新 bootstrap 或保留資料的 upgrade、填公開設定、執行只讀 preflight、RLS／交易／advisors 與後端驗收，不需你搬移私鑰。若仍沒有授權專案，就維持「遠端未驗收」與禁止正式部署。

`npm run preflight -- <核准的 project ref>` 只做 12 項公開邊界檢查：Auth 設定、匿名資料表與 RPC 拒絕；不登入、不寫資料，也不能代替帳密、權限、備份還原或真機驗收。沒有有效設定、project ref 不符或防護未確認時會失敗，不能標記成可上線。
