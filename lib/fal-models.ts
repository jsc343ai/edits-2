export interface FalVideoModel {
  id: string;
  endpoint: string;
  label: string;
  note: string;
  pricePerSecond: number;
}

export const VIDEO_MODELS: FalVideoModel[] = [
  {
    id: "kling",
    endpoint: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
    label: "Kling 2.5 Turbo Pro",
    note: "畫質高、動作自然",
    pricePerSecond: 0.07,
  },
  {
    id: "wan",
    endpoint: "fal-ai/wan/v2.2-a14b/image-to-video",
    label: "Wan 2.2（480p）",
    note: "單價最低，適合先試作",
    pricePerSecond: 0.04,
  },
  {
    id: "kling3",
    endpoint: "fal-ai/kling-video/v3/pro/image-to-video",
    label: "Kling 3.0 Pro（無聲）",
    note: "最高畫質，最逼真",
    pricePerSecond: 0.112,
  },
];

export const IMAGE_PRICE = 0.04;

export function videoCost(modelId: string, seconds: number): string {
  const model = VIDEO_MODELS.find((m) => m.id === modelId) ?? VIDEO_MODELS[0];
  return `約 ${(model.pricePerSecond * seconds).toFixed(2)} 美元`;
}

export type ModuleId = "hand" | "d3" | "photo";

export interface ModuleDef {
  id: ModuleId;
  title: string;
  desc: string;
  style: "hand" | "3d" | "photo";
  modelId: string;
}

export const MODULES: ModuleDef[] = [
  {
    id: "hand",
    title: "手繪3D造型模組(短片)",
    desc: "鉛筆加水彩質感的手繪人物，做成會動的短片。成本最低。",
    style: "hand",
    modelId: "wan",
  },
  {
    id: "d3",
    title: "3D仿真造型模組(短片)",
    desc: "像 3D 動畫電影的立體人物，做成會動的短片。成本中等。",
    style: "3d",
    modelId: "kling",
  },
  {
    id: "photo",
    title: "Fal ai超仿真模組(短片)",
    desc: "接近真人拍攝的超仿真人物短片，畫質最高，成本最高。",
    style: "photo",
    modelId: "kling3",
  },
];

export const FAL_ENDPOINTS = {
  character: "fal-ai/bytedance/seedream/v4.5/text-to-image",
  swap: "fal-ai/face-swap",
  videoSwap: "fal-ai/pixverse/swap",
  video: VIDEO_MODELS.map((m) => m.endpoint),
} as const;

export const ALLOWED_ENDPOINTS: string[] = [
  FAL_ENDPOINTS.character,
  FAL_ENDPOINTS.swap,
  FAL_ENDPOINTS.videoSwap,
  ...FAL_ENDPOINTS.video,
];

export interface Character {
  id: string;
  zh: string;
  prompt: string;
}

const STYLE = "full body portrait, plain light studio background, front facing, face clearly visible, high detail";

export const CHARACTERS: Character[] = [
  { id: "man-stand", zh: "男士・站姿", prompt: `a middle-aged man in a smart casual jacket standing, ${STYLE}` },
  { id: "woman-stand", zh: "女士・站姿", prompt: `a woman in an elegant dress standing, ${STYLE}` },
  { id: "elder-man-sit", zh: "長者男・坐姿", prompt: `an elderly man with grey hair sitting on a wooden chair, ${STYLE}` },
  { id: "elder-woman-sit", zh: "長者女・坐姿", prompt: `an elderly woman in a cardigan sitting on a chair, ${STYLE}` },
  { id: "boy-run", zh: "男孩・奔跑", prompt: `a young boy in sportswear running, ${STYLE}` },
  { id: "girl-walk", zh: "女孩・行走", prompt: `a young girl in a bright coat walking, ${STYLE}` },
  { id: "man-sit", zh: "青年男・坐姿", prompt: `a young man in a hoodie sitting on a stool, ${STYLE}` },
  { id: "woman-lie", zh: "青年女・臥姿", prompt: `a young woman in casual clothes lying on a sofa, ${STYLE}` },
  { id: "3d-hero", zh: "3D 英雄造型", prompt: `a stylized 3D animated hero character in a cape standing proudly, pixar style, ${STYLE}` },
  { id: "3d-princess", zh: "3D 公主造型", prompt: `a stylized 3D animated princess in a gown, pixar style, ${STYLE}` },
];

const HAND_STYLE =
  "elegant realistic hand-drawn illustration, fine pencil and soft watercolor portrait, subtle paper texture, full body, plain light background, front facing, face clearly visible, refined detail";

export type CharacterStyle = "real" | "hand" | "3d" | "photo";

const STYLE_3D =
  "high quality 3D rendered animated character, soft cinematic lighting, smooth detailed skin and clothing, full body, plain light background, front facing, face clearly visible";
const STYLE_PHOTO =
  "photorealistic full body photograph, natural skin texture, realistic lighting, plain light studio background, front facing, face clearly visible, high detail";

export function characterPrompt(character: Character, style: CharacterStyle): string {
  if (style === "real") return character.prompt;
  if (style === "3d") return character.prompt.replace(STYLE, STYLE_3D);
  if (style === "photo") return character.prompt.replace(STYLE, STYLE_PHOTO);
  return character.prompt
    .replace(STYLE, HAND_STYLE)
    .replace("pixar style, ", "")
    .replace("stylized 3D animated ", "");
}

export interface MotionPreset {
  id: string;
  zh: string;
  prompt: string;
}

export const MOTIONS: MotionPreset[] = [
  { id: "wave", zh: "揮手打招呼", prompt: "the person smiles and waves one hand to greet the camera, natural subtle body motion" },
  { id: "smile", zh: "微笑眨眼", prompt: "the person blinks gently and smiles warmly, slight head movement" },
  { id: "talk", zh: "開口說話", prompt: "the person talks naturally to the camera with small expressive gestures" },
  { id: "turn", zh: "轉頭看鏡頭", prompt: "the person slowly turns their head toward the camera and smiles" },
  { id: "walk", zh: "向前行走", prompt: "the person walks forward naturally toward the camera, arms swinging" },
  { id: "dance", zh: "開心跳舞", prompt: "the person dances happily with joyful rhythmic movements" },
  { id: "run", zh: "輕快奔跑", prompt: "the person jogs lightly in place with natural running motion" },
  { id: "bow", zh: "鞠躬行禮", prompt: "the person bows politely then stands up and smiles" },
  { id: "clap", zh: "拍手歡呼", prompt: "the person claps hands and cheers with excitement" },
  { id: "breeze", zh: "微風吹拂", prompt: "a gentle breeze moves the hair and clothes, the person stays calm with soft breathing" },
];
