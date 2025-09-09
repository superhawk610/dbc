#!/bin/bash
set -eo pipefail

# This project relies on `tree-sitter` and the `tree-sitter-sql` grammar.
# We need to fetch the requires files, build the grammar, and copy the output
# `.wasm` files to the `public` directory so that they're available to the
# browser at runtime.

cd $(dirname "$0")

if [ ! -d "public/editor/themes" ]; then
  echo "⚡️ Initializing..."
  mkdir -p public/editor/themes
fi

if [ ! -d "public/editor/themes/custom" ]; then
  echo "⚡️ Copying custom themes..."
  mkdir -p public/editor/themes/custom
  cp src/components/editor/themes/* public/editor/themes/custom
fi

if [ ! -d "public/editor/themes/monaco-themes" ]; then
  echo "⚡️ Caching monaco-themes..."
  mkdir -p public/editor/themes/monaco-themes
  curl -Lo public/editor/themes/monaco-themes.json https://unpkg.com/monaco-themes/themes/themelist.json
  jq -r 'to_entries[] | "\(.key) \(.value)"' public/editor/themes/monaco-themes.json | while read -r theme label; do
    echo "Fetching \"$label\" to themes/monaco-themes/$theme.json..."
    curl --progress-bar -Lo public/editor/themes/monaco-themes/$theme.json "https://unpkg.com/monaco-themes/themes/${label// /%20}.json"
  done
fi

if [ ! -f "public/editor/tree-sitter.wasm" ]; then
  echo "⚡️ Installing web-tree-sitter..."
  deno install
  cp node_modules/web-tree-sitter/tree-sitter.wasm public/editor/tree-sitter.wasm
  cp node_modules/web-tree-sitter/tree-sitter.wasm.map public/editor/.tree-sitter.wasm.map
fi

if [ ! -f "public/editor/tree-sitter-sql.wasm" ]; then
  echo "⚡️ Installing tree-sitter-sql..."
  git clone https://github.com/DerekStride/tree-sitter-sql
  cd tree-sitter-sql
  npx tree-sitter-cli generate
  npx tree-sitter-cli build --wasm
  cp tree-sitter-sql.wasm ../public/editor/tree-sitter-sql.wasm
  cd ..

  echo "⚡️ Cleaning up..."
  rm -rf tree-sitter-sql
fi

echo "✅ Done!"
