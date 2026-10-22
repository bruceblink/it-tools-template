import { PostgresDatabaseService } from './postgres-service';
import { MySqlDatabaseService } from './mysql-service';
import { SQLiteDatabaseService } from './sqlite-service';
import { parseDatabaseWorkerCommand, type DatabaseWorkerCommand, type DatabaseWorkerResponse } from './protocol';

const databaseService = new PostgresDatabaseService();
const mysqlDatabaseService = new MySqlDatabaseService();
const sqliteDatabaseService = new SQLiteDatabaseService();
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
    await Promise.all([databaseService.closeAll(), mysqlDatabaseService.closeAll(), sqliteDatabaseService.closeAll()]);
    process.exit(0);
  }
}

function executeCommand(command: DatabaseWorkerCommand) {
  switch (command.operation) {
    case 'connect':
      return databaseService.connect(command.sessionId, command.input);
    case 'connect-mysql':
      return mysqlDatabaseService.connect(command.sessionId, command.input);
    case 'connect-sqlite':
      return sqliteDatabaseService.connect(command.sessionId, command.filePath, command.accessMode);
    case 'disconnect':
      return databaseService.disconnect(command.sessionId);
    case 'disconnect-mysql':
      return mysqlDatabaseService.disconnect(command.sessionId);
    case 'disconnect-sqlite':
      return sqliteDatabaseService.disconnect(command.sessionId);
    case 'list-schemas':
      return databaseService.listSchemas(command.sessionId);
    case 'list-mysql-schemas':
      return mysqlDatabaseService.listSchemas(command.sessionId);
    case 'list-sqlite-schemas':
      return sqliteDatabaseService.listSchemas(command.sessionId);
    case 'list-tables':
      return databaseService.listTables(command.sessionId, command.schema);
    case 'list-mysql-tables':
      return mysqlDatabaseService.listTables(command.sessionId, command.schema);
    case 'list-sqlite-tables':
      return sqliteDatabaseService.listTables(command.sessionId, command.schema);
    case 'get-structure':
      return databaseService.getStructure(command.sessionId, command.schema, command.table);
    case 'get-mysql-structure':
      return mysqlDatabaseService.getStructure(command.sessionId, command.schema, command.table);
    case 'get-sqlite-structure':
      return sqliteDatabaseService.getStructure(command.sessionId, command.schema, command.table);
    case 'get-data-page':
      return databaseService.getDataPage(command.sessionId, command.schema, command.table, command.page, command.pageRequestId);
    case 'get-mysql-data-page':
      return mysqlDatabaseService.getDataPage(command.sessionId, command.schema, command.table, command.page);
    case 'get-sqlite-data-page':
      return sqliteDatabaseService.getDataPage(command.sessionId, command.schema, command.table, command.page);
    case 'update-cell':
      if (command.engine === 'mysql') {
        return mysqlDatabaseService.updateCell(command.sessionId, command.input);
      }
      if (command.engine === 'sqlite') {
        return sqliteDatabaseService.updateCell(command.sessionId, command.input);
      }
      return databaseService.updateCell(command.sessionId, command.input);
    case 'execute-sql-statement':
      if (command.engine === 'mysql') {
        return mysqlDatabaseService.executeStatement(command.sessionId, command.sql, command.offset, command.queryRequestId);
      }
      if (command.engine === 'sqlite') {
        return sqliteDatabaseService.executeStatement(command.sessionId, command.sql, command.offset, command.queryRequestId);
      }
      return databaseService.executeStatement(command.sessionId, command.sql, command.offset, command.queryRequestId);
    case 'cancel-data-page':
      return databaseService.cancelDataPage(command.sessionId, command.targetRequestId);
    case 'cancel-query':
      if (command.engine === 'mysql') {
        return mysqlDatabaseService.cancelQuery(command.sessionId, command.targetRequestId);
      }
      if (command.engine === 'sqlite') {
        return sqliteDatabaseService.cancelQuery(command.sessionId, command.targetRequestId);
      }
      return databaseService.cancelQuery(command.sessionId, command.targetRequestId);
    case 'close':
      return Promise.resolve({ ok: true, value: true } as const);
  }
}
