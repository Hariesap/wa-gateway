const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

let sock;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        auth: state
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('--- SILAKAN SCAN QR CODE DI BAWAH INI ---');
            qrcodeTerminal.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error = Boom)?.output?.statusCode !== 401;
            console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            }
        } else if (connection === 'open') {
            console.log('WhatsApp Berhasil Terhubung!');
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

connectToWhatsApp();

app.post('/send-message', async (req, res) => {
    const phoneNumber = req.body.phone;
    const message = req.body.message;

    if (!sock) {
        return res.status(500).json({ status: false, pesan: 'WhatsApp belum siap' });
    }

    try {
        const id = phoneNumber + '@s.whatsapp.net';
        await sock.sendMessage(id, { text: message });
        res.json({ status: true, pesan: 'Pesan berhasil dikirim' });
    } catch (error) {
        res.status(500).json({ status: false, pesan: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});
