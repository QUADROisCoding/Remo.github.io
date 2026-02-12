// Remo Control Panel Logic
// CHANGE THIS TO YOUR PUBLIC SERVER URL (e.g., https://my-remo-server.onrender.com)
// UNCOMMENT THE LOCALHOST LINE BELOW FOR LOCAL TESTING
// const SERVER_URL = 'http://localhost:3000';
const SERVER_URL = 'https://remo-server-placeholder.herokuapp.com'; // Example production URL

const socket = io(SERVER_URL);
let currentClientId = null;
let currentRdpId = null;

socket.on('connect', () => {
    console.log('Connected to Relay Server');
    document.getElementById('server-status').innerText = 'Relay Online';
    document.getElementById('server-status').className = 'status-badge status-online';

    socket.emit('register', { type: 'admin' });
});

socket.on('disconnect', () => {
    document.getElementById('server-status').innerText = 'Relay Offline';
    document.getElementById('server-status').className = 'status-badge status-offline';
});

socket.on('client_list', (clients) => {
    renderClients(clients);
});

socket.on('terminal_data', (data) => {
    if (currentClientId === data.clientId) {
        const output = document.getElementById('terminal-output');
        output.innerText += data.output;
        output.scrollTop = output.scrollHeight;
    }
});

socket.on('rdp_data', (data) => {
    if (currentRdpId === data.clientId) {
        document.getElementById('rdp-canvas').src = `data:image/jpeg;base64,${data.image}`;
    }
});

function renderClients(clients) {
    const tableBody = document.getElementById('client-table-body');
    tableBody.innerHTML = '';

    clients.forEach(client => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                <div style="font-weight: 600;">${client.name}</div>
                <div style="font-size: 0.8rem; color: #94a3b8;">${client.ip}</div>
            </td>
            <td>
                <img class="flag" src="https://flagcdn.com/w40/${client.countryCode.toLowerCase()}.png" alt="${client.country}">
                ${client.country}
            </td>
            <td>
                <span class="status-badge status-online">${client.status}</span>
            </td>
            <td style="color: #94a3b8;">${client.os}</td>
            <td>
                <button class="action-btn" onclick="openRDP('${client.id}', '${client.name}')">RDP</button>
                <button class="action-btn" style="background: var(--glass-border); margin-left: 8px;" onclick="openSSH('${client.id}', '${client.name}')">SSH</button>
            </td>
        `;
        tableBody.appendChild(row);
    });

    document.getElementById('active-count').innerText = clients.length;
}

// SSH Logic
function openSSH(id, name) {
    currentClientId = id;
    document.getElementById('terminal-target').innerText = name;
    document.getElementById('terminal-output').innerText = `Connected to ${name}...\n`;
    document.getElementById('ssh-modal').style.display = 'flex';
    document.getElementById('terminal-input').focus();
}

function closeSSH() {
    document.getElementById('ssh-modal').style.display = 'none';
    currentClientId = null;
}

function handleTerminalKey(e) {
    if (e.key === 'Enter') {
        const input = document.getElementById('terminal-input');
        const command = input.value;
        if (command && currentClientId) {
            socket.emit('terminal_input', { targetId: currentClientId, command: command });
            document.getElementById('terminal-output').innerText += `> ${command}\n`;
            input.value = '';
        }
    }
}

// RDP Logic
function openRDP(id, name) {
    currentRdpId = id;
    document.getElementById('rdp-target').innerText = name;
    document.getElementById('rdp-modal').style.display = 'flex';
    socket.emit('rdp_request', { targetId: id, active: true });
}

function closeRDP() {
    if (currentRdpId) {
        socket.emit('rdp_request', { targetId: currentRdpId, active: false });
    }
    document.getElementById('rdp-modal').style.display = 'none';
    currentRdpId = null;
    document.getElementById('rdp-canvas').src = '';
}

// Global Click listener for closing modals
window.onclick = function (event) {
    if (event.target == document.getElementById('ssh-modal')) closeSSH();
    if (event.target == document.getElementById('rdp-modal')) closeRDP();
}
