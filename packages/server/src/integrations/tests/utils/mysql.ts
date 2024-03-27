import { Datasource, SourceName } from "@budibase/types"
import { GenericContainer, Wait } from "testcontainers"
import { AbstractWaitStrategy } from "testcontainers/build/wait-strategies/wait-strategy"
import mysql from "mysql2/promise"
import { generator } from "@budibase/backend-core/tests"

class MySQLWaitStrategy extends AbstractWaitStrategy {
  async waitUntilReady(container: any, boundPorts: any, startTime?: Date) {
    // Because MySQL first starts itself up, runs an init script, then restarts,
    // it's possible for the mysqladmin ping to succeed early and then tests to
    // run against a MySQL that's mid-restart and fail. To get around this, we
    // wait for logs and then do a ping check.

    const logs = Wait.forLogMessage(
      "/usr/sbin/mysqld: ready for connections",
      2
    )
    await logs.waitUntilReady(container, boundPorts, startTime)

    const command = Wait.forSuccessfulCommand(
      `mysqladmin ping -h localhost -P 3306 -u root -ppassword`
    )
    await command.waitUntilReady(container)
  }
}

export async function getDatasource(): Promise<Datasource> {
  const container = await new GenericContainer("mysql:8.3")
    .withName("budibase-test-mysql")
    .withReuse()
    .withExposedPorts(3306)
    .withEnvironment({ MYSQL_ROOT_PASSWORD: "password" })
    .withWaitStrategy(new MySQLWaitStrategy().withStartupTimeout(10000))
    .start()
  const host = container.getHost()
  const port = container.getMappedPort(3306)

  const datasource: Datasource = {
    type: "datasource_plus",
    source: SourceName.MYSQL,
    plus: true,
    config: {
      host,
      port,
      user: "root",
      password: "password",
      database: "mysql",
    },
  }

  const database = generator.guid().replaceAll("-", "")
  await rawQuery(datasource, `CREATE DATABASE \`${database}\``)
  datasource.config!.database = database
  return datasource
}

export async function rawQuery(ds: Datasource, sql: string) {
  if (!ds.config) {
    throw new Error("Datasource config is missing")
  }
  if (ds.source !== SourceName.MYSQL) {
    throw new Error("Datasource source is not MySQL")
  }

  const connection = await mysql.createConnection(ds.config)
  try {
    const [rows] = await connection.query(sql)
    return rows
  } finally {
    connection.end()
  }
}
