const WS_URL_BASE = 'ws://localhost:8088/ws';

// Token de desarrollo estático válido por 100 años (bypass de auth para la demo)
const DEV_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDAiLCJ1c2VybmFtZSI6ImRlbW8iLCJyb2xlcyI6WyJBZG1pbiJdLCJkaXNwbGF5TmFtZSI6IkRlbW8gVXNlciIsImV4cCI6NDkzNDYyNTEwN30.iqnRRiDD9WaoWcsJvWP4Q4wG4eWqSPFXuwyHx4pzEeU';

let ws = null;

function connectSCARline(onMessage) {
    ws = new WebSocket(`${WS_URL_BASE}?token=${encodeURIComponent(DEV_TOKEN)}`);
    
    ws.onopen = () => {
        console.log("Connected to SCARline WebSocket (Auth Bypassed)");
        // Subscribe to sensor telemetry
        ws.send(JSON.stringify({
            action: "subscribe",
            channels: ["session.telemetry", "sensor.status"]
        }));
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === "event" && data.data) {
                onMessage(data.data);
            }
        } catch (e) {
            console.error("Invalid JSON:", event.data);
        }
    };
    
    ws.onerror = (e) => {
        console.error("WebSocket error:", e);
    };
    
    ws.onclose = (e) => {
        console.log("WebSocket closed. Reconnecting in 2s...");
        setTimeout(() => connectSCARline(onMessage), 2000);
    };
}

function appendLog(logElement, obj, maxLines = 15) {
    const el = document.createElement('div');
    el.className = 'log-entry';
    const time = new Date().toISOString().split('T')[1].replace('Z', '');
    const jsonStr = JSON.stringify(obj).replace(/"/g, '');
    el.innerHTML = `<span style="color:#89b4fa">[${time}]</span> <span style="color:#a6e3a1">${jsonStr.substring(0, 100)}...</span>`;
    logElement.appendChild(el);
    while (logElement.children.length > maxLines) {
        logElement.removeChild(logElement.firstChild);
    }
    logElement.scrollTop = logElement.scrollHeight;
}
