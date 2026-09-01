import { randomUUID } from "node:crypto";

import {
  BridgeToAdapterMessageSchema,
  type AdapterCommandResultMessage,
  type BridgeToAdapterMessage,
  type SimulatorSessionConfiguration,
} from "@scarline/contracts";
import WebSocket, { type ClientOptions, type RawData } from "ws";

import type { MockSimulatorConfig } from "./config.js";
import { MockCommandJournal } from "./journal.js";

const CAPABILITIES = [
  "vehicle.telemetry",
  "vehicle-control",
  "vehicle-spawning",
  "weather-control",
] as const;

type AdapterCommand = Exclude<BridgeToAdapterMessage, {
  type: "adapter.registered" | "bridge.error" | "adapter.vehicle_control";
}>;

interface SimulatorSocket {
  readonly readyState: number;
  on(event: "open", listener: () => void): this;
  on(event: "message", listener: (raw: RawData) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  on(event: "close", listener: () => void): this;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type SocketFactory = (url: string, options: ClientOptions) => SimulatorSocket;

export class MockSimulatorClient {
  readonly #config: MockSimulatorConfig;
  readonly #journal: MockCommandJournal;
  readonly #createSocket: SocketFactory;
  #socket: SimulatorSocket | undefined;
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #telemetryTimer: NodeJS.Timeout | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #stopped = true;
  #registered = false;
  #commandInFlight = false;
  #activeConfiguration: SimulatorSessionConfiguration | null = null;
  #paused = false;
  #tick = 0;

  constructor(
    config: MockSimulatorConfig,
    journal = new MockCommandJournal(config.commandJournalPath),
    createSocket: SocketFactory = (url, options) => new WebSocket(url, options),
  ) {
    this.#config = config;
    this.#journal = journal;
    this.#createSocket = createSocket;
  }

  get isConnected(): boolean {
    return this.#registered && this.#socket?.readyState === WebSocket.OPEN;
  }

  async start(): Promise<void> {
    if (!this.#stopped) return;
    this.#stopped = false;
    await this.#journal.load();
    this.#activeConfiguration = this.#journal.activeConfiguration;
    this.#paused = this.#journal.paused;
    this.#connect();
    const period = 1_000 / this.#config.project.simulator.mock.telemetry_hz;
    this.#telemetryTimer = setInterval(() => this.#publishTelemetry(), period);
  }

  stop(): void {
    this.#stopped = true;
    if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
    if (this.#telemetryTimer !== undefined) clearInterval(this.#telemetryTimer);
    if (this.#reconnectTimer !== undefined) clearTimeout(this.#reconnectTimer);
    this.#heartbeatTimer = undefined;
    this.#telemetryTimer = undefined;
    this.#reconnectTimer = undefined;
    this.#socket?.close(1000, "Mock Simulator is shutting down");
    this.#socket = undefined;
    this.#registered = false;
  }

  #connect(): void {
    if (this.#stopped) return;
    const socket = this.#createSocket(this.#config.bridgeUrl, {
      headers: {
        authorization: `Bearer ${this.#config.secrets.SIM_BRIDGE_ADAPTER_SECRET}`,
      },
      maxPayload: this.#config.project.sim_bridge.maximum_websocket_message_bytes,
    });
    this.#socket = socket;
    socket.on("open", () => this.#register());
    socket.on("message", (raw) => void this.#handleMessage(raw));
    socket.on("error", (error) => console.error("Mock Simulator WebSocket error:", error.message));
    socket.on("close", () => {
      this.#registered = false;
      if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
      this.#scheduleReconnect();
    });
  }

  #register(): void {
    this.#send({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "adapter.register",
      adapterId: this.#config.project.simulator.mock.adapter_id,
      name: "SCARline Mock Simulator",
      simulatorType: "mock",
      simulatorVersion: "1.0.0",
      capabilities: [...CAPABILITIES],
      priority: this.#config.project.simulator.mock.priority,
      activeSessionId: this.#activeConfiguration?.sessionId ?? null,
    });
  }

  async #handleMessage(raw: RawData): Promise<void> {
    try {
      const buffer = Array.isArray(raw)
        ? Buffer.concat(raw)
        : Buffer.isBuffer(raw)
          ? raw
          : Buffer.from(raw);
      const message = BridgeToAdapterMessageSchema.parse(JSON.parse(buffer.toString("utf8")));
      if (message.type === "adapter.registered") {
        this.#registered = true;
        if (this.#heartbeatTimer !== undefined) clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = setInterval(
          () => this.#publishHeartbeat(),
          message.heartbeatIntervalMilliseconds,
        );
        this.#heartbeatTimer.unref();
        this.#publishHeartbeat();
        return;
      }
      if (message.type === "bridge.error") {
        console.error(`Sim Bridge rejected Mock Simulator message: ${message.code}: ${message.message}`);
        return;
      }
      if (message.type === "adapter.vehicle_control") return;
      await this.#handleCommand(message);
    } catch (error) {
      console.error("Mock Simulator rejected bridge message:", error);
      this.#socket?.close(1008, "Invalid bridge message");
    }
  }

  async #handleCommand(command: AdapterCommand): Promise<void> {
    const cached = this.#journal.result(command.commandId);
    if (cached !== undefined) {
      this.#send(cached);
      return;
    }
    this.#commandInFlight = true;
    try {
      let result: AdapterCommandResultMessage;
      if (Date.parse(command.deadlineAt) <= Date.now()) {
        result = this.#result(command.commandId, false, "COMMAND_EXPIRED", "Command deadline has passed.");
      } else {
        result = this.#apply(command);
      }
      await this.#journal.record(result, this.#activeConfiguration, this.#paused);
      this.#send(result);
      if (result.success) {
        if (command.type === "adapter.pause_session") this.#publishState("paused");
        if (["adapter.bind_session", "adapter.advance_session", "adapter.resume_session"].includes(command.type)) {
          this.#publishState("running");
        }
      }
    } finally {
      this.#commandInFlight = false;
    }
  }

  #apply(command: AdapterCommand): AdapterCommandResultMessage {
    if (command.type === "adapter.bind_session") {
      if (command.simulatorType !== "mock") {
        return this.#result(command.commandId, false, "SIMULATOR_TYPE_MISMATCH", "Mock Simulator cannot load this simulator type.");
      }
      if (this.#activeConfiguration !== null && this.#activeConfiguration.sessionId !== command.sessionId) {
        return this.#result(command.commandId, false, "SESSION_CONFLICT", "Mock Simulator is already bound to another session.");
      }
      this.#activeConfiguration = this.#configuration(command);
      this.#paused = false;
      return this.#result(command.commandId, true, "COMPLETED", "Mock session started.");
    }
    if (this.#activeConfiguration?.sessionId !== command.sessionId) {
      if (command.type === "adapter.unbind_session") {
        this.#activeConfiguration = null;
        this.#paused = false;
        return this.#result(command.commandId, true, "COMPLETED", "No matching mock session required cleanup.");
      }
      return this.#result(command.commandId, false, "SESSION_NOT_BOUND", "Mock Simulator is not bound to this session.");
    }
    if (command.type === "adapter.advance_session") {
      if (command.simulatorType !== "mock") {
        return this.#result(command.commandId, false, "SIMULATOR_TYPE_MISMATCH", "Mock Simulator cannot advance to this simulator type.");
      }
      this.#activeConfiguration = this.#configuration(command);
      this.#paused = false;
      return this.#result(command.commandId, true, "COMPLETED", "Mock condition advanced.");
    }
    if (command.type === "adapter.pause_session") {
      this.#paused = true;
      return this.#result(command.commandId, true, "COMPLETED", "Mock session paused.");
    }
    if (command.type === "adapter.resume_session") {
      this.#paused = false;
      return this.#result(command.commandId, true, "COMPLETED", "Mock session resumed.");
    }
    if (command.type === "adapter.unbind_session") {
      this.#activeConfiguration = null;
      this.#paused = false;
      return this.#result(command.commandId, true, "COMPLETED", "Mock session released.");
    }
    if (command.requiredCapability !== null && !CAPABILITIES.includes(command.requiredCapability as typeof CAPABILITIES[number])) {
      return this.#result(command.commandId, false, "CAPABILITY_UNAVAILABLE", `Unsupported capability ${command.requiredCapability}.`);
    }
    return this.#result(command.commandId, true, "COMPLETED", `Mock command ${command.command} applied.`);
  }

  #configuration(
    command: Extract<AdapterCommand, { type: "adapter.bind_session" | "adapter.advance_session" }>,
  ): SimulatorSessionConfiguration {
    return {
      studyId: command.studyId,
      sessionId: command.sessionId,
      sessionConditionId: command.sessionConditionId,
      sequence: command.sequence,
      simulatorType: command.simulatorType,
      configuration: command.configuration,
    };
  }

  #result(commandId: string, success: boolean, code: string, message: string): AdapterCommandResultMessage {
    return {
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "adapter.command_result",
      commandId,
      success,
      code,
      message,
      details: {},
      activeSessionId: this.#activeConfiguration?.sessionId ?? null,
    };
  }

  #publishHeartbeat(): void {
    this.#send({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "adapter.heartbeat",
      status: this.#activeConfiguration === null ? "ready" : "busy",
      activeSessionId: this.#activeConfiguration?.sessionId ?? null,
    });
  }

  #publishTelemetry(): void {
    if (!this.isConnected || this.#commandInFlight || this.#activeConfiguration === null || this.#paused) return;
    this.#tick += 1;
    const phase = this.#tick / 20;
    this.#send({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "vehicle.telemetry",
      speed: Math.max(0, 35 + Math.sin(phase) * 10),
      throttle: Math.max(0, Math.min(1, 0.5 + Math.sin(phase / 2) * 0.25)),
      steer: Math.max(-1, Math.min(1, Math.sin(phase / 3) * 0.15)),
      brake: 0,
    });
  }

  #publishState(state: "running" | "paused" | "stopped"): void {
    if (!this.isConnected) return;
    this.#send({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: "simulator.state",
      state,
      details: {},
    });
  }

  #send(message: unknown): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer !== undefined) return;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      this.#connect();
    }, this.#config.project.simulator.mock.reconnect_interval_seconds * 1_000);
  }
}
