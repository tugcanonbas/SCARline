import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync } from "node:fs";

import { IoDriverManifestSchema, IoLifecycleCommandSchema, IoSensorBatchPayloadSchema, MessageEnvelopeSchema } from "../src/index.js";

const studyId="11111111-1111-4111-8111-111111111111",sessionId="22222222-2222-4222-8222-222222222222",conditionId="33333333-3333-4333-8333-333333333333";

test("validates strict IO driver manifests", () => {
  const result=IoDriverManifestSchema.parse({key:"mock",name:"Mock",version:"1.0.0",deviceType:"synthetic",platforms:["linux","darwin","win32"],capabilities:["development.synthetic"],configurationSchema:{},channels:[{key:"value",name:"Value",modality:"sensor",unit:null,sampleRate:10,configurationSchema:{}}],optionalDependency:null,mock:true});
  assert.equal(result.channels[0]?.sampleRate,10);
  assert.throws(()=>IoDriverManifestSchema.parse({...result,unexpected:true}));
});

test("every installed sensor channel can pass the RabbitMQ envelope validator", () => {
  const directory = new URL("../../../services/io-client/drivers/", import.meta.url);
  for (const filename of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
    const manifest = IoDriverManifestSchema.parse(JSON.parse(readFileSync(new URL(filename, directory), "utf8")));
    for (const channel of manifest.channels) {
      const envelope = {
        id: conditionId, timestamp: "2026-09-13T10:00:00.000Z", producer: "io-client",
        routingKey: `events.${studyId}.${sessionId}.${channel.modality}.io.${channel.key}`,
        metadata: { studyId, sessionId, correlationId: null, source: { component: "io-client", instanceId: "test-host" } },
        payload: {},
      };
      assert.equal(MessageEnvelopeSchema.safeParse(envelope).success, true, `${manifest.key}/${channel.key}`);
      for (const invalid of ["heart rate", "heart_rate#", "heart_rate*"]) {
        assert.equal(MessageEnvelopeSchema.safeParse({ ...envelope,
          routingKey: `events.${studyId}.${sessionId}.health.io.${invalid}` }).success, false);
      }
    }
  }
});

test("binds IO lifecycle commands and batches to session UUIDs", () => {
  const command=IoLifecycleCommandSchema.parse({commandId:"44444444-4444-4444-8444-444444444444",sessionId,deadlineAt:"2026-08-24T20:00:00.000Z",action:"start",configuration:{studyId,sessionId,sessionConditionId:conditionId,sequence:0,devices:[],recording:{enabled:false,directory:null}}});
  assert.equal(command.action,"start");
  const batch=IoSensorBatchPayloadSchema.parse({sessionConditionId:conditionId,deviceId:"55555555-5555-4555-8555-555555555555",sensorId:"66666666-6666-4666-8666-666666666666",sourceKey:"driver:mock",channelKey:"value",sequenceStart:0,sampleRate:10,sourceTimestamp:"2026-08-24T20:00:00.000Z",droppedSamples:0,samples:[{value:1}]});
  assert.equal(batch.samples.length,1);
  assert.equal(IoSensorBatchPayloadSchema.safeParse({ ...batch, sampleTimestamps: [batch.sourceTimestamp] }).success, true);
  assert.equal(IoSensorBatchPayloadSchema.safeParse({ ...batch, sampleTimestamps: [] }).success, false);
});
