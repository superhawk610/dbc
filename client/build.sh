#!/bin/bash
set -eo pipefail

# This project relies on `tree-sitter` and the `tree-sitter-sql` grammar.
# We need to fetch the requires files, build the grammar, and copy the output
# `.wasm` files to the `public` directory so that they're available to the
# browser at runtime.

echo "⚡️ Initializing..."
mkdir -p public/editor/themes
mkdir -p public/editor/themes/custom
mkdir -p public/editor/themes/monaco-themes

echo "⚡️ Copying custom themes..."
cp src/components/editor/themes/* public/editor/themes/custom

echo "⚡️ Caching monaco-themes..."
curl -Lo public/editor/themes/monaco-themes.json https://unpkg.com/monaco-themes/themes/themelist.json
for theme in $(jq -r 'keys[]' public/editor/themes/monaco-themes.json); do
  echo "Fetching themes/monaco-themes/${theme}.json..."
  curl -LO --output-dir public/editor/themes/monaco-themes "https://unpkg.com/monaco-themes/themes/${theme}.json"
done

echo "⚡️ Installing web-tree-sitter..."
deno install
cp node_modules/web-tree-sitter/tree-sitter.wasm public/editor/tree-sitter.wasm
cp node_modules/web-tree-sitter/tree-sitter.wasm.map public/editor/.tree-sitter.wasm.map

echo "⚡️ Installing tree-sitter-sql..."
git clone https://github.com/DerekStride/tree-sitter-sql
cd tree-sitter-sql
npx tree-sitter-cli generate
npx tree-sitter-cli build --wasm
cp tree-sitter-sql.wasm ../public/editor/tree-sitter-sql.wasm
cd ..

echo "⚡️ Cleaning up..."
rm -rf tree-sitter-sql

echo "✅ Done!"