import { NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { isAdmin } from "@/lib/server/admin-auth";
import { getFalKey } from "@/lib/server/fal-key";
import { ALLOWED_ENDPOINTS, FAL_ENDPOINTS, VIDEO_MODELS } from "@/lib/fal-models";

export const maxDuration = 60;

const MAX_DATA_URL = 3_000_000;

function setup(): string | null {
  const key = getFalKey();
  if (!key) return null;
  fal.config({ credentials: key });
  return key;
}

function firstUrl(data: unknown): string | null {
  const d = data as {
    video?: { url?: string };
    image?: { url?: string };
    images?: { url?: string }[];
  };
  return d?.video?.url ?? d?.image?.url ?? d?.images?.[0]?.url ?? null;
}

function checkDataUrl(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("data:image/") && value.length < MAX_DATA_URL ? value : null;
}

interface SubmitBody {
  step?: string;
  prompt?: string;
  baseUrl?: string;
  videoUrl?: string;
  faceDataUrl?: string;
  imageUrl?: string;
  imageDataUrl?: string;
  modelId?: string;
  seconds?: number;
}

export async function POST(req: Request) {
  if (!(await isAdmin(req).catch(() => false))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!setup()) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as SubmitBody;

  try {
    if (body.step === "character") {
      const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 500) : "";
      if (!prompt) return NextResponse.json({ error: "invalid" }, { status: 400 });
      const endpoint = FAL_ENDPOINTS.character;
      const { request_id } = await fal.queue.submit(endpoint, {
        input: { prompt, image_size: "portrait_16_9", num_images: 1 },
      });
      return NextResponse.json({ endpoint, requestId: request_id });
    }

    if (body.step === "swap") {
      const face = checkDataUrl(body.faceDataUrl);
      const base = typeof body.baseUrl === "string" && body.baseUrl.startsWith("https://") ? body.baseUrl : null;
      if (!face || !base) return NextResponse.json({ error: "invalid" }, { status: 400 });
      const endpoint = FAL_ENDPOINTS.swap;
      const { request_id } = await fal.queue.submit(endpoint, {
        input: { base_image_url: base, swap_image_url: face },
      });
      return NextResponse.json({ endpoint, requestId: request_id });
    }

    if (body.step === "video") {
      const model = VIDEO_MODELS.find((m) => m.id === body.modelId) ?? VIDEO_MODELS[0];
      const image =
        checkDataUrl(body.imageDataUrl) ??
        (typeof body.imageUrl === "string" && body.imageUrl.startsWith("https://") ? body.imageUrl : null);
      const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 500) : "";
      if (!image || !prompt) return NextResponse.json({ error: "invalid" }, { status: 400 });
      const seconds = body.seconds === 10 ? 10 : 5;
      let input: Record<string, unknown>;
      if (model.id === "kling") {
        input = { prompt, image_url: image, duration: String(seconds) };
      } else if (model.id === "kling3") {
        input = { prompt, start_image_url: image, duration: String(seconds), generate_audio: false };
      } else {
        input = {
          prompt,
          image_url: image,
          resolution: "480p",
          num_frames: seconds === 10 ? 161 : 81,
          frames_per_second: 16,
        };
      }
      const { request_id } = await fal.queue.submit(model.endpoint, { input });
      return NextResponse.json({ endpoint: model.endpoint, requestId: request_id });
    }

    if (body.step === "videoSwap") {
      const face = checkDataUrl(body.faceDataUrl);
      const video = typeof body.videoUrl === "string" && body.videoUrl.startsWith("https://") ? body.videoUrl : null;
      if (!face || !video) return NextResponse.json({ error: "invalid" }, { status: 400 });
      const endpoint = FAL_ENDPOINTS.videoSwap;
      const { request_id } = await fal.queue.submit(endpoint, {
        input: {
          video_url: video,
          image_url: face,
          mode: "person",
          keyframe_id: 1,
          resolution: "540p",
          original_sound_switch: false,
        },
      });
      return NextResponse.json({ endpoint, requestId: request_id });
    }

    return NextResponse.json({ error: "invalid" }, { status: 400 });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    return NextResponse.json({ error: "submit_failed", detail }, { status: 502 });
  }
}

export async function GET(req: Request) {
  if (!(await isAdmin(req).catch(() => false))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!setup()) return NextResponse.json({ error: "no_key" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const endpoint = searchParams.get("endpoint") ?? "";
  const requestId = searchParams.get("id") ?? "";
  if (!ALLOWED_ENDPOINTS.includes(endpoint) || !/^[A-Za-z0-9-]{8,80}$/.test(requestId)) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }

  try {
    const status = await fal.queue.status(endpoint, { requestId });
    if (status.status !== "COMPLETED") {
      return NextResponse.json({ status: status.status });
    }
    const result = await fal.queue.result(endpoint, { requestId });
    const url = firstUrl(result.data);
    if (!url) return NextResponse.json({ status: "FAILED", detail: "no_output" });
    return NextResponse.json({ status: "COMPLETED", url });
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    return NextResponse.json({ status: "FAILED", detail });
  }
}
