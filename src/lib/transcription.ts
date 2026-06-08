// Только для сервера: импортировать лишь из route handlers / server actions. Ключ читается из
// OPENAI_API_KEY (без NEXT_PUBLIC_) и никогда не попадает на клиент.
// Распознавание речи (STT) через OpenAI. Ключ только на сервере (OPENAI_API_KEY, без NEXT_PUBLIC_).
// Модель gpt-4o-mini-transcribe, при недоступности — fallback на whisper-1. Язык — русский, формат
// ответа json. Используется и для надиктовки в поле ввода, и для расшифровки голосовых сообщений.

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions"
const MODELS = ["gpt-4o-mini-transcribe", "whisper-1"] as const

export type TranscriptionErrorCode = "no_key" | "auth" | "empty" | "upstream" | "network"

export class TranscriptionError extends Error {
  constructor(
    readonly code: TranscriptionErrorCode,
    message: string
  ) {
    super(message)
    this.name = "TranscriptionError"
  }
}

export type TranscriptionInput = {
  bytes: Uint8Array<ArrayBuffer>
  filename: string
  contentType: string
}

export async function transcribeAudioToText(input: TranscriptionInput): Promise<string> {
  const apiKey = (process.env.OPENAI_API_KEY ?? "").trim()
  if (!apiKey) {
    throw new TranscriptionError("no_key", "Распознавание речи не настроено: на сервере нет ключа OpenAI.")
  }

  let lastError: TranscriptionError | null = null

  for (const model of MODELS) {
    let response: Response
    try {
      const form = new FormData()
      const blob = new Blob([input.bytes], {
        type: input.contentType || "application/octet-stream",
      })
      form.append("file", blob, input.filename)
      form.append("model", model)
      form.append("language", "ru")
      form.append("response_format", "json")

      response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      })
    } catch {
      throw new TranscriptionError("network", "Не удалось связаться с сервисом распознавания.")
    }

    if (response.ok) {
      const data = (await response.json().catch(() => null)) as { text?: string } | null
      const text = (data?.text ?? "").trim()
      if (!text) {
        throw new TranscriptionError("empty", "Речь не распознана — попробуйте записать ещё раз.")
      }
      return text
    }

    // Неверный ключ — повтор другой моделью не поможет, падаем сразу.
    if (response.status === 401 || response.status === 403) {
      throw new TranscriptionError("auth", "Ключ OpenAI отклонён сервисом распознавания.")
    }

    // Модель недоступна / иная ошибка — пробуем следующую модель из списка (fallback на whisper-1).
    lastError = new TranscriptionError("upstream", "Сервис распознавания вернул ошибку.")
  }

  throw lastError ?? new TranscriptionError("upstream", "Сервис распознавания недоступен.")
}
