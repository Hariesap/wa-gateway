// ✅ Tambahkan crypto agar Baileys bisa melakukan enkripsi handshake
const crypto = require('crypto');
if (!global.crypto) {
  global.crypto = crypto;
}

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const fs = require('fs');
const P = require('pino'); // ✅ gunakan pino untuk logger

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
      auth: state,
      browser: ["Ubuntu", "Chrome", "22.04.4"],
      logger: P({ level: 'info' })
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ✅ QR tampil manual di terminal
      if (qr) {
        console.log('\n--- SILAKAN SCAN QR CODE DI BAWAH INI ---');
        qrcodeTerminal.generate(qr, { small: true });
      }

      // 🔄 Handle koneksi
      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log('Koneksi terputus, mencoba menghubungkan ulang...');

        if (reason === DisconnectReason.loggedOut) {
          console.log('Sesi kedaluwarsa atau logout. Menghapus folder sesi lama...');
          if (fs.existsSync('auth_info_baileys')) {
            fs.rmSync('auth_info_baileys', { recursive: true, force: true });
          }
        }

        // Reconnect otomatis
        setTimeout(connectToWhatsApp, 3000);
      } else if (connection === 'open') {
        console.log('✅ WhatsApp Berhasil Terhubung!');
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.log('❌ Error saat inisialisasi WA:', error.message);
  }
}

connectToWhatsApp();

// 📨 Endpoint kirim pesan
app.post('/send-message', async (req, res) => {
  const phoneNumber = req.body.phone;
  const message = req.body.message;

  if (!sock) {
    return res.status(500).json({ status: false, pesan: 'WhatsApp belum siap' });
  }

  try {
    const id = phoneNumber.replace(/\D/g, '') + '@s.whatsapp.net'; // pastikan format nomor bersih
    await sock.sendMessage(id, { text: message });
    res.json({ status: true, pesan: 'Pesan berhasil dikirim ke ' + phoneNumber });
  } catch (error) {
    res.status(500).json({ status: false, pesan: error.message });
  }
});

// 🧩 Endpoint status koneksi (opsional)
app.get('/status', (req, res) => {
  if (!sock) {
    return res.json({ status: false, pesan: 'Belum terhubung ke WhatsApp' });
  }
  res.json({ status: true, pesan: 'WhatsApp sedang terhubung' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});
