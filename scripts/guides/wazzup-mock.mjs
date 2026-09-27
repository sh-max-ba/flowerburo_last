// Мок Wazzup API для песочницы: каналы и отправка сообщений (никаких реальных WhatsApp).
import http from "node:http"
import crypto from "node:crypto"

const port = Number(process.env.MOCK_PORT || 3997)
http
  .createServer((req, res) => {
    let body = ""
    req.on("data", (chunk) => (body += chunk))
    req.on("end", () => {
      const send = (status, data) => {
        res.writeHead(status, { "Content-Type": "application/json" })
        res.end(JSON.stringify(data))
      }
      const url = req.url.split("?")[0]
      if (req.method === "GET" && url.endsWith("/channels")) {
        return send(200, [{ channelId: "demo-whatsapp-channel", transport: "whatsapp", plainId: "996555000000", state: "active" }])
      }
      if (req.method === "POST" && url.endsWith("/message")) {
        let parsed = {}
        try { parsed = JSON.parse(body || "{}") } catch {}
        console.log("[mock] message", parsed.chatId, (parsed.text || parsed.contentUri || "").slice(0, 60))
        return send(201, { messageId: crypto.randomUUID(), chatId: parsed.chatId })
      }
      if (url.endsWith("/webhooks")) return send(200, { ok: true })
      console.log("[mock] unhandled", req.method, req.url)
      return send(200, {})
    })
  })
  .listen(port, "127.0.0.1", () => console.log("wazzup mock on", port))
