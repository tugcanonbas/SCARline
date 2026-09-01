import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { LoadedProjectConfig } from "./config.js";
import { ProjectError } from "./errors.js";

const run=promisify(execFile);

export async function ensureIoClientEnvironment(repositoryRoot:string,project:LoadedProjectConfig):Promise<string>{
  if(!project.config.services.io_client.enabled)return "disabled";
  if(project.config.services.io_client.runtime==="docker")return "managed by Docker";
  const root=path.join(project.runtimeDirectory,"io-client","venv");await mkdir(path.dirname(root),{recursive:true,mode:0o700});
  let versionOutput="";
  try{const result=await run(project.config.services.io_client.python_executable,["--version"],{cwd:repositoryRoot,timeout:10_000});versionOutput=`${result.stdout}${result.stderr}`;}
  catch(error){throw new ProjectError(`Python 3.12 or newer is required for IO Client: ${error instanceof Error?error.message:String(error)}`);}
  const match=/Python\s+(\d+)\.(\d+)/.exec(versionOutput);
  if(!match||Number(match[1])<3||(Number(match[1])===3&&Number(match[2])<12))throw new ProjectError(`Python 3.12 or newer is required for IO Client; found ${versionOutput.trim()||"an unknown version"}.`);
  const python=process.platform==="win32"?path.join(root,"Scripts","python.exe"):path.join(root,"bin","python");
  try{await run(python,["--version"],{cwd:repositoryRoot,timeout:10_000});}catch{await run(project.config.services.io_client.python_executable,["-m","venv",root],{cwd:repositoryRoot,timeout:120_000});}
  await run(python,["-m","pip","install","--disable-pip-version-check","-e",path.join(repositoryRoot,"services","io-client")],{cwd:repositoryRoot,timeout:300_000});
  return python;
}
