# 天睿 v1.5 整合收尾

依 2026-11-17 [施工留言 #6950147851](https://github.com/YKC1117/tianrui-baseball-scorebook/pull/3#issuecomment-6950147851)，分支 `work/integration-final-v15` 從 UI `5a09a70` 接續（已含 Firebase `6cc3f78`）。僅有一個整合收尾分支／Draft PR，不合併或替換 main 正式入口。

## 已完成的工程

- 正式來源入口改用已核定新版 UI，直接掛載既有 `mountScorebook` 與 Firebase adapter。公開候選產物不匯入任何 preview fixture，初始正式資料為空；Logo、快速記分、常用鍵／排序、賽程、名單、DH、S3、未接捕改判與匯出沿用同一份引擎。
- 隊友登入僅輸入共用密碼，固定非機密內部 email 識別；管理員可輸入自己的帳號。無註冊入口。密碼僅短暫交給 Auth，立即清空欄位，未存入 URL、設定或 Git。
- 兩個 UID 與啟用旗標留在私有 `access/team`，不以公開設定推導權限。原私有租約／proof、CAS、冪等、不可變稽核與撤權規則保留。
- 新版分場出席、支援與排陣以 `team/planning` 文件共用，與名冊／賽程一樣使用 CAS 及伺服器稽核。不同裝置的舊草稿遇衝突時保留，備份後採用雲端；不覆蓋其他人的安排。常用鍵與字級維持裝置偏好，完整備份／還原保留。
- 完整 DH 交易曾碰到 Rules 1000-expression 限制，已將重複會員查詢與守位計算集中，保留角色、租約、版本、DH 合法性及稽核檢查。新增真實 SDK／Rules 測試，防止 UI 與後端各自通過卻無法整合。
- 租約取得增加逾時保護，避免網路中斷但瀏覽器仍顯示在線時卡住持久工作區。還原會自動排程同步；全備份保留常用鍵與分場草稿。離線顯示待同步，錯誤與衝突不假稱雲端成功。
- 整合靜態產物含本地打包 SDK、原 Logo／圖示與可離線外框。Service worker 限定本目錄、只快取公開程式，線上導航及公開設定優先更新；不快取 API、憑證或匯出，不清除舊本機資料。
- `cloudConfig=null` 保持正式部署阻擋。公開配置只允許天睿四個 Web 欄位；正式建置另要求真實登入、雙裝置、隱私及真機驗收紀錄。CI 沒有部署工作，沒有自動發布 main。

## 測試命令與覆蓋

實際通過數字、提交 SHA、CI 與唯一最新入口以整合 Draft PR 的交付紀錄為準。

| 命令 | 覆蓋 |
|---|---|
| `npm test` | 原統計、UI 資料、outbox；新增共用排陣衝突、設定腳本安全邊界、正式部署閘門 |
| `npm run test:firebase` | Auth／Firestore 模擬器、未登入／錯誤密碼／非核准 UID、角色、交易、lease／proof、防重複、停權、DH 與新排陣契約、校驗雲端備份 |
| `npm run test:firebase:browser` | **實際打包產物**＋真實 SDK 與模擬器；五個瀏覽器環境，各四個完整流程，雙獨立 context 共用帳號、離線重開／接手／衝突、賽程權限與排陣、DH／S3／改判／半局／偏好／備份還原 |
| `npm run test:ui` | 原有 165 UI 案例完整回歸，含 320／390 px、125% 字級、觸控排序與全部統計／匯出 |
| `npm run build:integrated` | 公開候選建置；未設定時只提供真實阻擋畫面，沒有假後端或示範資料登入 |
| `node scripts/verify-integrated-entry.mjs URL` | 公開產物位元組、Chromium／WebKit 手機尺寸、未設定閘門、舊版資料備份及零後端請求 |

模擬器只在 loopback 的 `demo-tianrui` 使用，測試只含合成資料。這些不代表已連上 `tianrui-baseball`，也不等於 iPhone／iPad 真機驗收。

## 還缺的必要事項

目前本環境無 Firebase CLI 授權、無 Web 公開配置及遠端角色資訊；無法確認真實 Rules／資料庫。未代建公司資源、未開付費方案，也沒有宣稱全隊已可正式共用。擁有者一次性操作見 [FIREBASE_OWNER_STEPS.md](FIREBASE_OWNER_STEPS.md)。設定腳本會自動完成可代做步驟，只要求擁有者本人登入、輸入私下密碼及必要區域；不要求把密碼交給 AI。

現有 main 仍含 `schedule.json`；本機可達歷史有兩個不同 blob、三個觸及該路徑的提交。新產物不包含它或任何真實名單／賽程，但歷史風險尚未消除。沒有刪資料、force push 或改寫歷史；正式發布前仍須依 [PRIVACY_MIGRATION.md](PRIVACY_MIGRATION.md) 完成備份與影響確認。新掃描只代表可達 refs／有限憑證格式，不含 fork、不可達物件或 CDN 等副本。

獨立整合候選入口只供上述最終接線及驗收，與未來正式版使用相同程式／建置，不另做試玩系統。主網站保持原樣，通過真實授權、雙裝置、隱私及實機驗收後才安排合併與正式發布。
