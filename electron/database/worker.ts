import { PostgresDatabaseService } from './postgres-service';
import { parseDatabaseWorkerCommand, type DatabaseWorkerCommand, type DatabaseWorkerResponse } from './protocol';

const databaseService = new PostgresDatabaseService();
const parentPort = process.parentPort;

if (!parentPort) {
  process.exit(1);
}

// Keep the utility process protocol narrow and map driver exceptions to stable codes before replying.
parentPort.on('message', (event) => {
  const command = parseDatabaseWorkerCommand(event.data);
  if (!command) {
    return;
  }
  void handleCommand(command);
});

async function handleCommand(command: DatabaseWorkerCommand): Promise<void> {
  const response: DatabaseWorkerResponse = {
    requestId: command.requestId,
    result: await executeCommand(command),
  };
  parentPort?.postMessage(response);

  if (command.operation === 'close') {
    await databaseService.closeAll();
    process.exit(0);
  }
}

function executeCommand(command: DatabaseWorkerCommand) {
  switch (command.operation) {
    case 'connect':
      return databaseService.connect(command.sessionId, command.input);
    case 'disconnect':
      return databaseService.disconnect(command.sessionId);
    case 'list-schemas':
      return databaseService.listSchemas(command.sessionId);
    case 'list-tables':
      return databaseService.listTables(command.sessionId, command.schema);
    case 'get-structure':
      return databaseService.getStructure(command.sessionId, command.schema, command.table);
    case 'get-data-page':
      return databaseService.getDataPage(command.sessionId, command.schema, command.table, command.page, command.pageRequestId);
    case 'cancel-data-page':
      return databaseService.cancelDataPage(command.sessionId, command.targetRequestId);
    case 'close':
      return Promise.resolve({ ok: true, value: true } as const);
  }
}
