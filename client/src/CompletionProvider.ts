import {
  CancellationToken,
  editor,
  languages,
  Position,
  Range,
} from "monaco-editor";
import { get } from "./api.ts";
import Table from "./models/table.ts";
import Schema from "./models/schema.ts";

const CACHE_TIMEOUT_SECS = 5 * 60;

export interface DbcCompletionProviderContext {
  connection: string | null | undefined;
  database: string | null;
  schema: string | null;
}

const unquote = (str: string) =>
  (str.startsWith('"') && str.endsWith('"')) ? str.slice(1, -1) : str;

function skipWhitespace(contents: string, offset: number) {
  for (let i = offset; i >= 0; i--) {
    const char = contents[i];
    if (char === " " || char === "\n") continue;
    return i;
  }

  return 0;
}

// returns [token, offset]
function previousToken(contents: string, offset: number): [string, number] {
  const start = skipWhitespace(contents, offset);

  let i = start;
  for (; i >= 0; i--) {
    const char = contents[i];
    if (char === " " || char === "\n") break;
  }

  return [contents.slice(i + 1, start + 1), i];
}

export default class DbcCompletionProvider
  implements languages.CompletionItemProvider {
  readonly triggerCharacters = [" ", "."];

  constructor(private context: DbcCompletionProviderContext) {}

  async provideCompletionItems(
    model: editor.ITextModel,
    position: Position,
    context: languages.CompletionContext,
    token: CancellationToken,
  ): Promise<languages.CompletionList> {
    const completion: languages.CompletionList = {
      incomplete: false,
      suggestions: [],
    };

    if (
      context.triggerKind !== languages.CompletionTriggerKind.TriggerCharacter
    ) {
      switch (context.triggerKind) {
        // Invoke seems to occur on each keystroke while the completion dropdown
        // is already visible; this could be used to filter the list of available
        // items to match the text typed thus far?
        //
        // Well, that's no it, because completion items seem to be filtered
        // automatically. Thus far, seems totally OK to ignore `Invoke` (maybe
        // the intention is to remove items that are no longer relevant..?).
        case languages.CompletionTriggerKind.Invoke:
          console.debug("skipping Invoke");
          break;
        case languages.CompletionTriggerKind.TriggerForIncompleteCompletions:
          console.debug("skipping TriggerForIncompleteCompletions");
          break;
      }

      return completion;
    }

    // an active connection/schema are required to provide suggestions
    if (
      !this.context.connection ||
      !this.context.database ||
      !this.context.schema
    ) return completion;

    switch (context.triggerCharacter) {
      // if prior token was `from` or `join`, list tables
      case " ": {
        const offset = model.getOffsetAt(position);
        const contents = model.getValue();

        // move backwards, skipping whitespace
        let [prevToken] = previousToken(contents, offset - 1);
        prevToken = prevToken.toLowerCase();

        if (prevToken === "from" || prevToken === "join") {
          const abort = new AbortController();
          token.onCancellationRequested(() => abort.abort());

          const [tables, schemas] = await Promise.all([
            get<Table[]>(
              `/db/schemas/${this.context.schema}/tables`,
              undefined,
              {
                signal: abort.signal,
                cacheTimeoutSec: CACHE_TIMEOUT_SECS,
                headers: {
                  "x-conn-name": this.context.connection,
                  "x-database": this.context.database,
                },
              },
            ),
            get<Schema[]>(
              `/db/schemas`,
              undefined,
              {
                signal: abort.signal,
                cacheTimeoutSec: CACHE_TIMEOUT_SECS,
                headers: {
                  "x-conn-name": this.context.connection,
                  "x-database": this.context.database,
                },
              },
            ),
          ]);

          completion.suggestions.push(...tables.map((table) => ({
            label: table.table_name,
            insertText: table.table_name,
            kind: languages.CompletionItemKind.Field,
            range: Range.fromPositions(position, position),
            detail: `${this.context.schema}.${table.table_name}`,
          })));

          completion.suggestions.push(...schemas.map((schema) => ({
            label: schema.schema_name,
            insertText: schema.schema_name,
            kind: languages.CompletionItemKind.Module,
            range: Range.fromPositions(position, position),
          })));
        }

        break;
      }

      // if prior token is a schema name, list tables in that schema
      case ".": {
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());

        const offset = model.getOffsetAt(position);
        const contents = model.getValue();
        let [prevToken, prevTokenOffset] = previousToken(contents, offset - 1);
        // remove trailing `.`
        prevToken = prevToken.slice(0, prevToken.length - 1);

        // TODO: auto-complete for `SELECT` fields, if using the `alias.field` syntax

        // if the token before the schema name is `on`, then we're completing a join condition,
        // so we should list columns from the table; similarly, if the token before the schema
        // name is `=`, then we're completing a condition in a `join` clause
        //
        // TODO: this is all pretty hacky, and we should really try to parse the current query
        // AST and iterate over that instead, but that's a task for another day :)
        // see: https://www.npmjs.com/package/pgsql-parser
        const [maybeOnToken, maybeOnOffset] = previousToken(
          contents,
          prevTokenOffset,
        );
        if (
          maybeOnToken.toLowerCase() === "on" ||
          maybeOnToken.toLowerCase() === "="
        ) {
          let table = prevToken;

          // resolve table aliases ---------------
          const tableAlias = table;

          // find start bound for current query
          let prevSemiIndex = maybeOnOffset;
          while (contents[prevSemiIndex] !== ";" && prevSemiIndex >= 0) {
            prevSemiIndex -= 1;
          }
          const queryStartIndex = prevSemiIndex + 1;

          // move backwards from previous token, checking for a table alias
          // that matches that token; if we find one, assume the token is an
          // alias and use the aliased value, and if not, assume the token
          // is the table name itself
          let prevTokenOffset = maybeOnOffset;
          while (prevTokenOffset > queryStartIndex) {
            let prevToken: string;
            [prevToken, prevTokenOffset] = previousToken(
              contents,
              prevTokenOffset,
            );
            if (prevToken === tableAlias) {
              [table] = previousToken(contents, prevTokenOffset);
              break;
            }
          }
          // --------------------------------------

          const columns = await get<string[]>(
            `/db/schemas/${this.context.schema}/tables/${
              unquote(table)
            }/columns`,
            undefined,
            {
              signal: abort.signal,
              cacheTimeoutSec: CACHE_TIMEOUT_SECS,
              headers: {
                "x-conn-name": this.context.connection,
                "x-database": this.context.database,
              },
            },
          );

          completion.suggestions.push(...columns.map((column) => ({
            label: column,
            insertText: column,
            sortText: column === "id" ? "0" : column,
            kind: languages.CompletionItemKind.Property,
            range: Range.fromPositions(position, position),
            detail: `${table}.${column}`,
          })));

          break;
        }

        // otherwise, this might be a schema name, so list tables in that schema
        const tables = await get<Table[]>(
          `/db/schemas/${unquote(prevToken)}/tables`,
          undefined,
          {
            signal: abort.signal,
            cacheTimeoutSec: CACHE_TIMEOUT_SECS,
            headers: {
              "x-conn-name": this.context.connection,
              "x-database": this.context.database,
            },
          },
        );

        completion.suggestions.push(...tables.map((table) => ({
          label: table.table_name,
          insertText: table.table_name,
          kind: languages.CompletionItemKind.Field,
          range: Range.fromPositions(position, position),
          detail: `${unquote(prevToken)}.${table.table_name}`,
        })));

        break;
      }

      default:
        console.log(context);
        throw new Error("unreachable");
    }

    return completion;
  }

  // use this to perform any additional processing for a completion item
  // once it's about to show on screen
  //
  // resolveCompletionItem(
  //   item: languages.CompletionItem,
  //   token: CancellationToken,
  // ): languages.ProviderResult<languages.CompletionItem> {
  //   console.log("resolveCompletionItem", item, token);

  //   return item;
  // }
}
