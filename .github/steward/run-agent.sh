#!/usr/bin/env bash
# Same checkout, prompt, git credentials, salvage and journal for either CLI.
set -euo pipefail
PROMPT="$1"; shift
case "${PROCESSOR:-claude}" in
  claude)
    # Never expose the other provider's credential to this agent.
    unset CODEX_API_KEY
    args=(-p "$PROMPT" --model "${MODEL:-claude-opus-5}"
      --dangerously-skip-permissions --max-turns "${MAX_TURNS:-200}"
      --output-format stream-json --verbose --allowedTools "Bash,Edit,Write,Read,Glob,Grep")
    [ -z "${EFFORT:-}" ] || args+=(--effort "$EFFORT")
    exec claude "${args[@]}" "$@"
    ;;
  codex)
    unset CLAUDE_CODE_OAUTH_TOKEN
    # GitHub's disposable VM is the isolation boundary, as for the Claude lane.
    # Codex has no equivalent to Claude --max-turns; the job's 150m cap applies.
    args=(exec --json --sandbox danger-full-access --model "${MODEL:-gpt-6-astra}")
    [ -z "${EFFORT:-}" ] || args+=(-c "model_reasoning_effort=\"$EFFORT\"")
    exec codex "${args[@]}" "$PROMPT"
    ;;
  *) echo 'Unknown processor' >&2; exit 2 ;;
esac
