#!/usr/bin/env bash

set -euo pipefail

source_tree="${CODEX_SOURCE_TREE_PATH:?Missing CODEX_SOURCE_TREE_PATH}"
worktree="${CODEX_WORKTREE_PATH:?Missing CODEX_WORKTREE_PATH}"

find "$source_tree" \
  \( -name .git -o -name node_modules -o -name .pnpm-store \
     -o -name DerivedData -o -name .build -o -name build \
     -o -name dist -o -name .wrangler -o -name .vite \) \
  -prune -o \
  -type f \( -name ".env" -o -name ".env.*" -o -name ".dev.vars" \
    -o -name "Local.xcconfig" \) \
  -print0 |
while IFS= read -r -d "" source_file; do
  relative_path="${source_file#"$source_tree"/}"

  if git -C "$source_tree" check-ignore -q -- "$relative_path"; then
    destination="$worktree/$relative_path"
    mkdir -p "$(dirname "$destination")"
    cp -p "$source_file" "$destination"
    echo "Copied $relative_path"
  fi
done

cd "$worktree"
pnpm install --frozen-lockfile
