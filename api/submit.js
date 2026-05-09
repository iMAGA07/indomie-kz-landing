// Vercel Serverless Function — /api/submit
// Принимает заявку с формы и отправляет в Telegram-группу.
// Токен и chat_id хранятся в env-переменных Vercel — в коде их нет.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT_ID) {
    return res.status(500).json({ ok: false, error: 'Server not configured' });
  }

  // ----- Парсинг тела (Vercel сам парсит JSON, но подстрахуем) -----
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  // ----- Простая валидация + санитизация -----
  const sanitize = (v, max = 200) =>
    String(v || '').slice(0, max).replace(/[<>]/g, '');

  const name    = sanitize(body.name, 80);
  const company = sanitize(body.company, 120);
  const region  = sanitize(body.region, 80);
  const phone   = sanitize(body.phone, 40);
  const volume  = sanitize(body.volume, 60);
  const source  = sanitize(body.source || 'indomie.kz', 80);

  if (!name || !company || !region || !phone || !volume) {
    return res.status(400).json({ ok: false, error: 'Заполните все обязательные поля' });
  }

  // ----- Анти-спам: honeypot + время заполнения -----
  if (body.website) {
    // Скрытое поле — реальный человек его не трогает
    return res.status(200).json({ ok: true });
  }

  // ----- Сборка сообщения -----
  const escape = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const ts = new Date().toLocaleString('ru-RU', {
    timeZone: 'Asia/Almaty',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'n/a';
  const ua = (req.headers['user-agent'] || '').slice(0, 120);

  const text = [
    '🔥 <b>Новая заявка · Indomie KZ</b>',
    '',
    `👤 <b>Имя:</b> ${escape(name)}`,
    `🏢 <b>Компания:</b> ${escape(company)}`,
    `📍 <b>Регион:</b> ${escape(region)}`,
    `📞 <b>Телефон:</b> <code>${escape(phone)}</code>`,
    `📦 <b>Объём:</b> ${escape(volume)}`,
    '',
    `🕓 ${escape(ts)} · Almaty`,
    `🌐 <i>${escape(source)}</i>`,
    `🪪 <code>${escape(ip)}</code>`
  ].join('\n');

  // ----- Параллельно: Telegram (обязательно) + Google Sheets (fire-and-forget) -----
  const telegramP = fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  }).then(r => r.json());

  // Google Sheets — необязательный канал, не блокирует ответ
  const SHEETS_URL = process.env.SHEETS_WEBHOOK_URL;
  const SHEETS_SECRET = process.env.SHEETS_SECRET;
  if (SHEETS_URL && SHEETS_SECRET) {
    fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: SHEETS_SECRET,
        name, company, region, phone, volume,
        source, ip
      }),
      redirect: 'follow'
    }).then(async r => {
      const t = await r.text().catch(() => '');
      console.log('Sheets response:', r.status, t.slice(0, 200));
    }).catch(e => {
      console.error('Sheets error:', e);
    });
  }

  // ----- Ждём только Telegram -----
  try {
    const data = await telegramP;
    if (!data.ok) {
      console.error('Telegram error:', data);
      return res.status(502).json({ ok: false, error: 'Telegram delivery failed' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('submit error:', e);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
