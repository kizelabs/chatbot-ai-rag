import { google } from "googleapis";
import { loadCoreEnv } from "@chatbot/config";
import type { ToolDefinition, ToolExecutionResult } from "../types.js";

const env = loadCoreEnv();
const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"]
});

const sheets = google.sheets({ version: "v4", auth });

const parseSpreadsheetArgs = (args: Record<string, unknown>) => ({
  spreadsheetId: String(args.spreadsheetId ?? ""),
  range: String(args.range ?? "")
});

const success = (output: unknown): ToolExecutionResult => ({ output });
const failure = (error: unknown): ToolExecutionResult => ({
  output: { error: error instanceof Error ? error.message : String(error) },
  isError: true
});

export const sheetsTools: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_sheet",
      description: "Read values from a Google Sheet range",
      parameters: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string" }
        },
        required: ["spreadsheetId", "range"]
      }
    },
    execute: async (args) => {
      try {
        const { spreadsheetId, range } = parseSpreadsheetArgs(args);
        const result = await sheets.spreadsheets.values.get({ spreadsheetId, range });
        return success({ values: result.data.values ?? [] });
      } catch (error) {
        return failure(error);
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_sheet",
      description: "Overwrite a range in Google Sheet",
      parameters: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string" },
          values: {
            type: "array",
            items: {
              type: "array",
              items: { type: "string" }
            }
          }
        },
        required: ["spreadsheetId", "range", "values"]
      }
    },
    execute: async (args) => {
      try {
        const { spreadsheetId, range } = parseSpreadsheetArgs(args);
        const values = (args.values as string[][]) ?? [];
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values }
        });
        return success({ written: values.length });
      } catch (error) {
        return failure(error);
      }
    }
  },
  {
    type: "function",
    function: {
      name: "append_row",
      description: "Append a row to a sheet",
      parameters: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" },
          range: { type: "string" },
          row: {
            type: "array",
            items: { type: "string" }
          }
        },
        required: ["spreadsheetId", "range", "row"]
      }
    },
    execute: async (args) => {
      try {
        const { spreadsheetId, range } = parseSpreadsheetArgs(args);
        const row = (args.row as string[]) ?? [];
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [row] }
        });
        return success({ appended: true });
      } catch (error) {
        return failure(error);
      }
    }
  },
  {
    type: "function",
    function: {
      name: "list_sheets",
      description: "List sheet names in a spreadsheet",
      parameters: {
        type: "object",
        properties: {
          spreadsheetId: { type: "string" }
        },
        required: ["spreadsheetId"]
      }
    },
    execute: async (args) => {
      try {
        const spreadsheetId = String(args.spreadsheetId ?? "");
        const result = await sheets.spreadsheets.get({ spreadsheetId });
        const names = (result.data.sheets ?? []).map((sheet) => sheet.properties?.title).filter(Boolean);
        return success({ sheets: names });
      } catch (error) {
        return failure(error);
      }
    }
  }
];
