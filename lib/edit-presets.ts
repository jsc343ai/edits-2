import type { Clip, TransitionId } from "@/lib/compositor";

export interface EditPreset {
  id: string;
  zh: string;
  en: string;
  descZh: string;
  descEn: string;
  motion: string;
  transition: TransitionId;
  filter: Clip["filter"];
  seconds: number;
  textColor: string;
  titleZh: string;
  titleEn: string;
  closingZh: string;
  closingEn: string;
}

export const EDIT_PRESETS: EditPreset[] = [
  {
    id: "memory", zh: "溫馨回憶", en: "Warm memories",
    descZh: "暖色調、柔和淡入淡出，適合家人與日常紀錄。", descEn: "Warm tones and soft fades for family and everyday moments.",
    motion: "float", transition: "fade", filter: "warm", seconds: 4, textColor: "#ffe27a",
    titleZh: "美好回憶", titleEn: "Precious memories", closingZh: "謝謝觀看", closingEn: "Thanks for watching",
  },
  {
    id: "travel", zh: "旅行日誌", en: "Travel diary",
    descZh: "鮮豔色彩與橫移，節奏明快，適合旅遊相簿。", descEn: "Vivid colour and lateral moves with a brisk pace for trips.",
    motion: "pan", transition: "slide", filter: "vivid", seconds: 3, textColor: "#ffffff",
    titleZh: "旅行日誌", titleEn: "Travel diary", closingZh: "下次再出發", closingEn: "Until the next trip",
  },
  {
    id: "romance", zh: "浪漫婚禮", en: "Romantic",
    descZh: "星光閃耀與復古色調，適合婚禮、紀念日。", descEn: "Sparkle and vintage tones for weddings and anniversaries.",
    motion: "sparkle", transition: "blur", filter: "vintage", seconds: 4, textColor: "#ffffff",
    titleZh: "我們的故事", titleEn: "Our story", closingZh: "永遠在一起", closingEn: "Together forever",
  },
  {
    id: "party", zh: "派對歡慶", en: "Party time",
    descZh: "心跳脈動與旋轉轉場，生日、聚會氣氛十足。", descEn: "Heartbeat pulses and spins for birthdays and parties.",
    motion: "heartbeat", transition: "spin", filter: "vivid", seconds: 2, textColor: "#ffe27a",
    titleZh: "快樂時光", titleEn: "Happy times", closingZh: "下次再聚", closingEn: "See you next time",
  },
  {
    id: "cinema", zh: "電影預告", en: "Cinematic",
    descZh: "電影推進與黑白質感，像電影預告片。", descEn: "Dolly push and mono grade, like a movie trailer.",
    motion: "dolly", transition: "zoom", filter: "mono", seconds: 3, textColor: "#ffffff",
    titleZh: "故事開始", titleEn: "The story begins", closingZh: "完", closingEn: "The end",
  },
  {
    id: "winter", zh: "冬日雪景", en: "Winter snow",
    descZh: "飄雪與冷色調，安靜清爽。", descEn: "Falling snow and cool tones, calm and crisp.",
    motion: "snow", transition: "fade", filter: "cool", seconds: 4, textColor: "#ffffff",
    titleZh: "冬日記憶", titleEn: "Winter days", closingZh: "溫暖在心", closingEn: "Warm in the heart",
  },
  {
    id: "tech", zh: "科技感", en: "Techno",
    descZh: "全像故障與快節奏，適合科技或運動內容。", descEn: "Hologram glitch and quick cuts for tech or sports.",
    motion: "glitch", transition: "wipe", filter: "cool", seconds: 2, textColor: "#ffffff",
    titleZh: "精彩瞬間", titleEn: "Highlights", closingZh: "更多精彩", closingEn: "More to come",
  },
  {
    id: "clean", zh: "簡約清爽", en: "Clean & simple",
    descZh: "不加濾鏡、輕微環繞，保留照片原色。", descEn: "No filter and a light orbit to keep original colours.",
    motion: "orbit", transition: "fade", filter: "none", seconds: 3, textColor: "#ffffff",
    titleZh: "我的相簿", titleEn: "My album", closingZh: "謝謝觀看", closingEn: "Thanks for watching",
  },
];
