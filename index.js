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
const P = require('pino');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;

async function connectToWhatsApp() {
  try {
    const sessionPath = '/tmp/auth_info_baileys';
    let sessionExists = fs.existsSync(sessionPath);

    // ✅ Cek apakah folder kosong atau rusak
    if (sessionExists) {
      const files = fs.readdirSync(sessionPath);
      if (files.length === 0) {
        console.log('⚠️ Folder sesi kosong, QR akan dibuat ulang...');
        sessionExists = false;
      }
    }

    if (!sessionExists) {
      fs.mkdirSync(sessionPath, { recursive: true });
      console.log('📁 Folder sesi dibuat di /tmp');
      console.log('⚠️ Belum ada sesi login, QR akan muncul setelah koneksi dibuat...');
    } else {
      console.log('✅ Folder sesi ditemukan, mencoba login tanpa QR...');
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    sock = makeWASocket({
      auth: state,
      browser: ["Ubuntu", "Chrome", "22.04.4"],
      logger: P({ level: 'debug' })
    });

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ✅ QR tampil manual di terminal/log Railway
      if (qr) {
        console.log('\n🧩 [INFO] Baileys menerima event QR dari server WhatsApp');
        console.log('--- SILAKAN SCAN QR CODE DI BAWAH INI ---');
        qrcodeTerminal.generate(qr, { small: true });
        console.log('✅ QR berhasil dibuat dan ditampilkan di log');
      }

      // 🔄 Handle koneksi
      if (connection === 'close') {
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log('❌ Koneksi terputus, mencoba menghubungkan ulang...');

        if (reason === DisconnectReason.loggedOut) {
          console.log('⚠️ Sesi kedaluwarsa atau logout. Menghapus folder sesi lama...');
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
        }

        // Reconnect otomatis
        setTimeout(connectToWhatsApp, 3000);
      } else if (connection === 'open') {
        console.log('✅ WhatsApp Berhasil Terhubung!');
      } else if (connection === 'connecting') {
        console.log('🔄 Sedang mencoba menghubungkan ke WhatsApp...');
      }
    });

    // ✅ Tambahkan listener untuk status login
    sock.ev.on('connection.update', (update) => {
      if (update?.connection === undefined && update?.status === 'not logged in') {
        console.log('⚠️ [INFO] Status: not logged in → Menghapus sesi dan membuat QR baru...');
        if (fs.existsSync(sessionPath)) {
          fs.rmSync(sessionPath, { recursive: true, force: true });
        }
        setTimeout(connectToWhatsApp, 2000);
      }
    });

    sock.ev.on('creds.update', () => {
      console.log('💾 [INFO] Menyimpan kredensial sesi...');
      saveCreds();
    });
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
    const id = phoneNumber.replace(/\D/g, '') + '@s.whatsapp.net';
    await sock.sendMessage(id, { text: message });
    res.json({ status: true, pesan: 'Pesan berhasil dikirim ke ' + phoneNumber });
  } catch (error) {
    res.status(500).json({ status: false, pesan: error.message });
  }
});

// 🧩 Endpoint status koneksi
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
