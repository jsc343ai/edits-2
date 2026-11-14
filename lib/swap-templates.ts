export type SwapLength = "gif" | "clip";
export type SwapModule = "hand3d" | "sim3d" | "ultra";

export interface SwapTemplate {
  id: string;
  module: SwapModule;
  zh: string;
  en: string;
  gender?: "male" | "female";
  age?: "young" | "adult" | "senior" | "child";
  hair?: string;
  thumbUrl?: string;
  gifUrl?: string;
  clipUrl: string;
  sourceUrl?: string;
}

export const SWAP_LENGTHS: Record<SwapLength, { zh: string; en: string; seconds: string }> = {
  gif: { zh: "GIF 動圖", en: "GIF", seconds: "3-5" },
  clip: { zh: "短片", en: "Short clip", seconds: "6-10" },
};

export const SWAP_MODULES: { id: SwapModule; zh: string; en: string; descZh: string; descEn: string }[] = [
  {
    id: "hand3d",
    zh: "手繪3D造型模組(短片)",
    en: "Hand-drawn 3D module (clip)",
    descZh: "鉛筆水彩手繪質感的人物短片，把片中人物的臉換成你的臉。",
    descEn: "Pencil-and-watercolor character clips with your face swapped in.",
  },
  {
    id: "sim3d",
    zh: "3D仿真造型模組(短片)",
    en: "3D lifelike module (clip)",
    descZh: "3D 動畫電影質感的人物短片，把片中人物的臉換成你的臉。",
    descEn: "3D-animation-style character clips with your face swapped in.",
  },
  {
    id: "ultra",
    zh: "Fal ai超仿真模組(短片)",
    en: "Ultra-realistic module (clip)",
    descZh: "接近真人拍攝的人物短片，把片中人物的臉換成你的臉。",
    descEn: "Near-live-action character clips with your face swapped in.",
  },
];

/** Saved templates. Add an entry here once its files are stored in the app. */
export const SWAP_TEMPLATES: SwapTemplate[] = [
  {
    id: "hand3d-1",
    module: "hand3d",
    zh: "手繪範本 1",
    en: "Hand-drawn template 1",
    clipUrl: "/templates/handdrawn-1.mp4",
    sourceUrl: "https://v3b.fal.media/files/b/0ab1c70d/DPWQGAhyeh1V2CITYWMat_3QkS6nw7.mp4",
  },
  {
    id: "sim3d-1",
    module: "sim3d",
    zh: "3D仿真範本 1",
    en: "3D lifelike template 1",
    clipUrl: "/templates/cinematic-1.mp4",
    sourceUrl: "https://v3b.fal.media/files/b/0ab1c760/y9iseAq_NOy-GXw9q_uaE_output.mp4",
  },
  {
    id: "ultra-1",
    module: "ultra",
    zh: "超仿真範本 1",
    en: "Ultra-realistic template 1",
    clipUrl: "/templates/realistic-1.mp4",
    sourceUrl: "https://v3b.fal.media/files/b/0ab1c77a/R09iqWs5wVkkeyOZA1GRc_output.mp4",
  },
];

export const PLANNED_TEMPLATES: { zh: string; en: string }[] = [
  { zh: "站著揮手", en: "Standing wave" },
  { zh: "坐著微笑", en: "Seated smile" },
  { zh: "緩步走向鏡頭", en: "Walking toward camera" },
];
