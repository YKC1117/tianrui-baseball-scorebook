# 天睿 UI／UX 實際試用版

日期：2026-11-11（台灣）。分支：`work/ui-ux-review`。接續既有 `6cc3f78`，沒有從零重做。

本輪只改介面與操作流程。Firebase、帳號、資料庫、同步接口與規則均未修改；沒有要求擁有者建立後端，也沒有合併 main 或修改正式 GitHub Pages。

## 直接操作

完整可操作檔案是 `preview/tianrui-ui-preview.html`，已包含樣式、程式、原 Logo 與模擬資料。可透過 HTML Preview 開啟本分支檔案，或下載 HTML 後用桌面瀏覽器開啟。正式網站網址維持原狀。

試用入口：[開啟 UI／UX 預覽](https://htmlpreview.github.io/?https://raw.githubusercontent.com/YKC1117/tianrui-baseball-scorebook/work/ui-ux-review/preview/tianrui-ui-preview.html)

試用資料只有 20 位「示範球員」、3 場模擬賽程，以及 2 場由既有計分引擎產生的示範比賽；沒有真實隊員名單或正式賽事。姓名、背號、賽程、計分、換人與匯出都是實際操作，不是圖片或只有外觀的按鈕。

預覽只使用 `TR_UI_REVIEW_SANDBOX_V1` 本機儲存鍵。既有 `TR_BASEBALL_OFFLINE_V1`、賽程資料鍵、IndexedDB 與正式後端都不讀寫。可用「試用設定」下載／載入試用進度，或明確確認後重設模擬資料；不清除整站儲存。

## 已檢查的原有畫面

逐段閱讀首頁、全隊名單、賽前排陣、記分、當場換人／守位、打擊／投球／守備／跑壘統計、逐球紀錄、PNG／CSV／JSON 匯出、備份匯入、Logo／文字設定，以及原獨立賽程頁的編輯、圖片辨識、文字整理與 JSON 流程。

主要問題是手機 10–13 px 字級、過多狹窄入口、賽前資料集中在很長的一頁、常用記分按鈕不夠突出、修改名單後須捲到最底儲存、換人／統計分散，以及輸入對手後失焦重繪導致「下一步」可能需要第二次點擊。

## 本輪改版

- 沿用原 B 版 Logo、深藍與橘色；改用簡潔的棒球場線條、清楚層次及單色圖示，沒有重新設計 Logo。Logo／兩張圖示位元組與原版一致。
- 主文字預設 18 px、主要按鈕至少 54 px。手機底部五個入口：首頁、球員、賽程、排陣、記分。比賽內另有記分、換人、統計、逐球紀錄、匯出操作列。
- 首頁直接繼續比賽、準備下一場及查看近期成績。名單可搜尋，姓名與選填背號清楚分開，儲存按鈕固定可見。新增／批次匯入／備份保留。
- 排陣分成比賽資料、出賽名單、九棒守備三步，可直接切換。支援球員只進當場名單；先發、板凳、棒次及守位依原邏輯運作。
- 即時計分優先顯示大比分、打者、B／S／O 與三個逐球按鈕。常用打擊結果使用中文大按鈕；其他結果、特殊跑壘／守備仍可展開。390 × 844 下，逐球按鈕位於底部導覽上方。
- 換人頁先呈現九棒與投手，守位及當場球員資料收在獨立區塊。投手二次登板與合併統計保留。
- 統計分打擊、投球、守備／跑壘，保留所有原欄位，增加中文表頭、固定球員欄與左右滑動提示。
- 賽程可新增／修改／篩選、直接帶入排陣，保留季別、JSON、圖片預覽與瀏覽器 OCR／文字整理。OCR 沿用既有 Tesseract 5.1.1，首次辨識需網路下載模型，不需要後端設定。
- PNG、CSV、單場 JSON 與試用進度備份均可實際下載／載入。匯入比賽使用新 ID，保留原比賽。
- 姓名確認使用有標題的對話框，支援 Tab 焦點循環、Enter 確認及 Escape 取消；開始、繼續與接手仍需姓名。

## 保留的計分邏輯

原有 `blankBat`、`blankPitch`、`freshGame`、`defaultTeam`、`createGameFromDraft`、`st`、`ps`、`newPitchSession`、`normalizePitchSessions`、`pitchCredit`、`pitchRowsData`、`defaultMoves`、`getMoves`、`validateMoves`、`applyMoves`、`commitPlay`、`commitRun`、`runPitch`、`undo`、`redo`、`finish`、`setHalf`、`changeHalfManually`、`battingRows`、`pitchingRows`、`exportCSV`、`exportJSON`、`exportPNG` 沒有更換計算方式。

包含三好球／四壞後由紀錄員確認結果、第三出局與得分核對、自責分、可重返與二次登板、提前結束、打序／守位分離及封存行為，皆沿用既有程式。

## 自動化驗證

| 套件 | 範圍 |
|---|---|
| Node 回歸 31 項 | 原有統計、投手 2.2＋2.0＝4.2、ERA／WHIP、打擊／跑壘、資料驗證、備份等 |
| UI 瀏覽器 40 案例 | Chromium 手機／平板／桌面，WebKit 手機／平板，共 5 種環境各 8 案例 |
| 尺寸與放大 | 390×844、834×1112、1440×1000；另檢查 320×740 及 125% 文字放大 |
| 功能 | 名單修改／空背號／搜尋／支援、三步排陣、必填姓名、逐球／打擊／跑壘／守備、復原／重做、二次登板、賽程增修／文字匯入、PNG／CSV／JSON、還原新 ID、試用重設與鍵盤操作 |
| 資料邊界 | 舊 localStorage 內容逐位元組保持，預覽不發出 Firebase／Supabase 請求，不清除網站資料 |

最終執行結果與提交 SHA 見 UI Draft PR 的 Checks；本輪 CI 在 UI 分支只跑 Node 與介面測試，停跑資料庫／帳號／同步施工流程。沒有部署正式網站的工作。

```sh
npm ci --ignore-scripts
npm test
npm run build:ui-preview
npx playwright install --with-deps chromium webkit
npm run test:ui
python3 -m http.server 4180 --bind 127.0.0.1 --directory dist-ui
```

## 審查邊界

- Linux Chromium／WebKit 的裝置尺寸測試不是 iPhone／iPad 真機驗收。原有資料未遷移；真實後端、帳號與多人同步本輪暫停。
- 自動化已驗證圖片預覽與文字整理。OCR 模型下載及實際圖片辨識另做連線檢查，不以模擬辨識結果冒充真實 OCR；圖片辨識失敗時仍可貼文字或手動新增。
- 線上入口是獨立試用檔案的預覽，沒有改動正式站。資料保留在目前瀏覽器；請勿把這份試用檔當成正式雲端共用系統。
- 等擁有者親自操作並確認 UI／UX 是否採用，再安排下一階段；本輪不合併任何工程分支。
