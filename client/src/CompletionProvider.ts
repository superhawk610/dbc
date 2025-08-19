import {
  CancellationToken,
  editor,
  languages,
  Position,
  Range,
} from "monaco-editor";
import { get } from "./api.ts";
import Table from "./models/table.ts";

export interface DbcCompletionProviderContext {
  connection: string | null | undefined;
  database: string | null;
  schema: string | null;
}

// TODO: cache completion items
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
        let prevTokenStart = offset - 1;
        for (; prevTokenStart >= 0; prevTokenStart--) {
          const char = contents[prevTokenStart];
          if (char === " " || char === "\n") continue;
          break;
        }

        // keep moving backwards until next whitespace is encountered
        for (; prevTokenStart >= 0; prevTokenStart--) {
          const char = contents[prevTokenStart];
          if (char === " " || char === "\n") break;
        }

        const prevToken = contents.slice(prevTokenStart + 1, offset - 1)
          .toLowerCase();
        if (prevToken === "from" || prevToken === "join") {
          const abort = new AbortController();
          token.onCancellationRequested(() => abort.abort());

          const tables = await get<Table[]>(
            `/db/schemas/${this.context.schema}/tables`,
            undefined,
            {
              signal: abort.signal,
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
          })));
        }

        break;
      }

      // FIXME: this isn't the right behaviour; if the prior token is a _schema name_,
      // provide available table names in that schema; column completions should be
      // given when editing the `select` clause and the table source was already given
      //
      // if prior token is a table name, list columns
      case ".": {
        // const offset = model.getOffsetAt(position);
        // const contents = model.getValue();

        // // move backwards until whitespace is encountered
        // let prevTokenStart = offset - 1;
        // for (; prevTokenStart >= 0; prevTokenStart--) {
        //   const char = contents[prevTokenStart];
        //   if (char === " " || char === "\n") break;
        // }

        // // TODO: validate whether previous token is table name
        // const prevToken = contents.slice(prevTokenStart + 1, offset - 1);

        // const abort = new AbortController();
        // token.onCancellationRequested(() => abort.abort());

        // const columns = await get<string[]>(
        //   `/db/schemas/${this.context.schema}/tables/${prevToken}/columns`,
        //   undefined,
        //   {
        //     signal: abort.signal,
        //     headers: { "x-conn-name": this.context.connection },
        //   },
        // );

        // completion.suggestions.push(...columns.map((column) => ({
        //   label: column,
        //   insertText: column,
        //   kind: languages.CompletionItemKind.Variable,
        //   range: Range.fromPositions(position, position),
        // })));

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
