import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

export const DEFAULT_LANGGRAPH_DB = '.myteam/langgraph.sqlite';

let sharedCheckpointer = null;
let sharedPath = '';

export function createSqliteCheckpointer(file = process.env.MYTEAM_LANGGRAPH_DB || DEFAULT_LANGGRAPH_DB) {
  const target = resolve(file);
  mkdirSync(dirname(target), { recursive: true });
  return SqliteSaver.fromConnString(target);
}

export function getSharedCheckpointer(file = process.env.MYTEAM_LANGGRAPH_DB || DEFAULT_LANGGRAPH_DB) {
  const target = resolve(file);
  if (!sharedCheckpointer || sharedPath !== target) {
    sharedCheckpointer?.db?.close?.();
    sharedCheckpointer = createSqliteCheckpointer(target);
    sharedPath = target;
  }
  return sharedCheckpointer;
}

export function closeSharedCheckpointer() {
  sharedCheckpointer?.db?.close?.();
  sharedCheckpointer = null;
  sharedPath = '';
}
