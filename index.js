const crypto = require('crypto');
if (!global.crypto) global.crypto = crypto;

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const P = require('pino');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
// ✅ Aktifkan CORS supaya bisa diakses dari domain CI4
app.use(cors({ origin: ['https://member2.kesug.com'], methods: ['GET', 'POST'] }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// simpan socket & status per store
const sockets = {};
const sessions = {};

async function connectToWhatsApp(storeId) {
  try {
    const sessionPath = `./sessions/${storeId}`;
    if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      browser: ['Chrome (Windows)', 'Desktop', '10.0'],
      logger: P({ level: 'silent' }),
      markOnlineOnConnect: true
    });

    sockets[storeId] = sock;
    sessions[storeId] = { connected: false, qr: null };

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        sessions[storeId].qr = qr;
        sessions[storeId].connected = false;
        console.log(`[${storeId}] 🧩 QR Code baru berhasil digenerate.`);
      }
      if (connection === 'close') {
        sessions[storeId].connected = false;
        sessions[storeId].qr = null;
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log(`[${storeId}] ❌ Koneksi terputus. Status Code: ${statusCode}`);
        if (statusCode === DisconnectReason.loggedOut || statusCode === 405) {
          console.log(`[${storeId}] ⚠️ Sesi bermasalah/expired. Menghapus folder sesi lama...`);
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
        }
        setTimeout(() => connectToWhatsApp(storeId), 5000);
      } else if (connection === 'open') {
        sessions[storeId].connected = true;
        sessions[storeId].qr = null;
        console.log(`[${storeId}] ✅ WhatsApp Berhasil Terhubung!`);
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    console.log(`[${storeId}] ❌ Error kritis:`, error.message);
    setTimeout(() => connectToWhatsApp(storeId), 5000);
  }
}

// 🌐 Endpoint QR per store
app.get('/qr/:storeId', async (req, res) => {
  const storeId = req.params.storeId;
  if (!sockets[storeId]) connectToWhatsApp(storeId);

  const session = sessions[storeId] || {};
  if (session.connected) {
    return res.send(`
      <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
        <h2 style="color:#28a745;">✅ WhatsApp Terhubung!</h2>
        <p>Nomor gateway aktif dan siap digunakan untuk mengirim pesan.</p>
        <p style="color:#555;">Jika ingin mengganti nomor, hapus sesi dan scan QR baru.</p>
      </div>
    `);
  }
  if (!session.qr) {
    return res.send(`
      <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
        <h3>⏳ QR Code sedang disiapkan...</h3>
        <p>Silakan refresh halaman ini dalam beberapa detik.</p>
      </div>
    `);
  }
  try {
    const qrImage = await qrcode.toDataURL(session.qr);
    res.send(`
      <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
        <h2>Scan QR Code WhatsApp Gateway</h2>
        <p>Gunakan aplikasi WhatsApp di HP Anda untuk scan QR di bawah ini:</p>
        <img src="${qrImage}" alt="QR Code"
             style="width:300px; height:300px; border:1px solid #ccc; padding:10px; border-radius:10px;" />
        <br><br>
        <script>
          setInterval(() => {
            fetch('/status-json/${storeId}').then(res => res.json()).then(data => {
              if (data.connected) location.reload();
            });
          }, 3000);
        </script>
      </div>
    `);
  } catch (err) {
    res.status(500).send('Gagal merender QR Code');
  }
});

// 🌐 Endpoint Status per store
app.get('/status-json/:storeId', (req, res) => {
  const storeId = req.params.storeId;
  const session = sessions[storeId] || {};
  res.json({
    connected: !!session.connected,
    hasQR: !!session.qr,
    timestamp: new Date().toISOString()
  });
});

// 📨 Endpoint Kirim Pesan per store dengan delay & log
app.post('/send-message', async (req, res) => {
  const { storeId, phone, message } = req.body;
  if (!storeId || !phone || !message) {
    return res.status(400).json({ status: false, pesan: 'storeId, phone, message wajib diisi' });
  }

  const sock = sockets[storeId];
  if (!sock || !sessions[storeId]?.connected) {
    return res.status(500).json({ status: false, pesan: 'Store belum terhubung' });
  }

  try {
    const id = phone.replace(/\D/g, '') + '@s.whatsapp.net';

    // ⏳ Delay random 3–10 detik
    const delay = Math.floor(Math.random() * (10 - 3 + 1) + 3) * 1000;
    await new Promise(resolve => setTimeout(resolve, delay));

    await sock.sendMessage(id, { text: message });

    // log ke CI4 sebagai terkirim
    await fetch('https://member2.kesug.com/admin/wa-gateway/saveChat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_id: storeId,
        phone_number: phone,
        message: message,
        status: 'sent'
      })
    });

    res.json({ status: true, pesan: 'Pesan berhasil dikirim ke ' + phone });
  } catch (error) {
    // log ke CI4 sebagai gagal
    await fetch('https://member2.kesug.com/admin/wa-gateway/saveChat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_id: storeId,
        phone_number: phone,
        message: message,
        status: 'failed'
      })
    });

    res.status(500).json({ status: false, pesan: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});
