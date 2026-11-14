import { NextResponse } from 'next/server'
import { fal } from '@fal-ai/client'
import { getFalKey } from '@/lib/server/fal-key'

export async function GET() {
  return runCheck()
}

export async function POST() {
  return runCheck()
}

async function runCheck() {
  const key = getFalKey()

  if (!key) {
    return NextResponse.json({
      ok: false,
      stage: 'missing',
      message: '還沒有設定 Fal 金鑰，請用管理員登入後，在「開始檢查」下方貼上金鑰並儲存。',
    })
  }

  fal.config({ credentials: key })

  try {
    const url = await fal.storage.upload(
      new Blob(['ok'], { type: 'text/plain' }),
    )
    return NextResponse.json({
      ok: true,
      stage: 'authenticated',
      message: '金鑰有效，可以連上 Fal。',
      sample: typeof url === 'string' ? 'upload-ok' : 'upload-unknown',
    })
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error)
    const lower = raw.toLowerCase()
    let message = '連線失敗，請再試一次。'
    if (lower.includes('401') || lower.includes('unauthor') || lower.includes('invalid')) {
      message = '金鑰被拒絕：可能是複製不完整、已被撤銷，或不是正確的金鑰。'
    } else if (lower.includes('403') || lower.includes('forbidden') || lower.includes('balance') || lower.includes('credit')) {
      message = '金鑰能辨識，但帳戶可能沒有餘額或沒有權限。'
    }
    return NextResponse.json({ ok: false, stage: 'error', message, detail: raw.slice(0, 200) })
  }
}
