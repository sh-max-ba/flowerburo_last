// Служебные тексты Instagram, которые Wazzup кладёт в text как есть (по-английски):
//   «Reply to video story\r\n<ответ клиента>» — ответ на нашу историю (вложение = сама история);
//   «You mentioned in the story» — клиент отметил магазин в своей истории (вложение = его история);
//   «You got reel https://www.instagram.com/reel/…» — прислали рилс/пост ссылкой.
// Разбираем их в понятный вид для пузыря, цитаты и превью в списке диалогов.

export type SpecialMessage =
  | { kind: "storyReply"; body: string }
  | { kind: "storyMention"; body: string }
  | { kind: "share"; url: string; label: string; body: string }

const storyReplyPattern = /^reply to (?:(?:video|photo|image) )?story[ \t]*(?:\r?\n([\s\S]*))?$/i
const storyMentionPattern = /^(?:you mentioned in the story|mentioned you in (?:their|the|his|her) story)[ \t]*(?:\r?\n([\s\S]*))?$/i
const sharePattern = /^you got (reel|post|story|video|photo)\s+(https?:\/\/\S+)\s*([\s\S]*)$/i

const shareLabels: Record<string, string> = {
  reel: "Рилс из Instagram",
  post: "Публикация из Instagram",
  story: "История из Instagram",
  video: "Видео из Instagram",
  photo: "Фото из Instagram",
}

export function parseSpecialMessage(text: string): SpecialMessage | null {
  const value = text.trim().replace(/\r\n?/g, "\n")
  if (!value || !/^(reply|you|mentioned)/i.test(value)) {
    return null
  }
  const reply = storyReplyPattern.exec(value)
  if (reply) {
    return { kind: "storyReply", body: (reply[1] ?? "").trim() }
  }
  const mention = storyMentionPattern.exec(value)
  if (mention) {
    return { kind: "storyMention", body: (mention[1] ?? "").trim() }
  }
  const share = sharePattern.exec(value)
  if (share) {
    return { kind: "share", url: share[2], label: shareLabels[share[1].toLowerCase()] ?? "Публикация из Instagram", body: share[3].trim() }
  }
  return null
}

// Текст, который показываем в пузыре (без служебной приставки).
export function messageBodyText(text: string): string {
  const special = parseSpecialMessage(text)
  return special ? special.body : text
}

// Короткая подпись для цитаты и списка диалогов; "" — сообщение не служебное.
export function specialMessagePreview(text: string): string {
  const special = parseSpecialMessage(text)
  if (!special) {
    return ""
  }
  if (special.kind === "storyReply") {
    return special.body ? `Ответ на историю: ${special.body}` : "Ответ на историю"
  }
  if (special.kind === "storyMention") {
    return "Отметил(а) вас в истории"
  }
  return special.body ? `${special.label}: ${special.body}` : special.label
}
