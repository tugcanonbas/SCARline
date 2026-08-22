import json
import threading
import collections
import pika
import matplotlib.pyplot as plt
import matplotlib.animation as animation

AMQP_URL = "amqp://scarline:scarline@localhost:5672"
ROUTING_KEY = "events.#.sensor.io.ecg"
EXCHANGE = "scarline.events"
WINDOW_SECONDS = 5
SAMPLE_RATE = 500
MAX_SAMPLES = WINDOW_SECONDS * SAMPLE_RATE

samples = collections.deque(maxlen=MAX_SAMPLES)
lock = threading.Lock()
status = {"connected": False, "session": "—"}

def on_message(ch, method, properties, body):
    try:
        envelope = json.loads(body)
        payload = envelope.get("payload", {})
        ecg_samples = payload.get("ecgSamples") or []
        connected = payload.get("connected", False)
        routing = envelope.get("routingKey", "")
        parts = routing.split(".")
        run_id = parts[2][:8] if len(parts) > 2 else "—"
        with lock:
            samples.extend(ecg_samples)
            status["connected"] = connected
            status["session"] = run_id
    except Exception:
        pass

def start_consumer():
    conn = pika.BlockingConnection(pika.URLParameters(AMQP_URL))
    ch = conn.channel()
    ch.exchange_declare(exchange=EXCHANGE, exchange_type="topic", durable=True)
    result = ch.queue_declare(queue="", exclusive=True)
    ch.queue_bind(result.method.queue, EXCHANGE, ROUTING_KEY)
    ch.basic_consume(result.method.queue, on_message, auto_ack=True)
    ch.start_consuming()

threading.Thread(target=start_consumer, daemon=True).start()

fig, ax = plt.subplots(figsize=(12, 4))
fig.patch.set_facecolor("#0f0f0f")
ax.set_facecolor("#0f0f0f")
ax.set_title("SCARline — ECG en Tiempo Real", color="white", fontsize=13)
ax.set_xlabel("Muestras", color="#888")
ax.set_ylabel("Amplitud", color="#888")
ax.tick_params(colors="#555")
for spine in ax.spines.values():
    spine.set_edgecolor("#333")
line, = ax.plot([], [], color="#00ff88", linewidth=0.8)
status_text = ax.text(0.01, 0.95, "", transform=ax.transAxes,
                      color="#00ff88", fontsize=9, va="top")

def update(frame):
    with lock:
        data = list(samples)
        conn = status["connected"]
        sid = status["session"]
    if data:
        ax.set_xlim(0, len(data))
        mn, mx = min(data), max(data)
        pad = (mx - mn) * 0.1 or 1
        ax.set_ylim(mn - pad, mx + pad)
        line.set_data(range(len(data)), data)
    label = f"{'[ON] Conectado' if conn else '[--] Degradado'}  |  Sesion: {sid}  |  {len(data)} muestras"
    status_text.set_text(label)
    return line, status_text

ani = animation.FuncAnimation(fig, update, interval=100, blit=True, cache_frame_data=False)
plt.tight_layout()
plt.show()
