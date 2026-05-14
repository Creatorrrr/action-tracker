#!/usr/bin/env bash
set -euo pipefail

DEFAULT_CODEX_MODEL="gpt-5.5"
DEFAULT_CODEX_REASONING_EFFORT="xhigh"
DEFAULT_CODEX_APPROVAL_POLICY="on-request"
DEFAULT_CODEX_SANDBOX="workspace-write"

usage() {
  cat <<'USAGE'
Usage:
  scripts/claude-codex-consult.sh [--model MODEL] [--effort EFFORT] [--cd DIR] [request...]
  scripts/claude-codex-consult.sh [options] < prompt.md

Defaults:
  --model   gpt-5.5
  --effort  xhigh
  --cd      current directory

The wrapper intentionally does not set token, budget, or reasoning caps.
USAGE
}

model="${CODEX_MODEL:-$DEFAULT_CODEX_MODEL}"
effort="${CODEX_REASONING_EFFORT:-$DEFAULT_CODEX_REASONING_EFFORT}"
workdir="${CODEX_WORKDIR:-$PWD}"
prompt_args=()

while (($#)); do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -m|--model)
      if (($# < 2)); then
        echo "Missing value for $1" >&2
        exit 64
      fi
      model="$2"
      shift 2
      ;;
    --model=*)
      model="${1#*=}"
      shift
      ;;
    --effort|--reasoning-effort)
      if (($# < 2)); then
        echo "Missing value for $1" >&2
        exit 64
      fi
      effort="$2"
      shift 2
      ;;
    --effort=*|--reasoning-effort=*)
      effort="${1#*=}"
      shift
      ;;
    -C|--cd|--workdir)
      if (($# < 2)); then
        echo "Missing value for $1" >&2
        exit 64
      fi
      workdir="$2"
      shift 2
      ;;
    --cd=*|--workdir=*)
      workdir="${1#*=}"
      shift
      ;;
    --)
      shift
      prompt_args+=("$@")
      break
      ;;
    *)
      prompt_args+=("$1")
      shift
      ;;
  esac
done

stdin_prompt=""
if [[ ! -t 0 ]]; then
  stdin_prompt="$(cat)"
fi

argument_prompt="${prompt_args[*]}"
if [[ -z "$argument_prompt" && -z "$stdin_prompt" ]]; then
  usage >&2
  exit 64
fi

request_prompt="You are Codex CLI being consulted by Claude Code as an independent engineering reviewer.

Take the time needed for a careful answer. There is no requested token, reasoning, or budget cap for this consultation; prioritize correctness and concrete evidence over brevity.

Return a concise but complete answer that Claude Code can compare against its own reasoning. Call out uncertainties and state whether you are making an inference."

if [[ -n "$argument_prompt" ]]; then
  request_prompt+="

Request from command arguments:
$argument_prompt"
fi

if [[ -n "$stdin_prompt" ]]; then
  request_prompt+="

Request from stdin:
$stdin_prompt"
fi

echo "Starting Codex consultation with model=${model}, effort=${effort}, workdir=${workdir}." >&2
echo "Claude Code should wait generously; 3600000 ms is the recommended minimum Bash timeout." >&2

printf '%s\n' "$request_prompt" | codex exec \
  --full-auto \
  -s "$DEFAULT_CODEX_SANDBOX" \
  -m "$model" \
  -c "model_reasoning_effort=\"$effort\"" \
  -c "approval_policy=\"$DEFAULT_CODEX_APPROVAL_POLICY\"" \
  -C "$workdir" \
  -
