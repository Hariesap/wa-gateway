const crypto = require('crypto');
if (!global.crypto) {
  global.crypto = crypto;
}

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcode = require('qrcode'); // Pastikan package 'qrcode' sudah di-install di package.json
const fs = require('fs');
const P = require('pino');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;
let latestQR = null;
let isConnected = false;

async function connectToWhatsApp() {
  try {
    const sessionPath = './auth_info_baileys'; // Gunakan folder lokal project agar aman di Railway

    if (!fs.existsSync(sessionPath)) {
      fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    sock = makeWASocket({
      auth: state,
      browser: ["Ubuntu", "Chrome", "22.04.4"],
      logger: P({ level: 'silent' }) // Matikan log debug agar bersih
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQR = qr;
        isConnected = false;
        console.log('🧩 [INFO] QR Code baru berhasil diterima, silakan buka /qr di browser.');
      }

      if (connection === 'close') {
        isConnected = false;
        latestQR = null;
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
        console.log('❌ Koneksi terputus, mencoba menghubungkan ulang...');

        if (reason === DisconnectReason.loggedOut) {
          console.log('⚠️ Sesi logout. Menghapus folder sesi...');
          if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
        }

        setTimeout(connectToWhatsApp, 3000);
      } else if (connection === 'open') {
        isConnected = true;
        latestQR = null;
        console.log('✅ WhatsApp Berhasil Terhubung!');
      }
    });

    sock.ev.on('creds.update', saveCreds);
  } catch (error) {
    console.log('❌ Error saat inisialisasi WA:', error.message);
  }
}

connectToWhatsApp();

// 🌐 ENDPOINT BARU: Buka link ini di browser untuk scan QR Code secara visual!
app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.send('<h3>✅ WhatsApp sudah terhubung dengan sukses! Tidak perlu scan QR lagi.</h3>');
  }
  if (!latestQR) {
    return res.send('<h3>⏳ QR Code sedang disiapkan oleh server, silakan refresh halaman ini dalam beberapa detik...</h3>');
  }

  try {
    const qrImage = await qrcode.toDataURL(latestQR);
    res.send(`
      <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
        <h2>Scan QR Code WhatsApp Gateway</h2>
        <p>Gunakan aplikasi WhatsApp di HP Anda untuk scan QR di bawah ini:</p>
        <img src="${qrImage}" alt="QR Code WhatsApp" style="width:300px; height:300px; border:1px solid #ccc; padding:10px; border-radius:10px;" />
        <br><br>
        <p style="color: gray;">Halaman ini akan otomatis memperbarui status jika sudah terhubung.</p>
        <script>
          setInterval(() => {
            fetch('/status-json').then(res => res.json()).then(data => {
              if(data.connected) { location.reload(); }
            });
          }, 3000);
        </script>
      </div>
    `);
  } catch (err) {
    res.status(500).send('Gagal merender QR Code');
  }
});

// JSON Status untuk AJAX auto-refresh
app.get('/status-json', (req, res) => {
  res.json({ connected: isConnected, hasQR: !!latestQR });
});

// 📨 Endpoint kirim pesan
app.post('/send-message', async (req, res) => {
  const phoneNumber = req.body.phone;
  const message = req.body.message;

  if (!sock || !isConnected) {
    return res.status(500).json({ status: false, pesan: 'WhatsApp belum siap atau belum di-scan' });
  }

  try {
    const id = phoneNumber.replace(/\D/g, '') + '@s.whatsapp.net';
    await sock.sendMessage(id, { text: message });
    res.json({ status: true, pesan: 'Pesan berhasil dikirim ke ' + phoneNumber });
  } catch (error) {
    res.status(500).json({ status: false, pesan: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server berjalan di port ${PORT}`);
});
