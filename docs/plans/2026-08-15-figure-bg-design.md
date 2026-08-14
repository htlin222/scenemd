# Figure `bg` mode — 右側滿高出血圖(design v5.1)

日期:2026-08-15
狀態:已定案(與使用者逐項確認)
前情:design v5(`2026-08-14-image-config-design.md`)把 hero/bg 全數收斂成 `size=100%`。
實測後發現 `size=100%` 的字面語意(heading 下扣掉圖說後的全部高度)對直式大圖
仍然「不夠滿」——固定成本(heading + 圖說 + 邊距)吃掉約 35% 高度,而 `size`
只分配高度,分不到寬度。>100% 沒有語意(高度已分完),因此不擴充百分比,
改新增一個滿版模式。

## 決策摘要

| 決策點 | 結論 |
| --- | --- |
| 寬度模型 | 比例決定寬度、**不裁切**:圖滿高、寬 = 高 × 原始比例、貼右緣出血 |
| heading | **進左欄**(2026-08-15 修訂:原定全寬,實測後不夠滿——「頂到 menu」);圖從 content 頂緣(chrome 條下方)直通頁底 |
| 圖說 | 進左欄(正文下方),沿用 `figure-below-caption`;右側面板無文字 |
| 語法 | `{bg}` flag,與 `{size=NN%}` 互斥;Marpit `![bg …]` 讀入正規化為 `{bg}` |
| 順手修 | `size` parse/dialog 一律 clamp 15–100%(修 >100% 的半壞行為) |

## 版面語意(renderer / CSS)

新增 scene layout **`figure-bg`**,`chooseLayout` 在 scene 內任一 figure 帶
`background` 時選中,優先於 `figure`。

- Scene 結構:breadcrumb / section-nav 照舊。content 區分兩塊:左欄
  (heading + 正文 + 圖說)、右側出血面板。
- 出血面板:從 content 頂緣(chrome 條正下方,「頂到 menu」)延伸到 scene 的
  **右緣與底緣**(以負 margin 抵銷 `.scene-content` 的 inset 變數)。圖片
  `height: 100%`、`width: auto`、`object-fit: contain`、貼右對齊,不裁切。
- planner 數學不因 heading 進左欄而變:heading 高度無論欄內欄外,對垂直預算
  的貢獻相同(`usedHeight = headingTotal + effectiveText`)。
- 寬度守門:面板 `max-width: 62%`(scene 寬)。橫式寬圖撞到上限時等比縮小
  (此時不再滿高)——「不裁切」原則下唯一的讓步,保證左欄至少 ~38% 寬。
- 底部 chrome(頁碼、進度條)照常疊在最上層,圖從底下穿過。
- 面板透明無背景色、無框線圓角;深淺主題不需額外處理。

## Planner(確定性、不依賴圖片比例)

- `types.ts` 的 `SceneLayout` union 加 `'figure-bg'`。
- 容量模型:bg 圖對垂直預算貢獻為**零**(活在出血面板,不佔文字流)。
  `usedHeight` = headingTotal + 左欄堆疊高(上方正文 + 圖說)× `BG_TEXT_WIDTH_FACTOR`。
  係數補償「量測在全寬做、左欄實際只有 ~38–55% 寬」的落差;起始值 1.9,
  以 browser-check 截圖校準——唯一的調校常數。
- planner 不知道圖片比例(也不該知道),一律按面板吃滿 62% 的最壞情況規劃左欄。
- `figureTextScale` 沿用到 figure-bg:左欄超高先縮字(floor 0.6),再拆 scene;
  拆頁時 bg 圖留在第一頁。

## 語法與 round-trip

寫入語彙擴成兩個:一般圖 `{size=NN%}`、滿版圖 `{bg}`,互斥。

讀取相容(save 時正規化):

```
![bg right](url)   → {bg}
![bg](url)         → {bg}
{bg size=60%}      → {bg}(size 丟棄)
{size=150%}        → {size=100%}(clamp 15–100)
```

`formatImageAttributes` 在 `background=true` 時輸出 `{bg}`(蓋過 size)。

## FigureDialog

- 加「滿版(bg)」toggle;開啟時 size 拖桿隱藏,16:9 預覽畫布改畫
  heading 條 + 左欄 placeholder + 右側滿高圖。
- `sizePercent` 與文字欄位輸入一併 clamp 15–100。

## 驗證

- `planner.test.ts`:figure-bg layout 選擇、bg 圖零高預算、縮字 → 拆頁路徑。
- `imageSyntax.test.ts`:上表四組 round-trip。
- `npm run typecheck`(雙專案)。
- `tools/browser-check.mjs`:加 bg scene 的 selector 與截圖斷言(視覺改動先截圖)。
- 文件同步:CLAUDE.md、cheat sheet、header LLM prompt 的 figure 模型描述。
