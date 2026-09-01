import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { scanSensorCatalogue, SensorCatalogueValidationError } from "../src/sensors/catalogue.js";

const manifest = { key:"mock",name:"Mock",version:"1.0.0",deviceType:"synthetic",platforms:["linux","darwin","win32"],capabilities:["development.synthetic"],configurationSchema:{},channels:[{key:"value",name:"Value",modality:"sensor",unit:null,sampleRate:10,configurationSchema:{}}],optionalDependency:null,mock:true };

test("discovers valid sensor manifests", async (context) => {
  const root=await mkdtemp(path.join(tmpdir(),"scarline-sensors-")); context.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,"mock.json"),JSON.stringify(manifest));
  assert.deepEqual(await scanSensorCatalogue(root),[manifest]);
});

test("rejects invalid sensor manifests atomically", async (context) => {
  const root=await mkdtemp(path.join(tmpdir(),"scarline-sensors-")); context.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,"wrong.json"),JSON.stringify(manifest));
  await assert.rejects(()=>scanSensorCatalogue(root),(error:unknown)=>error instanceof SensorCatalogueValidationError && error.issues.length===1);
});
