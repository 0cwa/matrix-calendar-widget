/*
 * Copyright 2026 Matrix Calendar Widget contributors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { randomUUID } from 'node:crypto';

export const SERVER_DATA_MARKER_NAME_PATTERN =
  '^\\.restore-fixture-marker-[a-f0-9-]{36}$';
const MARKER_NAME = new RegExp(SERVER_DATA_MARKER_NAME_PATTERN, 'u');

export function createSyntheticServerDataMarker() {
  const id = randomUUID();
  return {
    name: `.restore-fixture-marker-${id}`,
    contents: `synthetic-server-data:${id}\n`,
  };
}

export function createServerDataMarkerWriterProgram(storagePath, contents) {
  if (typeof storagePath !== 'string' || !storagePath.startsWith('/')) {
    throw new TypeError('storage path must be absolute');
  }
  if (typeof contents !== 'string' || contents.length > 128) {
    throw new TypeError('marker contents are invalid');
  }
  return [
    "const fs=require('node:fs');const path=require('node:path');const name=process.argv[1]",
    `if(!(new RegExp(${JSON.stringify(SERVER_DATA_MARKER_NAME_PATTERN)})).test(name))process.exit(2)`,
    `const target=path.join(${JSON.stringify(storagePath)},name);let fd;try{fd=fs.openSync(target,'wx',0o600)}catch(error){if(error.code==='EEXIST')process.exit(73);throw error}try{fs.writeFileSync(fd,${JSON.stringify(contents)});fs.fsyncSync(fd)}catch(error){try{const opened=fs.fstatSync(fd);const current=fs.lstatSync(target);if(current.dev===opened.dev&&current.ino===opened.ino)fs.unlinkSync(target)}catch{}throw error}finally{fs.closeSync(fd)}`,
  ].join(';');
}

export function createServerDataMarkerCleanupScript(contents) {
  if (typeof contents !== 'string' || contents.length > 128) {
    throw new TypeError('marker contents are invalid');
  }
  return [
    'import os,re,stat,sys',
    'directory,name=sys.argv[1:3]',
    "if not re.fullmatch(r'\\.restore-fixture-marker-[a-f0-9-]{36}',name): raise ValueError()",
    'path=os.path.join(directory,name)',
    'try: fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)',
    'except FileNotFoundError: print("absent"); raise SystemExit(0)',
    'info=os.fstat(fd)',
    'contents=os.read(fd,128)',
    'os.close(fd)',
    `if not stat.S_ISREG(info.st_mode) or (info.st_uid,info.st_gid)!=(int(sys.argv[3]),int(sys.argv[4])) or stat.S_IMODE(info.st_mode)!=0o600 or contents!=${JSON.stringify(contents)}.encode(): raise ValueError()`,
    'os.unlink(path)',
    'print("removed")',
  ].join('\n');
}
