from __future__ import annotations

import asyncio
import json
import os
import subprocess
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4


@unittest.skipUnless(os.environ.get("SCARLINE_IO_INTEGRATION") == "1", "requires a running SCARline RabbitMQ and IO Client")
class RabbitLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_mock_driver_lifecycle_and_batch_delivery(self) -> None:
        import aio_pika

        password = self._rabbit_password()
        connection = await aio_pika.connect_robust(host="127.0.0.1", port=5672, login="scarline", password=password)
        channel = await connection.channel()
        commands = await channel.get_exchange("scarline.commands", ensure=False)
        events = await channel.get_exchange("scarline.events", ensure=False)
        queue = await channel.declare_queue(exclusive=True, auto_delete=False)
        study_id, session_id, condition_id = str(uuid4()), str(uuid4()), str(uuid4())
        await queue.bind(events, f"events.{study_id}.{session_id}.#")
        start_id, pause_id, resume_id, abort_id = str(uuid4()), str(uuid4()), str(uuid4()), str(uuid4())
        try:
            await commands.publish(aio_pika.Message(body=json.dumps(self._command(study_id, session_id, condition_id, start_id, "start")).encode()), routing_key="commands.io-client.session-start")
            start_ack = None; sensor_batches = {}
            expected_channels = {item["key"] for item in self._mock_channels()}
            async with queue.iterator() as messages:
                async with asyncio.timeout(5):
                    async for message in messages:
                        async with message.process():
                            value = json.loads(message.body)
                            if value["routingKey"].endswith(".command.ack") and value["payload"]["commandId"] == start_id: start_ack = value["payload"]
                            if value["payload"].get("channelKey") in expected_channels:
                                sensor_batches[value["payload"]["channelKey"]] = value
                            if start_ack and set(sensor_batches) == expected_channels: break
            self.assertEqual(start_ack["status"], "completed")
            for value in sensor_batches.values():
                self.assertGreater(len(value["payload"]["samples"]), 0)
                self.assertEqual(value["payload"]["sourceKey"], "driver:mock")
                self.assertEqual(len(value["payload"]["samples"]), len(value["payload"]["sampleTimestamps"]))
            # Exercise the exact TypeScript consumer contract against real Python messages.
            validation = await asyncio.to_thread(subprocess.run,
                ["node", "--input-type=module", "-e",
                 "import {MessageEnvelopeSchema,IoSensorBatchPayloadSchema} from '@scarline/contracts';"
                 "let input='';for await(const chunk of process.stdin)input+=chunk;"
                 "for(const message of JSON.parse(input)){MessageEnvelopeSchema.parse(message);IoSensorBatchPayloadSchema.parse(message.payload);}"],
                input=json.dumps(list(sensor_batches.values())), text=True, capture_output=True,
                cwd=Path(__file__).resolve().parents[3], timeout=10)
            self.assertEqual(validation.returncode, 0, validation.stderr)
            await commands.publish(aio_pika.Message(body=json.dumps(self._command(study_id, session_id, condition_id, pause_id, "pause")).encode()), routing_key="commands.io-client.session-pause")
            self.assertEqual((await self._wait_for_ack(queue, pause_id))["status"], "completed")
            await commands.publish(aio_pika.Message(body=json.dumps(self._command(study_id, session_id, condition_id, resume_id, "resume")).encode()), routing_key="commands.io-client.session-resume")
            resume_ack = None; resumed_batch = None
            async with queue.iterator() as messages:
                async with asyncio.timeout(5):
                    async for message in messages:
                        async with message.process():
                            value = json.loads(message.body)
                            if value["routingKey"].endswith(".command.ack") and value["payload"]["commandId"] == resume_id: resume_ack = value["payload"]
                            if value["routingKey"].endswith(".io.steering"): resumed_batch = value["payload"]
                            if resume_ack and resumed_batch: break
            self.assertEqual(resume_ack["status"], "completed")
            self.assertGreater(len(resumed_batch["samples"]), 0)
        finally:
            await commands.publish(aio_pika.Message(body=json.dumps(self._command(study_id, session_id, condition_id, abort_id, "abort")).encode()), routing_key="commands.io-client.session-abort")
            async with queue.iterator() as messages:
                async with asyncio.timeout(5):
                    async for message in messages:
                        async with message.process():
                            value = json.loads(message.body)
                            if value["routingKey"].endswith(".command.ack") and value["payload"]["commandId"] == abort_id:
                                self.assertEqual(value["payload"]["status"], "completed")
                                break
            await connection.close()

    async def _wait_for_ack(self, queue, command_id: str) -> dict:
        async with queue.iterator() as messages:
            async with asyncio.timeout(5):
                async for message in messages:
                    async with message.process():
                        value = json.loads(message.body)
                        if value["routingKey"].endswith(".command.ack") and value["payload"]["commandId"] == command_id:
                            return value["payload"]
        raise AssertionError(f"No acknowledgement for {command_id}")

    def _command(self, study_id: str, session_id: str, condition_id: str, command_id: str, action: str) -> dict:
        payload = {"commandId": command_id, "sessionId": session_id, "deadlineAt": (datetime.now(UTC) + timedelta(seconds=10)).isoformat().replace("+00:00", "Z"), "action": action}
        if action == "start":
            payload["configuration"] = {
                "studyId":study_id, "sessionId":session_id, "sessionConditionId":condition_id, "sequence":0,
                "devices":[{"assignmentId":str(uuid4()), "deviceId":str(uuid4()), "sourceKey":"driver:mock", "driverKey":"mock", "required":True, "onDisconnect":"fail", "configuration":{}, "sensors":[
                    {"sensorId":str(uuid4()), "key":channel["key"], "modality":channel["modality"], "unit":channel["unit"], "enabled":True, "sampleRate":channel["sampleRate"], "configuration":{}}
                    for channel in self._mock_channels()]}],
                "recording":{"enabled":False, "directory":None},
            }
        return {"id":str(uuid4()), "timestamp":datetime.now(UTC).isoformat().replace("+00:00", "Z"), "routingKey":f"commands.io-client.session-{action}", "producer":"core-api", "payload":payload, "metadata":{"studyId":study_id, "sessionId":session_id, "correlationId":command_id, "source":{"component":"core-api", "instanceId":None}}}

    def _mock_channels(self) -> list[dict]:
        manifest = Path(__file__).resolve().parents[1] / "drivers" / "mock.json"
        return json.loads(manifest.read_text(encoding="utf8"))["channels"]

    def _rabbit_password(self) -> str:
        environment = Path(__file__).resolve().parents[3] / ".env"
        for line in environment.read_text(encoding="utf8").splitlines():
            if line.startswith("RABBITMQ_DEFAULT_PASS="): return line.split("=", 1)[1].strip().strip("\"'")
        raise RuntimeError("RABBITMQ_DEFAULT_PASS is missing from .env")
