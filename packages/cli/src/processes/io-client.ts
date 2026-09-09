import { spawn } from "node:child_process";
import { access, open, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { InfrastructureContext } from "../infrastructure/compose.js";
import { loadEnvironmentSecrets } from "../project/environment.js";
import { ProjectError } from "../project/errors.js";

interface ProcessRecord { version: 1; pid: number; startedAt: string; mockEnabled: boolean }
export interface IoClientProcessStatus { running: boolean; healthy: boolean; pid: number | null; mockEnabled: boolean }
export interface IoClientProcessManager {
  start(context: InfrastructureContext, mockEnabled?: boolean): Promise<IoClientProcessStatus>;
  stop(context: InfrastructureContext): Promise<IoClientProcessStatus>;
  status(context: InfrastructureContext): Promise<IoClientProcessStatus>;
}

export const ioClientProcessManager: IoClientProcessManager = {
  async start(context, mockEnabled = context.config.services.io_client.mock_enabled) {
    if (context.config.services.io_client.runtime !== "host") throw new ProjectError("Docker IO Client mode must be started through its Compose profile.");
    const existing=await processStatus(context); if(existing.running)return existing;
    const python=venvPython(context); try{await access(python);}catch{throw new ProjectError("IO Client Python environment is missing. Run scarline setup first.");}
    const environment=await loadEnvironmentSecrets(context.repositoryRoot); const runtime=path.dirname(context.stateDirectory); const log=await open(path.join(runtime,"logs","io-client.log"),"a",0o600);
    const config=context.config.services.io_client;
    const child=spawn(python,["-m","scarline_io","--rabbit-host","127.0.0.1","--rabbit-port",String(context.config.rabbitmq.port),"--rabbit-user",context.config.rabbitmq.user,"--drivers-directory",path.join(context.repositoryRoot,context.config.api.sensors_directory),"--command-journal",path.resolve(context.repositoryRoot,config.command_journal),"--media-directory",path.resolve(context.repositoryRoot,config.media_directory),"--health-port",String(config.health_port),"--heartbeat-interval",String(config.heartbeat_interval_seconds),"--batch-max-samples",String(config.batch_max_samples),"--batch-max-milliseconds",String(config.batch_max_milliseconds),mockEnabled?"--mock-enabled":"--no-mock-enabled"],{cwd:context.repositoryRoot,detached:true,windowsHide:true,stdio:["ignore",log.fd,log.fd],env:{...process.env,RABBITMQ_DEFAULT_PASS:environment.secrets.RABBITMQ_DEFAULT_PASS}});
    child.unref(); await log.close(); if(!child.pid)throw new ProjectError("IO Client process could not be started.");
    await writeRecord(context,{version:1,pid:child.pid,startedAt:new Date().toISOString(),mockEnabled});
    const deadline=Date.now()+10_000;let result=await processStatus(context);
    while(result.running&&!result.healthy&&Date.now()<deadline){await delay(200);result=await processStatus(context);}
    if(!result.running)throw new ProjectError("IO Client exited during startup. Check .runtime/logs/io-client.log.");
    if(!result.healthy){await this.stop(context);throw new ProjectError("IO Client did not become healthy. Check .runtime/logs/io-client.log.");}
    return result;
  },
  async stop(context){const record=await readRecord(context);if(record&&alive(record.pid)){try{process.kill(record.pid,"SIGTERM");}catch{}const deadline=Date.now()+context.config.platform.shutdown_timeout_seconds*1000;while(Date.now()<deadline&&alive(record.pid))await delay(100);if(alive(record.pid))process.kill(record.pid,"SIGKILL");}await removeRecord(context);return{running:false,healthy:false,pid:null,mockEnabled:false};},
  status:processStatus,
};

export function venvPython(context: InfrastructureContext): string { const root=path.join(path.dirname(context.stateDirectory),"io-client","venv");return process.platform==="win32"?path.join(root,"Scripts","python.exe"):path.join(root,"bin","python"); }
async function processStatus(context:InfrastructureContext):Promise<IoClientProcessStatus>{const record=await readRecord(context);if(record&&alive(record.pid))return{running:true,healthy:await health(context.config.services.io_client.health_port),pid:record.pid,mockEnabled:record.mockEnabled};if(record)await removeRecord(context);return{running:false,healthy:false,pid:null,mockEnabled:false};}
async function readRecord(context:InfrastructureContext):Promise<ProcessRecord|null>{try{const value=JSON.parse(await readFile(recordPath(context),"utf8")) as ProcessRecord;return value.version===1&&Number.isSafeInteger(value.pid)?value:null;}catch{return null;}}
async function writeRecord(context:InfrastructureContext,value:ProcessRecord){await writeFile(recordPath(context),`${JSON.stringify(value,null,2)}\n`,{mode:0o600});}
async function removeRecord(context:InfrastructureContext){try{await unlink(recordPath(context));}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}
function recordPath(context:InfrastructureContext){return path.join(path.dirname(context.stateDirectory),"processes","io-client.json");}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code==="EPERM";}}
async function health(port:number){try{const response=await fetch(`http://127.0.0.1:${port}/health`,{signal:AbortSignal.timeout(750)});return response.ok;}catch{return false;}}
function delay(milliseconds:number){return new Promise(resolve=>setTimeout(resolve,milliseconds));}
