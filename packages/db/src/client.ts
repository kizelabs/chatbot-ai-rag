import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import { loadBaseEnv } from "@chatbot/config";
import * as schema from "./schema";

const env = loadBaseEnv();

const makeClient = (): Sql =>
  postgres(env.DATABASE_URL, {
    max: 3,
    prepare: false,
    ssl: "require"
  });

const sql = makeClient();
const sqlWs = makeClient();

export type DbClient = PostgresJsDatabase<typeof schema>;

export const dbHttp: DbClient = drizzle(sql, { schema });
export const dbWs: DbClient = drizzle(sqlWs, { schema });

export const sqlHttp = sql;
export const sqlWorker = sqlWs;
