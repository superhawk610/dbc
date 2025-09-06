import {
  CancellationToken,
  editor,
  languages,
  Position,
  Range,
} from "monaco-editor";
import { Language, Parser, Query, Tree } from "web-tree-sitter";
import { get } from "./api.ts";
import Table from "./models/table.ts";
import Schema from "./models/schema.ts";
import { activeQuery } from "./components/editor/utils.ts";

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
  private parser!: Parser;

  constructor(private context: DbcCompletionProviderContext) {
    (async () => {
      await Parser.init({ locateFile: (path: string) => "/" + path });
      const sql = await Language.load("/tree-sitter-sql.wasm");
      const parser = new Parser();
      parser.setLanguage(sql);
      this.parser = parser;
    })();
  }

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
      // switch (context.triggerKind) {
      //   // Invoke seems to occur on each keystroke while the completion dropdown
      //   // is already visible; this could be used to filter the list of available
      //   // items to match the text typed thus far?
      //   //
      //   // Well, that's no it, because completion items seem to be filtered
      //   // automatically. Thus far, seems totally OK to ignore `Invoke` (maybe
      //   // the intention is to remove items that are no longer relevant..?).
      //   case languages.CompletionTriggerKind.Invoke:
      //     console.debug("skipping Invoke");
      //     break;
      //   case languages.CompletionTriggerKind.TriggerForIncompleteCompletions:
      //     console.debug("skipping TriggerForIncompleteCompletions");
      //     break;
      // }

      return completion;
    }

    // an active connection/schema are required to provide suggestions
    // it's also possible, though unlikely, that the parser hasn't initialized
    if (
      !this.parser ||
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
        let query = activeQuery(model, position)?.query ?? model.getValue();

        // remove just-typed `.` to improve query compilation
        const offset = model.getOffsetAt(position);
        query = query.slice(0, offset - 1) + query.slice(offset);

        const ctes: Set<string> = new Set();
        const aliases: Record<string, string> = {};
        const tableNames: Set<string> = new Set();
        try {
          const tree = this.parser.parse(query)!;

          const cteMatches = this.treeQuery(
            tree,
            `(
              cte
              (identifier) @name
            )`,
          );
          for (const match of cteMatches) {
            ctes.add(match["name"]);
          }

          const tableMatches = this.treeQuery(
            tree,
            `(
              relation (
                object_reference
                name: (identifier) @table
              )
              alias: (identifier) @alias ?
            )`,
          );
          for (const match of tableMatches) {
            tableNames.add(match["table"]);
            if (match["alias"]) {
              aliases[match["alias"]] = match["table"];
            }
          }
        } catch {
          return completion;
        }

        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());

        const contents = model.getValue();
        let [prevToken] = previousToken(contents, offset - 1);
        // remove trailing `.`
        prevToken = prevToken.slice(0, prevToken.length - 1);

        // if the user types `{cte}.`, we can't provide any completions
        // since we don't know what fields the CTE can return
        // TODO: try to parse `select` expression from CTE?
        if (ctes.has(prevToken)) {
          return completion;
        }

        // if the user is typing `{tableName}.` or `{tableAlias}.`,
        // provide column names from that table for completion
        if (aliases[prevToken] || tableNames.has(prevToken)) {
          const table = aliases[prevToken] || prevToken;

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
        throw new Error("unreachable");
    }

    return completion;
  }

  private treeQuery(tree: Tree, query: string) {
    const output: Array<Record<string, string>> = [];
    const matches = new Query(this.parser.language!, query).matches(
      tree.rootNode,
    );
    for (const match of matches) {
      const captures: Record<string, string> = {};
      for (const capture of match.captures) {
        captures[capture.name] = capture.node.text;
      }
      output.push(captures);
    }
    return output;
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
