import { context, db as dbCore, env } from "@budibase/backend-core"
import { getTableParams } from "../../../db/utils"
import {
  breakExternalTableId,
  isExternalTableID,
  isSQL,
} from "../../../integrations/utils"
import {
  Database,
  FieldType,
  INTERNAL_TABLE_SOURCE_ID,
  RelationshipFieldMetadata,
  Table,
  TableResponse,
  TableSchema,
  TableSourceType,
  TableViewsResponse,
} from "@budibase/types"
import datasources from "../datasources"
import sdk from "../../../sdk"

export function processTable(table: Table): Table {
  if (!table) {
    return table
  }
  if (table._id && isExternalTableID(table._id)) {
    return {
      ...table,
      type: "table",
      sourceType: TableSourceType.EXTERNAL,
    }
  } else {
    const processed: Table = {
      ...table,
      type: "table",
      sourceId: table.sourceId || INTERNAL_TABLE_SOURCE_ID,
      sourceType: TableSourceType.INTERNAL,
    }
    if (dbCore.isSqsEnabledForTenant()) {
      processed.sql = !!env.SQS_SEARCH_ENABLE
    }
    return processed
  }
}

export function processTables(tables: Table[]): Table[] {
  return tables.map(table => processTable(table))
}

function processEntities(tables: Record<string, Table>) {
  for (let key of Object.keys(tables)) {
    tables[key] = processTable(tables[key])
  }
  return tables
}

export async function getAllInternalTables(db?: Database): Promise<Table[]> {
  if (!db) {
    db = context.getAppDB()
  }
  const internalTables = await db.allDocs<Table>(
    getTableParams(null, {
      include_docs: true,
    })
  )
  return processTables(internalTables.rows.map(row => row.doc!))
}

async function getAllExternalTables(): Promise<Table[]> {
  const datasources = await sdk.datasources.fetch({ enriched: true })
  const allEntities = datasources.map(datasource => datasource.entities)
  let final: Table[] = []
  for (let entities of allEntities) {
    if (entities) {
      final = final.concat(Object.values(entities))
    }
  }
  return processTables(final)
}

export async function getExternalTable(
  datasourceId: string,
  tableName: string
): Promise<Table> {
  const entities = await getExternalTablesInDatasource(datasourceId)
  if (!entities[tableName]) {
    throw new Error(`Unable to find table named "${tableName}"`)
  }
  return processTable(entities[tableName])
}

export async function getTable(tableId: string): Promise<Table> {
  const db = context.getAppDB()
  let output: Table
  if (tableId && isExternalTableID(tableId)) {
    let { datasourceId, tableName } = breakExternalTableId(tableId)
    const datasource = await datasources.get(datasourceId)
    const table = await getExternalTable(datasourceId, tableName)
    output = { ...table, sql: isSQL(datasource) }
  } else {
    output = await db.get<Table>(tableId)
  }
  return processTable(output)
}

export async function getAllTables() {
  const [internal, external] = await Promise.all([
    getAllInternalTables(),
    getAllExternalTables(),
  ])
  return processTables([...internal, ...external])
}

export async function getExternalTablesInDatasource(
  datasourceId: string
): Promise<Record<string, Table>> {
  const datasource = await datasources.get(datasourceId, { enriched: true })
  if (!datasource || !datasource.entities) {
    throw new Error("Datasource is not configured fully.")
  }
  return processEntities(datasource.entities)
}

export async function getTables(tableIds: string[]): Promise<Table[]> {
  const externalTableIds = tableIds.filter(tableId =>
      isExternalTableID(tableId)
    ),
    internalTableIds = tableIds.filter(tableId => !isExternalTableID(tableId))
  let tables: Table[] = []
  if (externalTableIds.length) {
    const externalTables = await getAllExternalTables()
    tables = tables.concat(
      externalTables.filter(
        table => externalTableIds.indexOf(table._id!) !== -1
      )
    )
  }
  if (internalTableIds.length) {
    const db = context.getAppDB()
    const internalTables = await db.getMultiple<Table>(internalTableIds, {
      allowMissing: true,
    })
    tables = tables.concat(internalTables)
  }
  return processTables(tables)
}

export async function enrichRelationshipSchema(
  schema: TableSchema
): Promise<TableSchema> {
  const tableCache: Record<string, Table> = {}

  async function populateRelTableSchema(field: RelationshipFieldMetadata) {
    if (!tableCache[field.tableId]) {
      tableCache[field.tableId] = await sdk.tables.getTable(field.tableId)
    }
    const relTable = tableCache[field.tableId]

    for (const relTableFieldName of Object.keys(relTable.schema)) {
      const relTableField = relTable.schema[relTableFieldName]
      if (relTableField.type === FieldType.LINK) {
        continue
      }

      if (relTableField.visible === false) {
        continue
      }

      field.schema ??= {}
      const isPrimaryDisplay = relTableFieldName === relTable.primaryDisplay
      const isReadonly =
        isPrimaryDisplay || !!field.schema[relTableFieldName]?.readonly
      field.schema[relTableFieldName] = {
        visible: isReadonly,
        readonly: isReadonly,
      }
    }
  }

  const result: TableSchema = {}
  for (const fieldName of Object.keys(schema)) {
    const field = { ...schema[fieldName] }
    if (field.type === FieldType.LINK) {
      await populateRelTableSchema(field)
    }

    result[fieldName] = field
  }
  return result
}

export function enrichViewSchemas(table: Table): TableResponse {
  return {
    ...table,
    views: Object.values(table.views ?? [])
      .map(v =>
        sdk.views.isV2(v) ? sdk.views.enrichSchema(v, table.schema) : v
      )
      .reduce((p, v) => {
        p[v.name!] = v
        return p
      }, {} as TableViewsResponse),
  }
}
