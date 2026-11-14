export type EditFunc = "card" | "collage" | "single" | "photos" | "video" | "cutout" | "sticker" | "restore" | "faceswap" | "animate";
export type EditModeId = "hand" | "ai";

interface FuncDef {
  id: EditFunc;
  zh: string;
  en: string;
  descZh: string;
  descEn: string;
  soon?: boolean;
}

const ANIMATE: FuncDef = {
  id: "animate",
  zh: "照片動起來（開發中）",
  en: "Bring photos to life (coming soon)",
  descZh: "選一張人物照，AI 找出頭手腳位置，讓照片唱歌、跳舞、運動（雛型）",
  descEn: "Pick a person photo; the body is located so it can sing, dance or exercise (prototype)",
  };

export const FUNCS_HAND: FuncDef[] = [
  { id: "restore", zh: "延用圖片修復", en: "Reuse & repair image", descZh: "塗抹舊問候圖的文字與圖案，系統自動清除，再重新加字、加素材", descEn: "Paint over old text and artwork, it clears automatically, then add new text and materials" },
  { id: "card", zh: "編輯文宣卡片", en: "Promo card", descZh: "製作海報、邀請卡與宣傳圖，可加文字與插圖", descEn: "Make posters and invitations with text and artwork" },
  { id: "cutout", zh: "照片去背", en: "Remove background", descZh: "手動點選背景顏色，輸出透明 PNG", descEn: "Tap the background colour and export a transparent PNG" },
  { id: "sticker", zh: "貼圖製作", en: "Sticker maker", descZh: "用 Emoji、文字、插畫與去背圖做靜態或動態貼圖", descEn: "Build static or animated stickers from emoji, text, artwork and cutouts" },
  { id: "single", zh: "單張照片動態編輯", en: "Animate one photo", descZh: "一張相片變成有立體感的動態影片", descEn: "Turn one photo into a lifelike motion clip" },
  { id: "collage", zh: "編輯照片拼貼", en: "Photo collage", descZh: "把 1 到 6 張相片拼成一張，多種版型", descEn: "Combine 1 to 6 photos with several layouts" },
  { id: "photos", zh: "50 張照片導演編輯", en: "Photo director edit (50)", descZh: "最多 50 張相片，文字、秒數、濾鏡、配樂", descEn: "Up to 50 photos with text, timing, filters, music" },
  { id: "video", zh: "10 分鐘短片導演編輯", en: "Short video director edit (10 min)", descZh: "剪輯最長 10 分鐘影片，分割、調速、濾鏡與音樂", descEn: "Edit up to 10 minutes: split, speed, filters, music" },
  { id: "faceswap", zh: "換臉編輯/編輯全功能", en: "Face swap edit / full tools", descZh: "選範本和大頭貼，手動對位、追蹤、融合修飾、筆刷，匯出 Gif 或短片", descEn: "Pick a clip and portrait, then align, track, blend, brush and export a GIF or clip" },
  ANIMATE,
];

export const FUNCS_AI: FuncDef[] = [
  { id: "restore", zh: "延用圖片修復", en: "Reuse & repair image", descZh: "用對話指定要清除的文字區域，AI 判定清除，再用 3D 動態重新編輯", descEn: "Tell the AI which text to clear, then re-edit with AI 3D motion" },
  { id: "card", zh: "編輯文宣卡片", en: "Promo card", descZh: "選素材、選格式，版面、文案與裝飾全由 AI 完成", descEn: "Pick materials and format; AI creates layout, copy and decoration" },
  { id: "cutout", zh: "照片去背", en: "Remove background", descZh: "AI 自動辨識人物與物件，一鍵去背", descEn: "AI detects the subject and removes the background in one tap" },
  { id: "sticker", zh: "貼圖製作", en: "Sticker maker", descZh: "AI 把相片變成貼圖，或用文字生成 Emoji 貼圖", descEn: "AI turns photos into stickers or builds emoji stickers" },
  { id: "single", zh: "單張照片動態編輯", en: "Animate one photo", descZh: "AI 3D 動態，一張相片變成影片", descEn: "AI 3D motion turns one photo into a clip" },
  { id: "collage", zh: "編輯照片拼貼", en: "Photo collage", descZh: "選素材、選格式，版型、順序與文字全由 AI 完成", descEn: "Pick materials and format; AI does layout, order and text" },
  { id: "photos", zh: "80 張照片導演編輯", en: "Photo director edit (80)", descZh: "最多 80 張相片，AI 3D 動態與轉場", descEn: "Up to 80 photos with AI 3D motion and transitions" },
  { id: "video", zh: "30 分鐘短片導演編輯", en: "Short video director edit (30 min)", descZh: "剪輯最長 30 分鐘影片，AI 協助整理", descEn: "Edit up to 30 minutes with AI assistance" },
  { id: "faceswap", zh: "換臉編輯/AI助理/編輯全功能", en: "Face swap edit / AI assistant / full tools", descZh: "全部換臉編輯功能，再加上用文字指令請 AI 助理幫你調整", descEn: "All face-swap tools, plus an AI assistant you can tell what to adjust" },
  ANIMATE,
];

export const FUNCS = FUNCS_HAND;
