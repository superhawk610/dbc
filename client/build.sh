#!/bin/bash
set -eo pipefail

# This project relies on `tree-sitter` and the `tree-sitter-sql` grammar.
# We need to fetch the requires files, build the grammar, and copy the output
# `.wasm` files to the `public` directory so that they're available to the
# browser at runtime.

echo "⚡️ Installing web-tree-sitter..."
deno install
cp node_modules/web-tree-sitter/tree-sitter.wasm public/tree-sitter.wasm
cp node_modules/web-tree-sitter/tree-sitter.wasm.map public/.tree-sitter.wasm.map

echo "⚡️ Installing tree-sitter-sql..."
git clone https://github.com/DerekStride/tree-sitter-sql
cd tree-sitter-sql
npx tree-sitter-cli generate
npx tree-sitter-cli build --wasm
cp tree-sitter-sql.wasm ../public/tree-sitter-sql.wasm
cd ..

echo "⚡️ Cleaning up..."
rm -rf tree-sitter-sql

echo "✅ Done!"